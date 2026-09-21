import { describe, it, expect } from 'vitest';
import { rollingHedge, type RollingInput } from './rolling';
import { effectivePrice } from './calc';

/**
 * ── INTENSIVE CHECK OF THE ROLLING MATH (user 2026-09-21: "very intensive testing of the
 * calculations … nearly the same net winnings for each outcome") ──────────────────────────
 *
 * Two independent lines of evidence, over thousands of random positions:
 *
 *  1. A CASH-FLOW SIMULATOR that knows nothing about the sizing formula. It replays each
 *     outcome the way the money actually moves — pay the stake, buy leg-1 tokens, see leg 1
 *     settle, and only then either collect on the tokens or buy leg-2 tokens and see leg 2
 *     settle — and reports the EUR left over. If the sizing is right, the simulator lands on
 *     the same number on every path, and on the same number `rollingHedge` reports.
 *
 *  2. ALGEBRAIC INVARIANTS: branch equality, lock = gate − 1 (without slip rounding),
 *     linearity in stake, EUR results independent of the exchange rate, monotone in price.
 */

// Deterministic PRNG so a failure is reproducible from the seed printed in the message.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}
const between = (r: () => number, lo: number, hi: number) => lo + (hi - lo) * r();

interface Sim { profits: number[] }

/**
 * Replay every outcome path of an N-leg rolling hedge as a sequence of cash movements.
 * `shares[k]` and `pEff[k]` come from the result under test; the RULE (buy leg k only if
 * legs 0..k−1 won) is applied here independently.
 */
function simulate(stake: number, payout: number, xe: number, shares: number[], pEff: number[]): Sim {
  const n = shares.length;
  const profits: number[] = [];
  // Path k: legs 0..k−1 win, leg k loses.  Path n: every leg wins.
  for (let failAt = 0; failAt <= n; failAt++) {
    let eur = -stake;               // the bookie slip is paid for up front
    let usd = 0;
    for (let k = 0; k < n; k++) {
      if (k > failAt) break;        // an earlier leg lost: the slip is dead, no more hedges
      usd -= shares[k] * pEff[k];   // buy this leg's opposite token at its effective price
      if (k === failAt) {
        usd += shares[k];           // the leg LOST → our opposite tokens pay $1 each; slip dead
        break;
      }
      // the leg WON → tokens worthless, slip still alive, move to the next leg
    }
    if (failAt === n) eur += payout; // every leg won → the bookie pays the parlay
    profits.push(eur + usd / xe);
  }
  return { profits };
}

function randomInput(r: () => number, legs: number): RollingInput {
  return {
    stake: between(r, 1, 500),
    legs: Array.from({ length: legs }, () => ({
      odds: between(r, 1.05, 12),
      priceCents: between(r, 1, 99),
      feeOn: r() < 0.7,
    })),
    feeRate: [0, 0.04, 0.05, 0.07][Math.floor(r() * 4)],
    xe: between(r, 0.95, 1.4),
    payout: null,
  };
}

const CASES = 4000;
const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(1, Math.abs(a), Math.abs(b));

describe('rolling hedge — every outcome pays the same, by independent cash-flow replay', () => {
  for (const legs of [2, 3, 4]) {
    it(`${legs} legs × ${CASES} random positions: simulator paths agree with each other and with the result`, () => {
      const r = rng(20260921 + legs);
      for (let i = 0; i < CASES; i++) {
        const input = randomInput(r, legs);
        const res = rollingHedge(input);
        const sim = simulate(input.stake, res.payout, input.xe, res.legs.map((l) => l.shares), res.legs.map((l) => l.pEff));
        expect(sim.profits).toHaveLength(legs + 1);
        for (let k = 0; k < sim.profits.length; k++) {
          // every path lands on the same EUR figure …
          expect(rel(sim.profits[k], sim.profits[0]), `case ${i} path ${k}: ${JSON.stringify(input)}`).toBeLessThan(1e-9);
          // … and it is the figure the calculator reports for that branch
          expect(rel(sim.profits[k], res.branches[k]), `case ${i} branch ${k}`).toBeLessThan(1e-9);
        }
        expect(res.lock).toBe(Math.min(...res.branches));
      }
    });
  }

  it('2 legs with a SLIP PAYOUT that differs from the nominal product: still three equal outcomes', () => {
    const r = rng(7);
    for (let i = 0; i < CASES; i++) {
      const input = randomInput(r, 2);
      const nominal = input.stake * input.legs[0].odds * input.legs[1].odds;
      input.payout = nominal * between(r, 0.97, 1.03); // bookie rounding either way
      const res = rollingHedge(input);
      const sim = simulate(input.stake, input.payout, input.xe, res.legs.map((l) => l.shares), res.legs.map((l) => l.pEff));
      for (let k = 0; k < 3; k++) {
        expect(rel(sim.profits[k], res.branches[k])).toBeLessThan(1e-9);
        expect(rel(sim.profits[k], sim.profits[0])).toBeLessThan(1e-9);
      }
      expect(res.payout).toBe(input.payout);
    }
  });
});

