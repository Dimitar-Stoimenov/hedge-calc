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

// ─── SX AS THE HEDGE (2026-10-02) ─────────────────────────────────────────────────────────────────
// Back the OTHER side on SX Bet (an exchange) at decimal odds D instead of buying Poly NO. SX charges a
// taker 1% of the WINNING PROFIT only (SX fee docs; makers 0%, a losing bet pays nothing), so a winning
// $1 stake returns 1 + 0.99·(D − 1). The SX stake is sized so that win pays exactly the bookie payout —
// the same balanced hedge as Poly's shares, with "$1 of payout" playing the role of one share.

/** SX's taker fee, a fraction of the winning profit. */
export const SX_TAKER_FEE = 0.01;

/** What $1 of payout costs on SX at decimal odds D: 1 / (1 + 0.99·(D − 1)). The lock test's pEff. */
export function sxCostPerDollar(sxOdds: number): number {
  return 1 / (1 + (1 - SX_TAKER_FEE) * (sxOdds - 1));
}

export interface SxSizeInput {
  odds: number;
  /** SX decimal odds for backing the other side (> 1) */
  sxOdds: number;
  isFreeBet: boolean;
  /** EUR -> USD rate */
  xe: number;
  /** stake in EUR (for a free bet, the free-bet face value) */
  stake: number;
}

export interface SxSizeResult {
  /** USD the SX bet must return = the bookie payout (normal: stake·odds·xe; free bet: stake·(odds−1)·xe) */
  payoutUsd: number;
  /** USD to stake on SX at sxOdds */
  sxStakeUsd: number;
  /** cost per $1 of payout (fee included) */
  costPerDollar: number;
  bookieWinsNet: number;
  hedgeWinsNet: number;
  lockProfit: number;
}

/** Size a balanced SX hedge — sizePosition's formulas with the SX cost per $1 in place of Poly's pEff. */
export function sizeSx(input: SxSizeInput): SxSizeResult {
  const { odds, sxOdds, isFreeBet, xe, stake } = input;
  const costPerDollar = sxCostPerDollar(sxOdds);
  const payoutUsd = isFreeBet ? stake * (odds - 1) * xe : stake * odds * xe;
  const sxStakeUsd = payoutUsd * costPerDollar;
  const bookieWinsNet = stake * (odds - 1) - sxStakeUsd / xe;
  const hedgeWinsNet = isFreeBet
    ? (payoutUsd - sxStakeUsd) / xe
    : -stake + (payoutUsd - sxStakeUsd) / xe;
  return { payoutUsd, sxStakeUsd, costPerDollar, bookieWinsNet, hedgeWinsNet, lockProfit: Math.min(bookieWinsNet, hedgeWinsNet) };
}

/**
 * The LOWEST SX odds that still lock. Closed form: lock ⇔ odds·(1 − c) ≥ LOCK_THRESHOLD ⇔ c ≤ 1 − LOCK_THRESHOLD/odds,
 * and c = 1/(1 + 0.99·(D − 1)) ⇔ D = 1 + (1/c − 1)/0.99. Infinity when no SX price can lock (odds ≤ the threshold).
 */
export function breakevenSxOdds(odds: number): number {
  const cMax = 1 - LOCK_THRESHOLD / odds;
  if (!(cMax > 0)) return Infinity;
  return 1 + (1 / cMax - 1) / (1 - SX_TAKER_FEE);
}

// ─── BOOKIE vs BOOKIE — DECIMAL vs DECIMAL (2026-10-03) ──────────────────────────────────────────
// Back every outcome of one market at two (or three, 1X2) bookies. Euro only, no fees, no FX. The SAME sizing rule as
// the live scanner's bookie-vs-bookie rows (user 2026-10-03): leg A is fixed (default €10); every other leg is sized to
// pay the same and then ROUNDED TO A MULTIPLE OF €0.10 — floor or ceil, whichever keeps the higher WORST-CASE profit.

/** Every non-lead stake is a whole multiple of this. */
export const DECIMAL_STEP_EUR = 0.1;

export interface DecimalArbInput {
  /** decimal odds per leg, leg A first */
  odds: number[];
  /** 'lead' = `amount` is leg A's stake (the free-bet face with freeBetLead); 'total' = `amount` is the total CASH */
  mode: 'lead' | 'total';
  amount: number;
  /** leg A is a free bet: its stake is not returned (it returns stake × (odds − 1)) and is not cash */
  freeBetLead?: boolean;
}

