// The plain-text summary of a rolling double — what the user copies and pastes to an AI (or a
// notebook) that records the bet. Written for a READER THAT SAVES AND CONFIRMS, so every fact
// is on its own labelled line, nothing is implied by layout, and the two Poly actions are
// spelled out as instructions ("BUY NOW" / "BUY ONLY IF LEG 1 WINS").

import type { RollingResult } from './rolling';
import { fmtMoneyEur, fmtPct, fmtShares, fmtUsd, roundTo } from './format';

export interface LegInfo {
  /** "Levski – Salzburg" */
  match: string;
  /** "Over 2.5 goals" */
  bet: string;
  /** The Poly market/outcome bought as the hedge: "Levski–Salzburg U2.5 goals" */
  polyHedge: string;
  /** ISO-ish local datetime from a datetime-local input, or ''. */
  kickoff: string;
  odds: number;
  priceCents: number;
  feeOn: boolean;
}

export interface SummaryInfo {
  bookie: string;
  stake: number;
  /** Slip payout typed by the user, or null when the nominal product is used. */
  slipPayout: number | null;
  xe: number;
  feeRatePct: number;
  legs: LegInfo[];
  note: string;
  /** Wall-clock stamp for the header — injectable for tests. */
  now?: Date;
}

const two = (n: number): string => roundTo(n, 2).toFixed(2);
const or = (s: string, fallback: string): string => (s.trim() ? s.trim() : fallback);

function stamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** "2026-09-17T19:45" (datetime-local) → "2026-09-17 19:45"; anything else passes through. */
export function tidyKickoff(s: string): string {
  return s.replace('T', ' ');
}

export function rollingSummary(info: SummaryInfo, r: RollingResult): string {
  const n = info.legs.length;
  const lines: string[] = [];
  lines.push(`ROLLING ${n === 2 ? 'DOUBLE' : `${n}-LEG PARLAY`} — ${stamp(info.now ?? new Date())}`);
  lines.push(
    `Bookie: ${or(info.bookie, '?')} · stake €${two(info.stake)} · payout €${two(r.payout)}`
    + (info.slipPayout != null && Math.abs(r.payout - r.nominalPayout) >= 0.005 ? ` (slip; nominal €${two(r.nominalPayout)})` : '')
    + ` · combined ${roundTo(r.payout / info.stake, 3)}`,
  );
  info.legs.forEach((leg, i) => {
    const lr = r.legs[i];
    const when = leg.kickoff ? ` · kickoff ${tidyKickoff(leg.kickoff)}` : '';
    lines.push(`Leg ${i + 1}${i === 0 ? ' (finishes first)' : ''}: ${or(leg.match, '?')} · ${or(leg.bet, '?')} @${leg.odds}${when}`);
    const fee = leg.feeOn ? `taker, fee ${info.feeRatePct}% → ${roundTo(lr.pEff * 100, 2)}¢` : 'no fee (maker / fill price)';
    lines.push(`  Poly hedge: ${or(leg.polyHedge, '?')} @${leg.priceCents}¢ (${fee}) · leg edge ${fmtPct((lr.gate - 1) * 100)}%`);
    const action = i === 0 ? 'BUY NOW' : `BUY ONLY IF LEG${i === 1 ? ' 1' : `S 1–${i}`} WIN${i === 1 ? 'S' : ''}`;
    lines.push(`  → ${action}: ${fmtShares(lr.shares)} shares ≈ ${fmtUsd(lr.costUsd)}`);
  });
  lines.push(
    `Lock ${fmtMoneyEur(r.lock)} (${fmtPct(r.lockPct * 100)}% of stake) · gate ${fmtPct((r.gate - 1) * 100)}%`
    + ` · total Poly capital ${fmtUsd(r.totalCostUsd)} · XE ${info.xe}`,
  );
  const names = r.branches.map((b, i) => `${i < n ? `leg ${i + 1} fails` : 'all win'} ${fmtMoneyEur(b)}`);
  lines.push(`Branches: ${names.join(' · ')}`);
  if (info.note.trim()) lines.push(`Note: ${info.note.trim()}`);
  return lines.join('\n');
}