describe('rolling hedge — algebraic invariants over random positions', () => {
  const r = rng(99);
  const inputs = Array.from({ length: CASES }, () => randomInput(r, 2));

  it('lock/stake equals gate − 1 exactly when the payout is the nominal product', () => {
    for (const input of inputs) {
      const res = rollingHedge(input);
      expect(rel(res.lockPct, res.gate - 1)).toBeLessThan(1e-9);
    }
  });

  it('the leg-1 hedge is the leg-2 hedge minus the leg-2 cost; the last hedge is payout·XE', () => {
    for (const input of inputs) {
      const res = rollingHedge(input);
      expect(rel(res.legs[1].shares, res.payout * input.xe)).toBeLessThan(1e-12);
      expect(rel(res.legs[0].shares, res.legs[1].shares - res.legs[1].costUsd)).toBeLessThan(1e-12);
      expect(res.legs[0].shares).toBeLessThan(res.legs[1].shares);
      expect(res.legs[0].shares).toBeGreaterThan(0);
    }
  });

  it('effective prices follow calc.effectivePrice: fee on → taker formula, fee off → raw price', () => {
    for (const input of inputs) {
      const res = rollingHedge(input);
      input.legs.forEach((l, k) => {
        const want = l.feeOn ? effectivePrice(l.priceCents / 100, input.feeRate, false) : l.priceCents / 100;
        expect(res.legs[k].pEff).toBeCloseTo(want, 12);
        expect(res.legs[k].costUsd).toBeCloseTo(res.legs[k].shares * want, 9);
      });
      expect(res.totalCostUsd).toBeCloseTo(res.legs[0].costUsd + res.legs[1].costUsd, 9);
    }
  });

  it('linear in stake: doubling the stake doubles every share count, cost and the lock', () => {
    for (const input of inputs.slice(0, 1000)) {
      const a = rollingHedge(input);
      const b = rollingHedge({ ...input, stake: input.stake * 2 });
      expect(rel(b.lock, 2 * a.lock)).toBeLessThan(1e-9);
      expect(rel(b.legs[0].shares, 2 * a.legs[0].shares)).toBeLessThan(1e-12);
      expect(rel(b.legs[1].costUsd, 2 * a.legs[1].costUsd)).toBeLessThan(1e-12);
      expect(b.lockPct).toBeCloseTo(a.lockPct, 12);
      expect(b.gate).toBeCloseTo(a.gate, 12);
    }
  });

  it('the EUR lock does not depend on the exchange rate (only the USD share counts do)', () => {
    for (const input of inputs.slice(0, 1000)) {
      const a = rollingHedge(input);
      const b = rollingHedge({ ...input, xe: input.xe * 1.1 });
      expect(rel(b.lock, a.lock)).toBeLessThan(1e-9);
      expect(rel(b.legs[1].shares, a.legs[1].shares * 1.1)).toBeLessThan(1e-12);
      expect(b.gate).toBeCloseTo(a.gate, 12);
    }
  });

  it('a dearer hedge on either leg can only lower the lock; a cheaper one can only raise it', () => {
    for (const input of inputs.slice(0, 1000)) {
      const a = rollingHedge(input);
      for (const k of [0, 1]) {
        const legs = input.legs.map((l, i) => (i === k ? { ...l, priceCents: Math.min(99, l.priceCents + 1) } : l));
        const b = rollingHedge({ ...input, legs });
        expect(b.lock).toBeLessThanOrEqual(a.lock + 1e-9);
        expect(b.legs[k].gate).toBeLessThanOrEqual(a.legs[k].gate + 1e-12);
      }
    }
  });

  it('turning a leg’s fee off never hurts, and helps exactly when the fee rate is positive', () => {
    for (const input of inputs.slice(0, 1000)) {
      const on = rollingHedge({ ...input, legs: input.legs.map((l) => ({ ...l, feeOn: true })) });
      const off = rollingHedge({ ...input, legs: input.legs.map((l) => ({ ...l, feeOn: false })) });
      if (input.feeRate === 0) expect(off.lock).toBeCloseTo(on.lock, 12);
      else expect(off.lock).toBeGreaterThan(on.lock);
    }
  });

  it('the verdict follows the gate: LOCK iff gate > 1.005, and a lock ⇒ positive profit on every branch', () => {
    for (const input of inputs) {
      const res = rollingHedge(input);
      expect(res.isLock).toBe(res.gate > 1.005);
      if (res.isLock) for (const b of res.branches) expect(b).toBeGreaterThan(0);
      if (res.gate < 1) for (const b of res.branches) expect(b).toBeLessThan(0);
    }
  });
});
