import { describe, it, expect } from 'vitest';
import {
  FEE_RATES,
  MARKET_TYPES,
  LOCK_THRESHOLD,
  effectivePrice,
  feePerShare,
  lockTest,
  breakevenNo,
  sizePosition,
  type MarketType,
} from './calc';

// Exchange rate used by the Section 3 worked examples.
const XE = 1.14617;
const sportsFee = FEE_RATES.sports; // 0.05

describe('effectivePrice / feePerShare', () => {
  it('taker fee is feeRate * p * (1 - p)', () => {
    expect(feePerShare(0.5, sportsFee)).toBeCloseTo(0.0125, 6);
    expect(effectivePrice(0.5, sportsFee, false)).toBeCloseTo(0.5125, 6);
  });

  it('maker pays zero fee (pEff === p)', () => {
    expect(effectivePrice(0.5, sportsFee, true)).toBe(0.5);
    expect(effectivePrice(0.39, sportsFee, true)).toBe(0.39);
  });
});

describe('Example A — CSKA ULTRA (odds 2.55, NO 50¢, sports taker)', () => {
  const odds = 2.55;
  const pEff = effectivePrice(0.5, sportsFee, false);

  it('locks at +24.3%', () => {
    const r = lockTest(odds, pEff);
    expect(pEff).toBeCloseTo(0.5125, 6);
    expect(r.test).toBeCloseTo(1.243125, 5);
    expect(r.isLock).toBe(true);
    expect(r.marginPct).toBeCloseTo(24.31, 2);
  });

  it('€20 stake: ~58.45 shares, ~$29.96 cost, ~€4.86 locked profit', () => {
    const r = sizePosition({
      odds,
      noPrice: 50,
      feeRate: sportsFee,
      isMaker: false,
      isFreeBet: false,
      xe: XE,
      stake: 20,
    });
    expect(r.shares).toBeCloseTo(58.45, 2);
    expect(r.hedgeCostUsd).toBeCloseTo(29.96, 2);
    // both branches match for a balanced normal bet
    expect(r.bookieWinsNet).toBeCloseTo(r.hedgeWinsNet, 6);
    expect(r.lockProfit).toBeCloseTo(4.86, 2);
  });
});

describe('Example B — thin lock (odds 1.83, NO 39¢, sports taker)', () => {
  const odds = 1.83;
  const pEff = effectivePrice(0.39, sportsFee, false);

  it('locks at +9.5%', () => {
    const r = lockTest(odds, pEff);
    expect(pEff).toBeCloseTo(0.4019, 4);
    expect(r.test).toBeCloseTo(1.0946, 3);
    expect(r.isLock).toBe(true);
    expect(r.marginPct).toBeCloseTo(9.46, 1);
  });

  it('€10 stake: ~20.97 shares, ~$8.43 cost', () => {
    const r = sizePosition({
      odds,
      noPrice: 39,
      feeRate: sportsFee,
      isMaker: false,
      isFreeBet: false,
      xe: XE,
      stake: 10,
    });
    // 10 * 1.83 * 1.14617 = 20.9749 -> 20.97 (plan prints 20.98, a rounding slip).
    expect(r.shares).toBeCloseTo(20.9749, 3);
    expect(r.hedgeCostUsd).toBeCloseTo(8.43, 2);
    expect(r.bookieWinsNet).toBeCloseTo(r.hedgeWinsNet, 6);
  });
});

describe('Example C — DEAD (odds 2.62, NO 62¢, sports taker)', () => {
  it('does not lock', () => {
    const pEff = effectivePrice(0.62, sportsFee, false);
    const r = lockTest(2.62, pEff);
    expect(pEff).toBeCloseTo(0.6318, 4);
    expect(r.test).toBeCloseTo(0.9647, 3);
    expect(r.isLock).toBe(false);
    expect(r.marginPct).toBeLessThan(0);
  });
});

