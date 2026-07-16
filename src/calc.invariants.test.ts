import { describe, it, expect } from 'vitest';
import {
  FEE_RATES,
  MARKET_TYPES,
  LOCK_THRESHOLD,
  effectivePrice,
  lockTest,
  breakevenNo,
  sizePosition,
  type MarketType,
} from './calc';

// Property / invariant tests: instead of pinning specific numbers, these assert
// relationships that must hold for EVERY valid input, checked over a dense
// deterministic grid. Deterministic (not randomized) so a failure is always
// reproducible and prints the exact offending inputs.
//
// (We hand-roll the sweep rather than pull in fast-check: the input space is
// low-dimensional and a fixed grid is fully reproducible with zero deps. If we
// ever want shrinking on a richer model, fast-check would be the tool to add.)

const ODDS = [1.05, 1.2, 1.5, 1.83, 2.0, 2.55, 2.92, 4.0, 7.5, 20];
const CENTS = [1, 5, 10, 25, 39, 50, 62, 80, 95, 99];
const XES = [1.0, 1.08, 1.14617, 1.2];
const STAKES = [1, 10, 20, 32.5, 100, 500];
const MARKETS = MARKET_TYPES;
const SIDES = [false, true]; // isMaker

/** Iterate the full cartesian grid, calling fn with a labelled context. */
function sweep(
  fn: (ctx: {
    odds: number;
    cents: number;
    market: MarketType;
    isMaker: boolean;
    xe: number;
    stake: number;
    label: string;
  }) => void,
  opts: { xes?: number[]; stakes?: number[] } = {},
) {
  const xes = opts.xes ?? XES;
  const stakes = opts.stakes ?? STAKES;
  for (const odds of ODDS)
    for (const cents of CENTS)
      for (const market of MARKETS)
        for (const isMaker of SIDES)
          for (const xe of xes)
            for (const stake of stakes) {
              const label = `odds=${odds} no=${cents}¢ ${market} ${
                isMaker ? 'maker' : 'taker'
              } xe=${xe} stake=${stake}`;
              fn({ odds, cents, market, isMaker, xe, stake, label });
            }
}

describe('sizePosition invariants (full grid)', () => {
  it('the two profit branches match for a balanced normal bet — everywhere', () => {
    sweep(({ odds, cents, market, isMaker, xe, stake, label }) => {
      const r = sizePosition({
        odds,
        noPrice: cents,
        feeRate: FEE_RATES[market],
        isMaker,
        isFreeBet: false,
        xe,
        stake,
      });
      // Balanced hedge: both outcomes net the same. Allow a sub-cent tolerance
      // scaled to the stake (float noise grows with magnitude).
      const tol = Math.max(1e-6, stake * 1e-9);
      expect(
        Math.abs(r.bookieWinsNet - r.hedgeWinsNet),
        `branches diverged: ${label}`,
      ).toBeLessThan(tol);
    });
  });

  it('the two branches match for a balanced FREE BET — everywhere', () => {
    sweep(({ odds, cents, market, isMaker, xe, stake, label }) => {
      const r = sizePosition({
        odds,
        noPrice: cents,
        feeRate: FEE_RATES[market],
        isMaker,
        isFreeBet: true,
        xe,
        stake,
      });
      const tol = Math.max(1e-6, stake * 1e-9);
      expect(
        Math.abs(r.bookieWinsNet - r.hedgeWinsNet),
        `FB branches diverged: ${label}`,
      ).toBeLessThan(tol);
    });
  });

  it('lockProfit equals min(bookie, hedge) and never exceeds either branch', () => {
    sweep(({ odds, cents, market, isMaker, xe, stake, label }) => {
      const r = sizePosition({
        odds,
        noPrice: cents,
        feeRate: FEE_RATES[market],
        isMaker,
        isFreeBet: false,
        xe,
        stake,
      });
      expect(r.lockProfit, label).toBeCloseTo(
        Math.min(r.bookieWinsNet, r.hedgeWinsNet),
        9,
      );
      expect(r.lockProfit).toBeLessThanOrEqual(r.bookieWinsNet + 1e-9);
      expect(r.lockProfit).toBeLessThanOrEqual(r.hedgeWinsNet + 1e-9);
    });
  });

  it('shares, cost, and pEff are finite and non-negative', () => {
    sweep(({ odds, cents, market, isMaker, xe, stake, label }) => {
      const r = sizePosition({
        odds,
        noPrice: cents,
        feeRate: FEE_RATES[market],
        isMaker,
        isFreeBet: false,
        xe,
        stake,
      });
      for (const [k, v] of Object.entries({
        shares: r.shares,
        hedgeCostUsd: r.hedgeCostUsd,
        pEff: r.pEff,
      })) {
        expect(Number.isFinite(v), `${k} not finite: ${label}`).toBe(true);
        expect(v, `${k} negative: ${label}`).toBeGreaterThanOrEqual(0);
      }
    });
  });

  it('a positive lockProfit exactly coincides with the lock verdict', () => {
    // If it locks, the guaranteed profit is > 0; if dead, it is <= 0.
    // (Uses a modest tolerance around the 0.5% threshold.)
    sweep(
      ({ odds, cents, market, isMaker, xe, stake, label }) => {
        const feeRate = FEE_RATES[market];
        const pEff = effectivePrice(cents / 100, feeRate, isMaker);
        const { isLock } = lockTest(odds, pEff);
        const r = sizePosition({
          odds,
          noPrice: cents,
          feeRate,
          isMaker,
          isFreeBet: false,
          xe,
          stake,
        });
        if (isLock) {
          expect(r.lockProfit, `locked but not profitable: ${label}`).toBeGreaterThan(0);
        } else {
          expect(r.lockProfit, `dead but profitable: ${label}`).toBeLessThanOrEqual(1e-9);
        }
      },
      // profit sign is independent of xe/stake scaling — trim the grid for speed
      { xes: [1.14617], stakes: [20] },
    );
  });

  it('maker is never worse than taker (same inputs)', () => {
    sweep(
      ({ odds, cents, market, xe, stake, label }) => {
        const feeRate = FEE_RATES[market];
        const taker = sizePosition({
          odds, noPrice: cents, feeRate, isMaker: false, isFreeBet: false, xe, stake,
        });
        const maker = sizePosition({
          odds, noPrice: cents, feeRate, isMaker: true, isFreeBet: false, xe, stake,
        });
        expect(maker.hedgeCostUsd, `maker dearer: ${label}`).toBeLessThanOrEqual(
          taker.hedgeCostUsd + 1e-9,
        );
        expect(maker.lockProfit, `maker worse: ${label}`).toBeGreaterThanOrEqual(
          taker.lockProfit - 1e-9,
        );
      },
      { xes: [1.14617], stakes: [20] },
    );
  });
});

