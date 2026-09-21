// The plain-text block the user copies into an AI / bet log (2026-09-21). Deliberately LEAN
// (user: "the paste can be just a calculation … give me shares to bet and stuff, not too much
// info"): the pasted bet info verbatim, odds, the Poly price, the two share counts with their
// explicit timing, the lock, and a request to verify. Actual fills are pasted back afterwards.

import type { RollingResult } from './rolling';
import { fmtMoneyEur, fmtPct, fmtShares, fmtUsd, roundTo } from './format';

export interface LegInfo {
  /** Free text pasted from the scanner board, verbatim; tabs/newlines collapse to one line. */
  info: string;
  odds: number;
  priceCents: number;
  feeOn: boolean;
}

export interface SummaryInfo {
  stake: number;
  xe: number;
  legs: LegInfo[];
}

const two = (n: number): string => roundTo(n, 2).toFixed(2);

/** A pasted board row arrives tab-separated, sometimes multi-line — one line, single spaces. */
export function tidyInfo(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

export function rollingSummary(info: SummaryInfo, r: RollingResult): string {
  const n = info.legs.length;
  const lines: string[] = [];
  lines.push(`ROLLING ${n === 2 ? 'DOUBLE' : `${n}-LEG PARLAY`} — stake €${two(info.stake)} · payout €${two(r.payout)} · XE ${info.xe}`);
  info.legs.forEach((leg, i) => {
    const lr = r.legs[i];
    lines.push(`Leg ${i + 1}: ${tidyInfo(leg.info) || '?'} @${leg.odds} · Poly opposite @${leg.priceCents}¢ (${leg.feeOn ? 'taker' : 'no fee'})`);
    const action = i === 0 ? 'BUY NOW' : `BUY ONLY IF LEG${i === 1 ? ' 1' : `S 1–${i}`} WIN${i === 1 ? 'S' : ''}`;
    lines.push(`  → ${action}: ${fmtShares(lr.shares)} shares ≈ ${fmtUsd(lr.costUsd)}`);
  });
  lines.push(`Lock ${fmtMoneyEur(r.lock)} on every outcome (${fmtPct(r.lockPct * 100)}% of stake)`);
  lines.push('Please verify all calculations are correct.');
  return lines.join('\n');
}