describe('Example D — Free bet SNR (odds 5.00, NO 80¢, FB €32.50, sports taker)', () => {
  it('~149.00 shares, ~$120.39 cost, ~+€24.9 extracted', () => {
    const r = sizePosition({
      odds: 5.0,
      noPrice: 80,
      feeRate: sportsFee,
      isMaker: false,
      isFreeBet: true,
      xe: XE,
      stake: 32.5,
    });
    expect(r.pEff).toBeCloseTo(0.808, 4);
    // 32.5 * (5-1) * 1.14617 = 149.00. The plan prints 148.80 / $120.23, which
    // corresponds to XE ~= 1.14462; at the stated XE = 1.14617 it is 149.00 / $120.39.
    expect(r.shares).toBeCloseTo(149.0, 1);
    expect(r.hedgeCostUsd).toBeCloseTo(120.39, 1);
    // hedge branch has no -stake term for a free bet: (149.00 - 120.39)/1.14617 = 24.96
    // (plan quotes "+€24.9", ~77% extraction of the €32.50 face value).
    expect(r.hedgeWinsNet).toBeCloseTo(24.96, 1);
    // both branches still match (balanced)
    expect(r.bookieWinsNet).toBeCloseTo(r.hedgeWinsNet, 4);
  });

  it('is not a lock via the free-bet share formula compared to a normal bet', () => {
    // sanity: a normal bet at these odds/price would size much bigger
    const normal = sizePosition({
      odds: 5.0,
      noPrice: 80,
      feeRate: sportsFee,
      isMaker: false,
      isFreeBet: false,
      xe: XE,
      stake: 32.5,
    });
    expect(normal.shares).toBeGreaterThan(
      sizePosition({
        odds: 5.0,
        noPrice: 80,
        feeRate: sportsFee,
        isMaker: false,
        isFreeBet: true,
        xe: XE,
        stake: 32.5,
      }).shares,
    );
  });
});

