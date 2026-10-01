import { describe, it, expect } from 'vitest';
import { LOCK_THRESHOLD, lockTest, sizeSx, sxCostPerDollar, breakevenSxOdds, SX_TAKER_FEE } from './calc';

/**
 * SX as the hedge (2026-10-02): back the OTHER side on SX at decimal odds D. SX charges takers 1% of the WINNING
 * PROFIT only (SX fee docs), so a winning $1 stake returns 1 + 0.99·(D − 1), and $1 of payout costs 1 / that.
 * The SX stake is sized so the SX win pays exactly the bookie payout — the same balanced hedge as Poly's shares.
 */
const XE = 1.16;

describe('sxCostPerDollar', () => {
  it('1 / (1 + 0.99·(D − 1)) — the fee is on the profit, never the returned stake', () => {
    expect(SX_TAKER_FEE).toBe(0.01);
    expect(sxCostPerDollar(2.05)).toBeCloseTo(1 / 2.0395, 12);
    expect(sxCostPerDollar(2.0)).toBeCloseTo(1 / 1.99, 12);
  });
});

describe('sizeSx — the worked example: €10 at 2.5, SX 2.05, 1.16', () => {
  const r = sizeSx({ odds: 2.5, sxOdds: 2.05, isFreeBet: false, xe: XE, stake: 10 });
  it('the SX win must pay the bookie payout: $29.00 → stake $14.2192 on SX', () => {
    expect(r.payoutUsd).toBeCloseTo(29, 9);
    expect(r.sxStakeUsd).toBeCloseTo(29 / 2.0395, 9);
    expect(r.sxStakeUsd).toBeCloseTo(14.2192, 4);
    // the SX leg really returns the payout: stake back + 99% of the profit
    expect(r.sxStakeUsd + 0.99 * (2.05 - 1) * r.sxStakeUsd).toBeCloseTo(29, 9);
  });
  it('both branches lock the same €2.7421', () => {
    expect(r.bookieWinsNet).toBeCloseTo(r.hedgeWinsNet, 9);
    expect(r.lockProfit).toBeCloseTo(15 - (29 / 2.0395) / XE, 9);
    expect(r.lockProfit).toBeCloseTo(2.7421, 4);
  });
  it('the LOCK % is the same test as Poly\'s, on the SX cost per $1', () => {
    expect(lockTest(2.5, sxCostPerDollar(2.05)).isLock).toBe(true);
    expect(lockTest(2.5, sxCostPerDollar(2.05)).marginPct).toBeCloseTo((2.5 * (1 - 1 / 2.0395) - 1) * 100, 9);
  });
});

describe('sizeSx — free bet (stake not returned)', () => {
  it('sized on odds − 1, and the hedge branch has no −stake', () => {
    const r = sizeSx({ odds: 3, sxOdds: 1.6, isFreeBet: true, xe: XE, stake: 10 });
    expect(r.payoutUsd).toBeCloseTo(10 * 2 * XE, 9);
    expect(r.hedgeWinsNet).toBeCloseTo((r.payoutUsd - r.sxStakeUsd) / XE, 9);
    expect(r.bookieWinsNet).toBeCloseTo(20 - r.sxStakeUsd / XE, 9);
  });
});

describe('breakevenSxOdds — the lowest SX odds that still lock', () => {
  it('at exactly that price the lock test sits on the threshold; just below it does not lock', () => {
    const d = breakevenSxOdds(2.5);
    expect(2.5 * (1 - sxCostPerDollar(d))).toBeCloseTo(LOCK_THRESHOLD, 9);
    expect(lockTest(2.5, sxCostPerDollar(d + 1e-6)).isLock).toBe(true);
    expect(lockTest(2.5, sxCostPerDollar(d - 1e-3)).isLock).toBe(false);
  });
  it('boost odds that can never lock (≤ the threshold) → Infinity', () => {
    expect(breakevenSxOdds(1.005)).toBe(Infinity);
    expect(breakevenSxOdds(1.002)).toBe(Infinity);
  });
});
