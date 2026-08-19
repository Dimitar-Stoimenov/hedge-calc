// Pure math for the Boost Hedge Calculator.
// No React, no I/O — every function here is a pure function of its inputs so the
// Section 3 worked examples can be pinned as unit tests (see calc.test.ts).
//
// Conventions:
//   p     = Polymarket NO ask as a probability (cents / 100), 0..1
//   odds  = enhanced bookie boost coefficient (> 1)
//   xe    = EUR -> USD exchange rate (> 0)
//   stake = bet size in EUR
// "p_eff" (pEff) is the effective per-share price after the Polymarket taker fee.

/** The lock threshold. odds * (1 - pEff) must clear this to be a "lock". */
export const LOCK_THRESHOLD = 1.005;

/**
 * Default EUR → USD exchange rate the UI pre-fills (editable under Advanced).
 * A single source of truth — the app state and its placeholder both read this,
 * so bumping the rate here is the only change needed. Pure-math tests pass their
 * own xe and do NOT depend on this value.
 */
export const DEFAULT_XE = 1.16;

export type MarketType =
  | 'sports'
  | 'politics'
  | 'finance'
  | 'crypto'
  | 'geopolitics';

/** Polymarket fee rate per market type (as of July 2026). */
export const FEE_RATES: Record<MarketType, number> = {
  sports: 0.05,
  politics: 0.04,
  finance: 0.04,
  crypto: 0.07,
  geopolitics: 0.0,
};

export const MARKET_TYPES: readonly MarketType[] = [
  'sports',
  'politics',
  'finance',
  'crypto',
  'geopolitics',
];

/**
 * Per-share Polymarket fee: feeRate * p * (1 - p).
 * Charged on the share price; only taker orders pay it.
 */
export function feePerShare(p: number, feeRate: number): number {
  return feeRate * p * (1 - p);
}

/**
 * Effective per-share price.
 *   taker: p + feeRate * p * (1 - p)
 *   maker: p            (maker orders pay ZERO fee)
 */
export function effectivePrice(
  p: number,
  feeRate: number,
  isMaker: boolean,
): number {
  if (isMaker) return p;
  return p + feePerShare(p, feeRate);
}

export interface LockResult {
  /** odds * (1 - pEff) */
  test: number;
  /** true when test > LOCK_THRESHOLD */
  isLock: boolean;
  /** profit margin as a % of stake ≈ (test - 1) * 100 */
  marginPct: number;
}

/** Lock test + headline margin %. Uses the effective price (pEff), not raw p. */
export function lockTest(odds: number, pEff: number): LockResult {
  const test = odds * (1 - pEff);
  return {
    test,
    isLock: test > LOCK_THRESHOLD,
    marginPct: (test - 1) * 100,
  };
}

/**
 * Breakeven NO price in CENTS — the largest NO ask at which the bet still locks.
 *
 * Maker (no fee): closed form, p_break = 1 - LOCK_THRESHOLD / odds.
 * Taker (fee):    p_eff = p + feeRate*p*(1-p) makes odds*(1-p_eff)=threshold a
 *                 quadratic; we binary-search p in [0, 1] for the largest p that
 *                 still locks (robust, and trivial to get right).
 *
 * Returns cents (0..100). If it locks at every price, returns 100; if it never
 * locks, returns 0.
 */
export function breakevenNo(
  odds: number,
  feeRate: number,
  isMaker: boolean,
): number {
  if (isMaker) {
    const pBreak = 1 - LOCK_THRESHOLD / odds;
    return clamp(pBreak, 0, 1) * 100;
  }

  const locks = (p: number) =>
    lockTest(odds, effectivePrice(p, feeRate, false)).isLock;

  // test is monotonically decreasing in p (higher NO price -> worse), so a plain
  // binary search finds the boundary. If even p=0 doesn't lock, there is none.
  if (!locks(0)) return 0;
  if (locks(1)) return 100;

  let lo = 0; // always locks
  let hi = 1; // never locks
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (locks(mid)) lo = mid;
    else hi = mid;
  }
  return lo * 100;
}

export interface SizeInput {
  odds: number;
  /** Polymarket NO ask in CENTS (0..100) */
  noPrice: number;
  feeRate: number;
  isMaker: boolean;
  isFreeBet: boolean;
  /** EUR -> USD rate */
  xe: number;
  /** stake in EUR (for a free bet, the free-bet face value) */
  stake: number;
}

export interface SizeResult {
  /** Polymarket shares to buy (fractional — never round for sizing) */
  shares: number;
  /** USD cost of the hedge = shares * pEff */
  hedgeCostUsd: number;
  /** effective per-share price used */
  pEff: number;
  /** net EUR profit if the bookie side wins */
  bookieWinsNet: number;
  /** net EUR profit if the hedge (Polymarket NO) side wins */
  hedgeWinsNet: number;
  /** the guaranteed profit = min of the two branches (they match when balanced) */
  lockProfit: number;
}

