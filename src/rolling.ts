// Pure math for the ROLLING HEDGE of a bookie parlay (double, or N legs).
//
// Spec: docs "Two-Leg Rolling Hedge Calculator" (2026-09-21). The parlay is hedged on
// Polymarket ONE LEG AT A TIME: the leg-k hedge is bought only if every earlier leg won. Share
// counts are chosen so that EVERY branch (leg 1 fails; leg 1 wins & leg 2 fails; …; all win)
// pays the same profit.
//
// Sized from the LAST leg backward:
//   N_last = P · XE                       shares of the last leg's opposite token
//   C_k    = N_k · pe(p_k)                USD cost of leg k's hedge
//   N_k    = N_{k+1} − C_{k+1}            each hedge is the NEXT hedge minus the next hedge's cost
//
// Why N_k = N_{k+1} − C_{k+1}: compare "leg k fails" (you hold N_k paying $1 each and you never
// spend C_{k+1}) with "leg k wins, leg k+1 fails" (you spend C_{k+1} and collect N_{k+1}). Equal
// exactly when N_k = N_{k+1} − C_{k+1}.
//
// Conventions match calc.ts: prices are probabilities 0..1 internally, cents at the edges;
// pe(p) = p + feeRate·p·(1−p) is the taker's effective price (calc.effectivePrice); a maker
// order, or a fill price pasted from the activity log (fee already inside), skips the fee.

import { effectivePrice, LOCK_THRESHOLD } from './calc';

export interface RollingLegInput {
  /** Bookie decimal odds of this leg (> 1). */
  odds: number;
  /** Poly price of the OPPOSITE side of this leg, in CENTS, before fee (0..100). */
  priceCents: number;
  /** false = maker order, or a fill price that already includes the fee → no fee applied. */
  feeOn: boolean;
}

export interface RollingInput {
  /** Bookie stake in EUR. */
  stake: number;
  /** Legs in CHRONOLOGICAL order — leg 0 is the match that FINISHES first. */
  legs: RollingLegInput[];
  /** Polymarket fee rate (calc.FEE_RATES), applied to legs with feeOn. */
  feeRate: number;
  /** EUR → USD. */
  xe: number;
  /**
   * The slip's payout in EUR, when it differs from stake·∏odds (bookies round the combined
   * coefficient). The slip is what actually pays, so it wins when given.
   */
  payout?: number | null;
}

export interface RollingLegResult {
  /** Shares of this leg's opposite token to buy (fractional; display rounds). */
  shares: number;
  /** USD cost of that hedge. */
  costUsd: number;
  /** Effective per-share price actually paid (fee included when feeOn). */
  pEff: number;
  /** This leg's own edge: odds · (1 − pEff). > 1 means the leg carries edge. */
  gate: number;
}

export interface RollingResult {
  legs: RollingLegResult[];
  /** EUR payout used (slip figure when given, else stake·∏odds). */
  payout: number;
  /** stake · ∏odds — shown next to the slip figure so a rounding gap is visible. */
  nominalPayout: number;
  /**
   * Profit (EUR) of every branch, in order: leg 1 fails, leg 1 wins & leg 2 fails, …, all legs
   * win. They agree to rounding when payout === nominalPayout; a slip that pays more than
   * nominal lifts the all-win branch only.
   */
  branches: number[];
  /** min(branches) — the guaranteed profit in EUR. */
  lock: number;
  /** lock / stake. */
  lockPct: number;
  /** ∏ leg gates. > 1 → positive expectancy after hedge costs; lockPct ≈ gate − 1. */
  gate: number;
  /** Total USD needed if every hedge fires. */
  totalCostUsd: number;
  /** Same verdict rule as the single-boost calculator: gate must clear LOCK_THRESHOLD. */
  isLock: boolean;
}

/**
 * Size every leg of a rolling hedge and evaluate every branch. Pure; throws on nothing —
 * callers validate inputs (odds > 1, 0 < price < 100, xe > 0, stake > 0) before calling.
 */
export function rollingHedge(input: RollingInput): RollingResult {
  const { stake, legs, feeRate, xe } = input;
  const nominalPayout = legs.reduce((acc, l) => acc * l.odds, stake);
  const payout = input.payout != null && input.payout > 0 ? input.payout : nominalPayout;

  const pEffs = legs.map((l) => effectivePrice(l.priceCents / 100, feeRate, !l.feeOn));

  // Backward pass: the last leg's hedge must return the whole payout in USD.
  const shares: number[] = new Array(legs.length).fill(0);
  const costs: number[] = new Array(legs.length).fill(0);
  let next = payout * xe;
  for (let k = legs.length - 1; k >= 0; k--) {
    shares[k] = next;
    costs[k] = shares[k] * pEffs[k];
    next = shares[k] - costs[k];
  }

  // Branches. "Leg k fails" = every earlier leg won (so hedges 0..k were bought), leg k's
  // tokens pay $1 each, the bookie pays nothing.
  const branches: number[] = [];
  let spentUsd = 0;
  for (let k = 0; k < legs.length; k++) {
    spentUsd += costs[k];
    branches.push(-stake - spentUsd / xe + shares[k] / xe);
  }
  branches.push(payout - stake - spentUsd / xe); // all legs win: bookie pays, every token dies

  const legResults: RollingLegResult[] = legs.map((l, k) => ({
    shares: shares[k],
    costUsd: costs[k],
    pEff: pEffs[k],
    gate: l.odds * (1 - pEffs[k]),
  }));
  const gate = legResults.reduce((acc, l) => acc * l.gate, 1);
  const lock = Math.min(...branches);

  return {
    legs: legResults,
    payout,
    nominalPayout,
    branches,
    lock,
    lockPct: stake > 0 ? lock / stake : 0,
    gate,
    totalCostUsd: spentUsd,
    isLock: gate > LOCK_THRESHOLD,
  };
}

// ── chronology helpers ────────────────────────────────────────────────────────────────────

/** How long after kick-off a leg's market is settled, by market kind (spec §Chronology). */
export const LEG_END_MINUTES = {
  'full-time': 115,
  'first-half': 55,
  'early': 15, // "first goal" / "to score first": can resolve within minutes — 15 is a cautious guess
} as const;
export type LegEndKind = keyof typeof LEG_END_MINUTES;

export interface SlackResult {
  /** Minutes from leg-1's estimated END to leg-2's kick-off. Negative = the games overlap. */
  slackMin: number;
  /** Leg 2 kicks off BEFORE leg 1 — the legs are in the wrong order for a rolling hedge. */
  wrongOrder: boolean;
}

/**
 * Slack between leg 1 ending and leg 2 starting. The whole strategy needs leg 1 to be
 * settled before leg 2's hedge has to be bought, so a negative slack is a real warning:
 * the leg-2 hedge would have to be bought at in-play prices, or blind.
 */
export function legSlack(kickoff1Ms: number, kickoff2Ms: number, leg1Ends: LegEndKind): SlackResult {
  const end1 = kickoff1Ms + LEG_END_MINUTES[leg1Ends] * 60_000;
  return { slackMin: (kickoff2Ms - end1) / 60_000, wrongOrder: kickoff2Ms < kickoff1Ms };
}
