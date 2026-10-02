import { describe, it, expect } from 'vitest';
import { sizeDecimalArb, DECIMAL_STEP_EUR } from './calc';

/**
 * Bookie vs bookie — decimal vs decimal (user 2026-10-03: "i need a calculator for regular odds"). Same sizing rule as
 * the live scanner's bookie-vs-bookie rows: leg A fixed (default €10), every other leg sized to pay the same and then
 * rounded to a multiple of €0.10 — floor or ceil, whichever keeps the higher WORST-CASE profit. Odds are test inputs.
 */
const cents = (eur: number) => Math.round(eur * 100);

describe('sizeDecimalArb — stake on leg A', () => {
  it('the worked example: 2.10 vs 2.25, leg A €10 → leg B €9.30 (beats €9.40); exact lock +8.62 %', () => {
    const r = sizeDecimalArb({ odds: [2.1, 2.25], mode: 'lead', amount: 10 });
    expect(r.isLock).toBe(true);
    expect(r.exactProfitPct).toBeCloseTo((1 / (1 / 2.1 + 1 / 2.25) - 1) * 100, 9);
    // exact (unrounded): B = 10·2.10/2.25 = 9.3333…, every outcome returns €21
    expect(r.exact.stakes[1]).toBeCloseTo(9.333333333, 8);
    expect(r.exact.profitEur).toBeCloseTo(21 - 19.333333333, 8);
    // rounded to €0.10
    expect(r.rounded.stakes).toEqual([10, 9.3]);
    expect(r.rounded.returns[1]).toBeCloseTo(20.925, 9);
    expect(r.rounded.worstProfitEur).toBeCloseTo(1.625, 9);        // min(21.00, 20.925) − 19.30
    expect(r.rounded.worstProfitPct).toBeCloseTo((1.625 / 19.3) * 100, 9);
    expect(r.rounded.totalEur).toBeCloseTo(19.3, 9);
    expect(r.rounded.profitsEur[0]).toBeCloseTo(21 - 19.3, 9);       // if A wins
    expect(r.rounded.profitsEur[1]).toBeCloseTo(20.925 - 19.3, 9);   // if B wins
  });
  it('leg A is exactly the amount; every other stake is a whole multiple of €0.10', () => {
    expect(DECIMAL_STEP_EUR).toBe(0.1);
    for (const odds of [[1.57, 3.4], [2.02, 2.05], [3.1, 1.48], [2.6, 3.5, 3.9], [1.9, 4.2, 5.5]]) {
      const r = sizeDecimalArb({ odds, mode: 'lead', amount: 10 });
      expect(r.rounded.stakes[0]).toBe(10);
      for (const s of r.rounded.stakes.slice(1)) expect(cents(s) % 10).toBe(0);
    }
  });
  it('3-way (1X2): legs B and C each try floor and ceil, the best worst case wins', () => {
    const odds = [2.6, 3.5, 3.9];
    const r = sizeDecimalArb({ odds, mode: 'lead', amount: 10 });
    const worst = (st: number[]) => Math.min(...st.map((x, i) => x * odds[i])) - st.reduce((a, b) => a + b, 0);
    let best = -Infinity;
    for (const b of [7.4, 7.5]) for (const c of [6.6, 6.7]) best = Math.max(best, worst([10, b, c]));
    expect(r.rounded.worstProfitEur).toBeCloseTo(best, 9);
    expect(r.exactProfitPct).toBeCloseTo((1 / (1 / 2.6 + 1 / 3.5 + 1 / 3.9) - 1) * 100, 9);
  });
  it('DEAD when Σ 1/o ≥ 1 — still sized, so the loss is visible', () => {
    const r = sizeDecimalArb({ odds: [1.9, 1.9], mode: 'lead', amount: 10 });
    expect(r.isLock).toBe(false);
    expect(r.rounded.stakes).toEqual([10, 10]);
    expect(r.rounded.worstProfitEur).toBeCloseTo(19 - 20, 9);
  });
  it('breakeven for the LAST leg: the lowest odds that still lock against the others', () => {
    const r = sizeDecimalArb({ odds: [2.1, 2.25], mode: 'lead', amount: 10 });
    expect(r.breakevenLast).toBeCloseTo(1 / (1 - 1 / 2.1), 9);    // 1.909…
    const three = sizeDecimalArb({ odds: [2.6, 3.5, 3.9], mode: 'lead', amount: 10 });
    expect(three.breakevenLast).toBeCloseTo(1 / (1 - 1 / 2.6 - 1 / 3.5), 9);
  });
});

describe('sizeDecimalArb — total stake', () => {
  it('€100 across 2.10 / 2.25 → exact 51.72 / 48.28; rounded legs are multiples of €0.10', () => {
    const r = sizeDecimalArb({ odds: [2.1, 2.25], mode: 'total', amount: 100 });
    expect(r.exact.stakes[0]).toBeCloseTo(100 * (1 / 2.1) / (1 / 2.1 + 1 / 2.25), 9); // 51.72
    expect(r.exact.stakes[1]).toBeCloseTo(100 * (1 / 2.25) / (1 / 2.1 + 1 / 2.25), 9); // 48.28
    expect(r.exact.totalEur).toBeCloseTo(100, 9);
    for (const s of r.rounded.stakes) expect(cents(s) % 10).toBe(0);
    expect(r.rounded.stakes[0]).toBe(51.7);
  });
});

describe('sizeDecimalArb — free bet on leg A (stake not returned)', () => {
  it('leg A returns stake × (odds − 1); the others sized to that; only the others are cash', () => {
    const r = sizeDecimalArb({ odds: [3.0, 1.5], mode: 'lead', amount: 10, freeBetLead: true });
    // A wins: 10 × 2 = 20 back, cash spent = B's stake. Exact B = 20 / 1.5 = 13.333…
    expect(r.exact.stakes[1]).toBeCloseTo(13.333333333, 8);
    expect(r.exact.profitEur).toBeCloseTo(20 - 13.333333333, 8);
    expect(r.rounded.stakes[0]).toBe(10);
    expect(r.rounded.totalEur).toBeCloseTo(r.rounded.stakes[1], 9);      // the free bet is not cash
    const b = r.rounded.stakes[1];
    expect(r.rounded.worstProfitEur).toBeCloseTo(Math.min(20, b * 1.5) - b, 9);
    // a free bet always converts: the % is of the free-bet face
    expect(r.isLock).toBe(true);
    expect(r.exactProfitPct).toBeCloseTo(((20 - 13.333333333) / 10) * 100, 6);
  });
});
