import { describe, it, expect } from 'vitest';
import { rollingHedge, legSlack, LEG_END_MINUTES } from './rolling';
import { rollingSummary } from './summary';
import { effectivePrice } from './calc';

/** The spec's worked example: Levski–Salzburg O2.5 × Bayern–Union O10.5 corners (2026-09-17). */
const EXAMPLE = {
  stake: 37.15,
  legs: [
    { odds: 2.02, priceCents: 43, feeOn: true },
    { odds: 2.2, priceCents: 50, feeOn: true },
  ],
  feeRate: 0.05,
  xe: 1.147649513,
  payout: 165.09,
};

describe('rollingHedge — the spec worked example', () => {
  const r = rollingHedge(EXAMPLE);

  it('fee: pe(0.43) = 0.4423, pe(0.50) = 0.5125', () => {
    expect(r.legs[0].pEff).toBeCloseTo(0.4423, 4);
    expect(r.legs[1].pEff).toBeCloseTo(0.5125, 4);
  });

  it('sizes N2 = 189.47 / C2 = 97.10, then N1 ≈ 92.36 / C1 ≈ 40.85', () => {
    expect(r.legs[1].shares).toBeCloseTo(189.47, 2);
    expect(r.legs[1].costUsd).toBeCloseTo(97.1, 2);
    // the spec shows 92.37 because it chains ROUNDED intermediates (189.47 − 97.10); full
    // precision gives 92.364 — half a cent of shares, and the branches below still agree
    expect(r.legs[0].shares).toBeCloseTo(92.36, 1);
    expect(r.legs[0].costUsd).toBeCloseTo(40.85, 1);
    expect(r.totalCostUsd).toBeCloseTo(137.95, 2);
  });

  it('every branch pays the same +7.74 EUR (20.8% of stake)', () => {
    expect(r.branches).toHaveLength(3);
    for (const b of r.branches) expect(b).toBeCloseTo(7.74, 2);
    expect(r.lock).toBeCloseTo(7.74, 2);
    expect(r.lockPct * 100).toBeCloseTo(20.8, 1);
  });

  it('gate: leg1 +12.7%, leg2 +7.3%, combined +20.8% ≈ lock/stake; verdict LOCK', () => {
    expect((r.legs[0].gate - 1) * 100).toBeCloseTo(12.65, 1);
    expect((r.legs[1].gate - 1) * 100).toBeCloseTo(7.25, 1);
    expect((r.gate - 1) * 100).toBeCloseTo(20.8, 1);
    expect(r.gate - 1).toBeCloseTo(r.lockPct, 3);
    expect(r.isLock).toBe(true);
  });

  it('uses the slip payout when given and reports the nominal product beside it', () => {
    expect(r.payout).toBe(165.09);
    expect(r.nominalPayout).toBeCloseTo(37.15 * 2.02 * 2.2, 6);
  });
});

describe('rollingHedge — invariants', () => {
  it('without a slip payout the branches agree exactly', () => {
    const r = rollingHedge({ ...EXAMPLE, payout: null });
    const [a, b, c] = r.branches;
    expect(a).toBeCloseTo(b, 9);
    expect(b).toBeCloseTo(c, 9);
  });

  it('a slip payout that differs from nominal keeps ALL branches equal (the last hedge is sized on it); only lock/stake drifts from gate−1', () => {
    // B = −S − ΣC/XE + N2/XE and N2 = P·XE, so B ≡ C for any P; A = B by construction.
    const r = rollingHedge({ ...EXAMPLE, payout: 170 });
    for (const b of r.branches) expect(b).toBeCloseTo(r.branches[0], 9);
    expect(r.lock).toBeGreaterThan(rollingHedge(EXAMPLE).lock);
    expect(Math.abs(r.lockPct - (r.gate - 1))).toBeGreaterThan(0.01);
  });

  it('turning the fee off on a leg uses the raw price (maker / activity-log fill)', () => {
    const r = rollingHedge({ ...EXAMPLE, legs: [{ ...EXAMPLE.legs[0], feeOn: false }, EXAMPLE.legs[1]] });
    expect(r.legs[0].pEff).toBe(0.43);
    expect(r.legs[0].costUsd).toBeCloseTo(r.legs[0].shares * 0.43, 9);
    expect(r.lock).toBeGreaterThan(rollingHedge(EXAMPLE).lock);
  });

  it('a dead double (gate < 1) loses on every branch and is not a lock', () => {
    const r = rollingHedge({ ...EXAMPLE, legs: [{ odds: 1.5, priceCents: 60, feeOn: true }, { odds: 1.5, priceCents: 60, feeOn: true }], payout: null });
    expect(r.gate).toBeLessThan(1);
    expect(r.isLock).toBe(false);
    for (const b of r.branches) expect(b).toBeLessThan(0);
  });

  it('a negative leg can still ride a strong partner (per-leg gates are exposed for that)', () => {
    const r = rollingHedge({ ...EXAMPLE, legs: [{ odds: 3.0, priceCents: 25, feeOn: true }, { odds: 1.6, priceCents: 45, feeOn: true }], payout: null });
    expect(r.legs[1].gate).toBeLessThan(1);
    expect(r.legs[0].gate).toBeGreaterThan(1);
    expect(r.gate).toBeGreaterThan(1);
    expect(r.lock).toBeGreaterThan(0);
  });

  it('three legs: the same recursion from the last leg backward, four equal branches', () => {
    const r = rollingHedge({
      stake: 20,
      legs: [
        { odds: 1.8, priceCents: 50, feeOn: true },
        { odds: 1.9, priceCents: 48, feeOn: true },
        { odds: 2.1, priceCents: 44, feeOn: true },
      ],
      feeRate: 0.05,
      xe: 1.15,
      payout: null,
    });
    expect(r.branches).toHaveLength(4);
    const p3 = effectivePrice(0.44, 0.05, false);
    const N3 = 20 * 1.8 * 1.9 * 2.1 * 1.15;
    expect(r.legs[2].shares).toBeCloseTo(N3, 6);
    expect(r.legs[1].shares).toBeCloseTo(N3 - N3 * p3, 6);
    for (const b of r.branches) expect(b).toBeCloseTo(r.branches[0], 9);
    expect(r.gate - 1).toBeCloseTo(r.lockPct, 6);
  });

  it('a single leg collapses to the ordinary boost hedge: shares = stake·odds·xe', () => {
    const r = rollingHedge({ stake: 20, legs: [{ odds: 2.55, priceCents: 50, feeOn: true }], feeRate: 0.05, xe: 1.16, payout: null });
    expect(r.legs[0].shares).toBeCloseTo(20 * 2.55 * 1.16, 9);
    expect(r.branches).toHaveLength(2);
    expect(r.branches[0]).toBeCloseTo(r.branches[1], 9);
  });
});