/**
 * Size a balanced hedge and compute both profit branches.
 *
 * Balanced shares:
 *   normal:  shares = stake * odds * xe
 *   free bet: shares = stake * (odds - 1) * xe   (SNR — stake not returned)
 *
 * Net profit (EUR):
 *   hedge_cost_eur = hedgeCostUsd / xe
 *   normal:
 *     bookieWinsNet = stake*(odds-1) - hedge_cost_eur
 *     hedgeWinsNet  = -stake + (shares - hedgeCostUsd)/xe
 *   free bet (SNR): same bookie branch, but the hedge branch drops the -stake
 *   term (the free bet was never our money):
 *     hedgeWinsNet  = (shares - hedgeCostUsd)/xe
 */
export function sizePosition(input: SizeInput): SizeResult {
  const { odds, noPrice, feeRate, isMaker, isFreeBet, xe, stake } = input;
  const p = noPrice / 100;
  const pEff = effectivePrice(p, feeRate, isMaker);

  const shares = isFreeBet
    ? stake * (odds - 1) * xe
    : stake * odds * xe;

  const hedgeCostUsd = shares * pEff;
  const hedgeCostEur = hedgeCostUsd / xe;

  const bookieWinsNet = stake * (odds - 1) - hedgeCostEur;
  const hedgeWinsNet = isFreeBet
    ? (shares - hedgeCostUsd) / xe
    : -stake + (shares - hedgeCostUsd) / xe;

  return {
    shares,
    hedgeCostUsd,
    pEff,
    bookieWinsNet,
    hedgeWinsNet,
    lockProfit: Math.min(bookieWinsNet, hedgeWinsNet),
  };
}

/**
 * A VOIDED Polymarket market resolves 50-50 — every share pays $0.50, whichever side
 * you hold. (Cancelled game, abandoned match, a market Poly declares non-resolvable.)
 */
export const VOID_RESOLUTION_PRICE = 0.5;

/** Above this NO price a void hurts enough to be worth a hard look before firing. */
export const VOID_WATCH_PRICE_CENTS = 60;

export interface VoidTailResult {
  /**
   * EUR P&L if the market VOIDS. POSITIVE = a void COSTS you that much;
   * NEGATIVE = a void PAYS you (you bought the hedge below 50¢).
   */
  tailEur: number;
  /**
   * The tail as a MULTIPLE OF STAKE — an instant read on how bad the shape is
   * (a €10 stake carrying a €43 tail is 4.3×). Stake-independent.
   */
  tailPerStake: number;
  /**
   * BREAKEVEN VOID PROBABILITY = LOCK / (LOCK + TAIL). If the real void chance
   * exceeds this, the position is −EV. Stake-independent (lock and tail both scale
   * linearly with stake, so the ratio doesn't move).
   *
   * `null` when the question doesn't apply: a void that PAYS you (tail ≤ 0) can never
   * make the position −EV, and a position with no lock (≤ 0) is already −EV without
   * any void at all.
   */
  breakevenVoidProb: number | null;
}

/**
 * The VOID TAIL of a sized position.
 *
 * WHY IT EXISTS: the lock math assumes the market resolves to one side or the other.
 * On a VOID it resolves 50-50, the bookie returns the stake, and the hedge leg alone
 * decides the outcome — so you keep $0.50 per share against whatever you paid. Buy the
 * hedge at 89.5¢ and a void hands back 50¢: a 39.5¢-per-share loss that the headline
 * "LOCK +x%" says nothing about.
 *
 *   tail_eur = shares × (pricePaid − 0.50) / xe
 *
 * Since `shares` already carries the xe factor, THE EXCHANGE RATE CANCELS and this is
 * exactly `stake × odds × (pricePaid − 0.50)` for a normal bet (and
 * `stake × (odds − 1) × (…)` for a free bet, whose hedge is sized on odds−1). Deriving
 * it from `shares` keeps ONE source of truth for both bet types instead of restating
 * the sizing rule here.
 *
 * `pricePaid` is `pEff` — the NET price per share actually paid, fee included, which is
 * precisely `hedgeCostUsd / shares`. Using the raw order-book price would understate the
 * tail (a taker pays the fee whether the market voids or not).
 *
 * BOOKIE SIDE ASSUMPTION: a void returns the stake (normal bet) or the free bet is
 * re-credited/voided (SNR) — either way it contributes 0, so the tail is the hedge leg
 * alone. A bookie that KEEPS the stake on a void would add `stake` on top; no bookie in
 * scope does that.
 */
export function voidTail(size: SizeResult, stake: number, xe: number): VoidTailResult {
  const tailEur = (size.shares * (size.pEff - VOID_RESOLUTION_PRICE)) / xe;
  const lock = size.lockProfit;
  const breakevenVoidProb =
    tailEur > 0 && lock > 0 ? lock / (lock + tailEur) : null;
  return {
    tailEur,
    tailPerStake: stake > 0 ? tailEur / stake : 0,
    breakevenVoidProb,
  };
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}