describe('breakevenNo invariants (full grid)', () => {
  it('is always within [0, 100]', () => {
    for (const odds of ODDS)
      for (const market of MARKETS)
        for (const isMaker of SIDES) {
          const c = breakevenNo(odds, FEE_RATES[market], isMaker);
          const label = `odds=${odds} ${market} ${isMaker ? 'maker' : 'taker'}`;
          expect(c, `below 0: ${label}`).toBeGreaterThanOrEqual(0);
          expect(c, `above 100: ${label}`).toBeLessThanOrEqual(100);
        }
  });

  it('is the true boundary: locks just below it, dead just above it', () => {
    for (const odds of ODDS)
      for (const market of MARKETS)
        for (const isMaker of SIDES) {
          const feeRate = FEE_RATES[market];
          const c = breakevenNo(odds, feeRate, isMaker);
          const label = `odds=${odds} ${market} ${isMaker ? 'maker' : 'taker'} c=${c}`;

          // Strictly inside (0,100): check both sides of the boundary.
          if (c > 0.5 && c < 99.5) {
            const below = lockTest(odds, effectivePrice((c - 0.3) / 100, feeRate, isMaker));
            const above = lockTest(odds, effectivePrice((c + 0.3) / 100, feeRate, isMaker));
            expect(below.isLock, `should lock below breakeven: ${label}`).toBe(true);
            expect(above.isLock, `should be dead above breakeven: ${label}`).toBe(false);
          }
        }
  });

  it('taker breakeven <= maker breakeven for the same odds/market', () => {
    for (const odds of ODDS)
      for (const market of MARKETS) {
        const feeRate = FEE_RATES[market];
        const taker = breakevenNo(odds, feeRate, false);
        const maker = breakevenNo(odds, feeRate, true);
        expect(taker).toBeLessThanOrEqual(maker + 1e-6);
      }
  });

  it('monotonically non-decreasing in odds', () => {
    for (const market of MARKETS)
      for (const isMaker of SIDES) {
        let prev = -1;
        for (const odds of ODDS) {
          const c = breakevenNo(odds, FEE_RATES[market], isMaker);
          expect(
            c,
            `not monotone in odds at odds=${odds} ${market} ${isMaker}`,
          ).toBeGreaterThanOrEqual(prev - 1e-6);
          prev = c;
        }
      }
  });
});

describe('threshold consistency', () => {
  it('lockTest agrees with a direct comparison against LOCK_THRESHOLD', () => {
    for (const odds of ODDS)
      for (const cents of CENTS)
        for (const market of MARKETS)
          for (const isMaker of SIDES) {
            const pEff = effectivePrice(cents / 100, FEE_RATES[market], isMaker);
            const { test, isLock } = lockTest(odds, pEff);
            expect(isLock).toBe(test > LOCK_THRESHOLD);
          }
  });
});