describe('breakevenNo', () => {
  it('Example E — odds 2.92 sports taker: ~64.4¢', () => {
    // Exact quadratic solution is 64.44¢; the plan quotes "~64.2¢" as an estimate.
    expect(breakevenNo(2.92, sportsFee, false)).toBeCloseTo(64.44, 1);
  });

  it('at the breakeven price the bet is right at the lock threshold', () => {
    const odds = 2.92;
    const cents = breakevenNo(odds, sportsFee, false);
    const pEff = effectivePrice(cents / 100, sportsFee, false);
    expect(lockTest(odds, pEff).test).toBeCloseTo(1.005, 3);
  });

  it('maker closed form: 1 - threshold/odds', () => {
    const odds = 2.0;
    // 1 - 1.005/2 = 0.4975 -> 49.75¢
    expect(breakevenNo(odds, sportsFee, true)).toBeCloseTo(49.75, 3);
  });

  it('geopolitics (no fee) taker == maker breakeven', () => {
    const odds = 2.5;
    const taker = breakevenNo(odds, FEE_RATES.geopolitics, false);
    const maker = breakevenNo(odds, FEE_RATES.geopolitics, true);
    expect(taker).toBeCloseTo(maker, 3);
  });

  it('zero-fee market with huge odds locks at every price -> 100¢', () => {
    // With no fee, pEff = p, and at p=1 the test is odds*(1-1)=0 — still not a lock.
    // But the maker/zero-fee closed form 1 - 1.005/odds clamps to ~100¢ for huge odds.
    expect(breakevenNo(100000, FEE_RATES.geopolitics, true)).toBeCloseTo(100, 2);
  });

  it('taker with a fee never quite reaches 100¢ even at huge odds', () => {
    // fee = 0.05*p*(1-p) -> 0 as p->1, but the boundary sits just under 100¢.
    const c = breakevenNo(1000, sportsFee, false);
    expect(c).toBeLessThan(100);
    expect(c).toBeGreaterThan(99);
  });

  it('odds barely above 1 never lock -> 0¢', () => {
    // odds=1.001, best case p->0 gives test ~1.001 < 1.005
    expect(breakevenNo(1.001, sportsFee, false)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Fee table — every market type, both order sides.
// ---------------------------------------------------------------------------
describe('FEE_RATES table', () => {
  it('matches the plan (July 2026)', () => {
    expect(FEE_RATES.sports).toBe(0.05);
    expect(FEE_RATES.politics).toBe(0.04);
    expect(FEE_RATES.finance).toBe(0.04);
    expect(FEE_RATES.crypto).toBe(0.07);
    expect(FEE_RATES.geopolitics).toBe(0.0);
  });

  it('MARKET_TYPES lists exactly the keys of FEE_RATES', () => {
    expect([...MARKET_TYPES].sort()).toEqual(
      (Object.keys(FEE_RATES) as MarketType[]).sort(),
    );
  });
});

describe('feePerShare', () => {
  it('is feeRate * p * (1 - p) for each market at p = 0.5', () => {
    // p*(1-p) = 0.25 at p=0.5, so fee = feeRate * 0.25
    expect(feePerShare(0.5, FEE_RATES.sports)).toBeCloseTo(0.0125, 6);
    expect(feePerShare(0.5, FEE_RATES.politics)).toBeCloseTo(0.01, 6);
    expect(feePerShare(0.5, FEE_RATES.crypto)).toBeCloseTo(0.0175, 6);
    expect(feePerShare(0.5, FEE_RATES.geopolitics)).toBe(0);
  });

  it('is zero at the endpoints p=0 and p=1 (no fee on a certainty)', () => {
    for (const rate of Object.values(FEE_RATES)) {
      expect(feePerShare(0, rate)).toBe(0);
      expect(feePerShare(1, rate)).toBeCloseTo(0, 12);
    }
  });

  it('is maximised at p=0.5 and symmetric about it', () => {
    const rate = FEE_RATES.crypto;
    expect(feePerShare(0.5, rate)).toBeGreaterThan(feePerShare(0.3, rate));
    expect(feePerShare(0.5, rate)).toBeGreaterThan(feePerShare(0.7, rate));
    // symmetry: fee(p) === fee(1-p)
    expect(feePerShare(0.3, rate)).toBeCloseTo(feePerShare(0.7, rate), 12);
  });
});

describe('effectivePrice', () => {
  it('taker adds the fee, maker does not, for every market', () => {
    const p = 0.42;
    for (const m of MARKET_TYPES) {
      const rate = FEE_RATES[m];
      expect(effectivePrice(p, rate, true)).toBe(p); // maker: exact, zero fee
      expect(effectivePrice(p, rate, false)).toBeCloseTo(
        p + feePerShare(p, rate),
        12,
      );
    }
  });

  it('taker >= maker always (fee is non-negative)', () => {
    for (const p of [0.05, 0.2, 0.5, 0.8, 0.95]) {
      expect(effectivePrice(p, FEE_RATES.crypto, false)).toBeGreaterThanOrEqual(
        effectivePrice(p, FEE_RATES.crypto, true),
      );
    }
  });

  it('geopolitics taker equals maker (no fee)', () => {
    for (const p of [0.1, 0.5, 0.9]) {
      expect(effectivePrice(p, FEE_RATES.geopolitics, false)).toBe(
        effectivePrice(p, FEE_RATES.geopolitics, true),
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Lock test — threshold boundary behaviour.
// ---------------------------------------------------------------------------
describe('lockTest threshold', () => {
  it('LOCK_THRESHOLD is 1.005', () => {
    expect(LOCK_THRESHOLD).toBe(1.005);
  });

  it('is strictly greater-than: exactly at threshold is DEAD', () => {
    // pick pEff so odds*(1-pEff) == 1.005 exactly-ish
    const odds = 2;
    const pEffAtThreshold = 1 - LOCK_THRESHOLD / odds; // 0.4975
    const atThreshold = lockTest(odds, pEffAtThreshold);
    expect(atThreshold.test).toBeCloseTo(1.005, 12);
    expect(atThreshold.isLock).toBe(false); // > 1.005 required, not >=

    // a hair below the price (better) locks
    expect(lockTest(odds, pEffAtThreshold - 0.001).isLock).toBe(true);
    // a hair above the price (worse) is dead
    expect(lockTest(odds, pEffAtThreshold + 0.001).isLock).toBe(false);
  });

  it('marginPct is (test - 1) * 100 and negative when dead', () => {
    const r = lockTest(2.62, 0.6318); // Example C-ish -> dead
    expect(r.marginPct).toBeCloseTo((r.test - 1) * 100, 9);
    expect(r.marginPct).toBeLessThan(0);
  });

  it('higher effective price monotonically lowers the test', () => {
    const odds = 2.2;
    let prev = Infinity;
    for (const pEff of [0.3, 0.4, 0.5, 0.6, 0.7]) {
      const t = lockTest(odds, pEff).test;
      expect(t).toBeLessThan(prev);
      prev = t;
    }
  });
});

// ---------------------------------------------------------------------------
// sizePosition — across markets and both order sides.
// ---------------------------------------------------------------------------
describe('sizePosition — normal bet', () => {
  const base = {
    odds: 2.2,
    noPrice: 45,
    isFreeBet: false,
    xe: XE,
    stake: 20,
  };

  it('the two branches match for a balanced hedge in EVERY market, taker & maker', () => {
    for (const m of MARKET_TYPES) {
      for (const isMaker of [false, true]) {
        const r = sizePosition({ ...base, feeRate: FEE_RATES[m], isMaker });
        expect(r.bookieWinsNet).toBeCloseTo(r.hedgeWinsNet, 9);
        // lockProfit is the min of the two (they match, so it equals both)
        expect(r.lockProfit).toBeCloseTo(r.bookieWinsNet, 9);
      }
    }
  });

  it('maker sizes the same shares as taker (shares = stake*odds*xe, fee-free)', () => {
    const t = sizePosition({ ...base, feeRate: FEE_RATES.sports, isMaker: false });
    const m = sizePosition({ ...base, feeRate: FEE_RATES.sports, isMaker: true });
    expect(t.shares).toBeCloseTo(m.shares, 9); // shares don't depend on the fee
    expect(t.shares).toBeCloseTo(base.stake * base.odds * XE, 9);
  });

  it('maker is cheaper and more profitable than taker (no fee paid)', () => {
    const t = sizePosition({ ...base, feeRate: FEE_RATES.sports, isMaker: false });
    const m = sizePosition({ ...base, feeRate: FEE_RATES.sports, isMaker: true });
    expect(m.hedgeCostUsd).toBeLessThan(t.hedgeCostUsd);
    expect(m.lockProfit).toBeGreaterThan(t.lockProfit);
  });

  it('geopolitics taker == maker (no fee, so identical)', () => {
    const t = sizePosition({ ...base, feeRate: FEE_RATES.geopolitics, isMaker: false });
    const m = sizePosition({ ...base, feeRate: FEE_RATES.geopolitics, isMaker: true });
    expect(t.hedgeCostUsd).toBeCloseTo(m.hedgeCostUsd, 12);
    expect(t.lockProfit).toBeCloseTo(m.lockProfit, 12);
  });

  it('scales linearly with stake', () => {
    const r10 = sizePosition({ ...base, feeRate: FEE_RATES.sports, isMaker: false, stake: 10 });
    const r20 = sizePosition({ ...base, feeRate: FEE_RATES.sports, isMaker: false, stake: 20 });
    expect(r20.shares).toBeCloseTo(2 * r10.shares, 9);
    expect(r20.hedgeCostUsd).toBeCloseTo(2 * r10.hedgeCostUsd, 9);
    expect(r20.lockProfit).toBeCloseTo(2 * r10.lockProfit, 9);
  });

  it('pEff on the result equals effectivePrice of the inputs', () => {
    const r = sizePosition({ ...base, feeRate: FEE_RATES.crypto, isMaker: false });
    expect(r.pEff).toBeCloseTo(
      effectivePrice(base.noPrice / 100, FEE_RATES.crypto, false),
      12,
    );
  });
});

describe('sizePosition — free bet (SNR)', () => {
  const base = {
    odds: 5.0,
    noPrice: 80,
    feeRate: FEE_RATES.sports,
    isMaker: false,
    isFreeBet: true,
    xe: XE,
    stake: 32.5,
  };

  it('sizes fewer shares than the equivalent normal bet (odds-1 vs odds)', () => {
    const fb = sizePosition(base);
    const normal = sizePosition({ ...base, isFreeBet: false });
    expect(fb.shares).toBeCloseTo(base.stake * (base.odds - 1) * XE, 9);
    expect(fb.shares).toBeLessThan(normal.shares);
    // ratio is (odds-1)/odds
    expect(fb.shares / normal.shares).toBeCloseTo(
      (base.odds - 1) / base.odds,
      9,
    );
  });

  it('the two branches still match (balanced), with no -stake on the hedge branch', () => {
    const r = sizePosition(base);
    expect(r.bookieWinsNet).toBeCloseTo(r.hedgeWinsNet, 6);
    // free-bet hedge branch = (shares - cost)/xe, i.e. NO "-stake" term
    expect(r.hedgeWinsNet).toBeCloseTo(
      (r.shares - r.hedgeCostUsd) / XE,
      9,
    );
  });

  it('extracts more of the face value than a normal bet keeps', () => {
    // The whole point of a free bet: you keep a large fraction of the face.
    const r = sizePosition(base);
    expect(r.lockProfit).toBeGreaterThan(0);
    expect(r.lockProfit / base.stake).toBeGreaterThan(0.5); // >50% extraction here
  });
});

// ---------------------------------------------------------------------------
// breakevenNo — properties across the whole surface.
// ---------------------------------------------------------------------------
describe('breakevenNo properties', () => {
  const oddsList = [1.5, 1.83, 2.0, 2.55, 2.92, 4.0, 10.0];

  it('taker breakeven is always <= maker breakeven (fee eats into it)', () => {
    for (const odds of oddsList) {
      const taker = breakevenNo(odds, FEE_RATES.sports, false);
      const maker = breakevenNo(odds, FEE_RATES.sports, true);
      expect(taker).toBeLessThanOrEqual(maker + 1e-6);
    }
  });

  it('higher odds give a higher (more forgiving) breakeven', () => {
    let prev = -1;
    for (const odds of oddsList) {
      const c = breakevenNo(odds, FEE_RATES.sports, false);
      expect(c).toBeGreaterThan(prev);
      prev = c;
    }
  });

  it('a higher fee lowers the taker breakeven', () => {
    const odds = 2.55;
    const lowFee = breakevenNo(odds, FEE_RATES.politics, false); // 0.04
    const highFee = breakevenNo(odds, FEE_RATES.crypto, false); // 0.07
    expect(highFee).toBeLessThan(lowFee);
  });

  it('at the taker breakeven, sizing a bet nets ~zero (right at the edge)', () => {
    const odds = 2.55;
    const cents = breakevenNo(odds, FEE_RATES.sports, false);
    const r = sizePosition({
      odds,
      noPrice: cents,
      feeRate: FEE_RATES.sports,
      isMaker: false,
      isFreeBet: false,
      xe: XE,
      stake: 20,
    });
    // threshold is 1.005 (0.5% margin), so profit at breakeven ~ 0.5% of stake, tiny.
    expect(Math.abs(r.lockProfit)).toBeLessThan(0.2);
  });

  it('maker closed form matches for several odds', () => {
    for (const odds of oddsList) {
      const expected = (1 - LOCK_THRESHOLD / odds) * 100;
      expect(breakevenNo(odds, FEE_RATES.sports, true)).toBeCloseTo(
        Math.max(0, Math.min(100, expected)),
        6,
      );
    }
  });

  it('is bounded to [0, 100] for extreme inputs', () => {
    expect(breakevenNo(1.0001, FEE_RATES.crypto, false)).toBeGreaterThanOrEqual(0);
    expect(breakevenNo(1e6, FEE_RATES.crypto, false)).toBeLessThanOrEqual(100);
    expect(breakevenNo(1e6, FEE_RATES.geopolitics, true)).toBeLessThanOrEqual(100);
  });
});