describe('legSlack — chronology', () => {
  const k1 = Date.parse('2026-09-17T19:45:00');
  it('full-time leg 1 at 19:45, leg 2 at 21:45 → 5 minutes of slack', () => {
    const s = legSlack(k1, Date.parse('2026-09-17T21:45:00'), 'full-time');
    expect(s.slackMin).toBeCloseTo(120 - LEG_END_MINUTES['full-time'], 6);
    expect(s.wrongOrder).toBe(false);
  });
  it('a first-half leg 1 frees up an hour more', () => {
    expect(legSlack(k1, Date.parse('2026-09-17T21:45:00'), 'first-half').slackMin).toBeCloseTo(65, 6);
  });
  it('overlapping games → negative slack; leg 2 before leg 1 → wrong order', () => {
    expect(legSlack(k1, Date.parse('2026-09-17T20:30:00'), 'full-time').slackMin).toBeLessThan(0);
    expect(legSlack(k1, Date.parse('2026-09-17T18:00:00'), 'full-time').wrongOrder).toBe(true);
  });
});

describe('rollingSummary — the copy-paste block', () => {
  const r = rollingHedge(EXAMPLE);
  const text = rollingSummary({
    bookie: 'inbet',
    stake: 37.15,
    slipPayout: 165.09,
    xe: 1.147649513,
    feeRatePct: 5,
    note: 'both legs in the same slip',
    now: new Date(2026, 8, 17, 18, 30),
    legs: [
      { match: 'Levski – Salzburg', bet: 'Over 2.5 goals', polyHedge: 'Levski–Salzburg U2.5 goals', kickoff: '2026-09-17T19:45', odds: 2.02, priceCents: 43, feeOn: true },
      { match: 'Bayern – Union', bet: 'Over 10.5 corners', polyHedge: 'Bayern–Union U10.5 corners', kickoff: '2026-09-17T21:00', odds: 2.2, priceCents: 50, feeOn: false },
    ],
  }, r);
  const lines = text.split('\n');

  it('header, slip line, one block per leg with the explicit Poly action, lock line, branches, note', () => {
    expect(lines[0]).toBe('ROLLING DOUBLE — 2026-09-17 18:30');
    expect(lines[1]).toMatch(/^Bookie: inbet · stake €37\.15 · payout €165\.09 · combined 4\.444$/);
    expect(lines[2]).toBe('Leg 1 (finishes first): Levski – Salzburg · Over 2.5 goals @2.02 · kickoff 2026-09-17 19:45');
    expect(lines[3]).toMatch(/^  Poly hedge: Levski–Salzburg U2\.5 goals @43¢ \(taker, fee 5% → 44\.23¢\) · leg edge 12\.7%$/);
    expect(lines[4]).toBe('  → BUY NOW: 92.36 shares ≈ $40.85');
    expect(lines[5]).toBe('Leg 2: Bayern – Union · Over 10.5 corners @2.2 · kickoff 2026-09-17 21:00');
    expect(lines[6]).toMatch(/no fee \(maker \/ fill price\)/);
    expect(lines[7]).toMatch(/^  → BUY ONLY IF LEG 1 WINS: 189\.47 shares ≈ \$/);
    expect(lines[8]).toMatch(/^Lock \+€\d+\.\d\d \(\d+\.\d% of stake\) · gate \d+\.\d% · total Poly capital \$\d+\.\d\d · XE 1\.147649513$/);
    expect(lines[9]).toMatch(/^Branches: leg 1 fails \+€.* · leg 2 fails \+€.* · all win \+€/);
    expect(lines[10]).toBe('Note: both legs in the same slip');
  });

  it('blank optional fields fall back to "?" and the note line is dropped', () => {
    const t = rollingSummary({ bookie: '', stake: 37.15, slipPayout: null, xe: 1.15, feeRatePct: 5, note: '', legs: [
      { match: '', bet: '', polyHedge: '', kickoff: '', odds: 2.02, priceCents: 43, feeOn: true },
      { match: '', bet: '', polyHedge: '', kickoff: '', odds: 2.2, priceCents: 50, feeOn: true },
    ] }, rollingHedge({ ...EXAMPLE, xe: 1.15, payout: null }));
    expect(t).toMatch(/^Bookie: \? · stake/m);
    expect(t).toMatch(/^Leg 1 \(finishes first\): \? · \? @2\.02$/m);
    expect(t).not.toMatch(/Note:/);
    expect(t).not.toMatch(/slip;/);
  });
});