export interface DecimalArbSizing {
  stakes: number[];
  /** what each leg returns if it wins */
  returns: number[];
  /** net profit on each outcome (that leg wins) */
  profitsEur: number[];
  /** cash staked (a free-bet leg A excluded) */
  totalEur: number;
}

export interface DecimalArbResult {
  isLock: boolean;
  /** the exact (unrounded) lock: of the cash staked, or of the free-bet face with freeBetLead */
  exactProfitPct: number;
  exact: DecimalArbSizing & { profitEur: number };
  rounded: DecimalArbSizing & { worstProfitEur: number; worstProfitPct: number };
  /** the LOWEST odds for the last leg that still lock against the others (Infinity = none can) */
  breakevenLast: number;
}

/** Size a decimal-odds arb; see the section note above for the rounding rule. */
export function sizeDecimalArb(input: DecimalArbInput): DecimalArbResult {
  const { odds, mode, amount } = input;
  const fb = input.freeBetLead === true;
  // Per-unit payout of each leg: a free-bet leg A pays only its winnings.
  const pay = odds.map((o, i) => (fb && i === 0 ? o - 1 : o));
  const cashLegs = odds.map((_, i) => !(fb && i === 0));

  const size = (stakes: number[]): DecimalArbSizing => {
    const returns = stakes.map((s, i) => s * pay[i]);
    const totalEur = stakes.reduce((t, s, i) => t + (cashLegs[i] ? s : 0), 0);
    return { stakes, returns, profitsEur: returns.map((r) => r - totalEur), totalEur };
  };

  // EXACT: every outcome returns the same R.
  let lead: number;
  if (mode === 'lead') lead = amount;
  else {
    // total CASH = R · Σ_{cash legs} 1/payᵢ  →  R = amount / that sum; leg A = R / pay_A
    const inv = pay.reduce((t, p, i) => t + (cashLegs[i] ? 1 / p : 0), 0);
    lead = amount / inv / pay[0];
  }
  const R = lead * pay[0];
  const exactSizing = size(pay.map((p) => R / p));
  const exactProfitEur = R - exactSizing.totalEur;

  // ROUNDED: leg A as typed ('lead') or to the nearest €0.10 ('total'); the others floor/ceil to €0.10, every
  // combination tried, the higher worst case wins (a tie keeps the smaller outlay).
  const step = Math.round(DECIMAL_STEP_EUR * 100);
  const leadC = mode === 'lead' ? lead * 100 : Math.max(step, Math.round((lead * 100) / step) * step);
  const options: number[][] = [[leadC]];
  for (let i = 1; i < odds.length; i++) {
    const ideal = (leadC * pay[0]) / pay[i];
    const lo = Math.max(step, Math.floor(ideal / step + 1e-9) * step);
    options.push(lo >= ideal - 1e-9 ? [lo] : [lo, lo + step]);
  }
  let best: { sizing: DecimalArbSizing; worst: number } | null = null;
  const walk = (i: number, picked: number[]) => {
    if (i === options.length) {
      const sizing = size(picked.map((c) => c / 100));
      const worst = Math.min(...sizing.profitsEur);
      if (!best || worst > best.worst + 1e-9 || (Math.abs(worst - best.worst) <= 1e-9 && sizing.totalEur < best.sizing.totalEur)) best = { sizing, worst };
      return;
    }
    for (const c of options[i]) { picked.push(c); walk(i + 1, picked); picked.pop(); }
  };
  walk(0, []);
  const b = best as unknown as { sizing: DecimalArbSizing; worst: number };
  const base = fb ? b.sizing.stakes[0] : b.sizing.totalEur;

  // Lock iff the CASH per unit of balanced return is below one unit (a free-bet leg A costs nothing, so it is left out).
  const k = pay.reduce((t, p, i) => t + (cashLegs[i] ? 1 / p : 0), 0);
  const isLock = k < 1;
  // Breakeven last leg: Σ over the OTHER cash legs + 1/o_last = 1.
  const others = pay.slice(0, -1).reduce((t, p, i) => t + (cashLegs[i] ? 1 / p : 0), 0);
  const breakevenLast = others < 1 ? 1 / (1 - others) : Infinity;

  return {
    isLock,
    exactProfitPct: fb ? (exactProfitEur / lead) * 100 : (1 / k - 1) * 100,
    exact: { ...exactSizing, profitEur: exactProfitEur },
    rounded: { ...b.sizing, worstProfitEur: b.worst, worstProfitPct: base > 0 ? (b.worst / base) * 100 : 0 },
    breakevenLast,
  };
}
