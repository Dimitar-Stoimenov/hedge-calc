// Display formatting for the calculator.
//
// Why this module exists: JavaScript's Number.prototype.toFixed rounds off the
// IEEE-754 *binary* value, which rounds some exact-half decimals the "wrong" way
// for a money UI:
//     (8.575).toFixed(2) === "8.57"   // a naive reader expects 8.58
//     (1.005).toFixed(2) === "1.00"
// Intl.NumberFormat with roundingMode "halfExpand" (round half away from zero)
// gives the calculator-intuitive result and needs no dependency.
//
// NOTE: these format for *display only*. The calc (calc.ts) keeps full float
// precision and never rounds before comparing or before feeding one result into
// another. The residual float error there is ~1e-13 — far below a cent — so an
// arbitrary-precision decimal library (decimal.js/big.js/dinero) buys nothing in
// v1. Revisit that decision if the §7 multi-row LEDGER lands: summing many bets
// is real accumulation, and big.js would be the right, tiny tool for it.

function fixedFormatter(minmax: number): Intl.NumberFormat {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: minmax,
    maximumFractionDigits: minmax,
    roundingMode: 'halfExpand',
    useGrouping: false,
  });
}

const money2 = fixedFormatter(2);

/** The real minus sign (U+2212) we show instead of Intl's ASCII hyphen-minus. */
const MINUS = '−';

/**
 * Format with `dp` decimals and replace Intl's ASCII hyphen-minus with a real
 * U+2212 minus, so every negative in the UI uses the same glyph.
 */
function fmtFixed(n: number, dp: number): string {
  return fixedFormatter(dp).format(n).replace('-', MINUS);
}

/**
 * Round half-away-from-zero to `dp` decimals and return a Number.
 * Correct at exact-half boundaries where toFixed is not: roundTo(8.575, 2) === 8.58.
 * Implemented on top of the same Intl formatter used for display, so the numeric
 * value and the displayed string never disagree at a boundary.
 */
export function roundTo(n: number, dp: number): number {
  if (!Number.isFinite(n)) return n;
  // Parse back the plain (hyphen) form — Number() does not accept U+2212.
  return Number(fixedFormatter(dp).format(n));
}

/** "58.45" — shares, 2 dp, no sign, no grouping. Never rounds for sizing (display only). */
export function fmtShares(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return money2.format(n);
}

/** "$29.96" — USD amount, 2 dp. */
export function fmtUsd(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return `$${money2.format(n)}`;
}

/**
 * "+€4.86" / "−€1.20" — signed EUR amount with a real minus sign (U+2212).
 * The sign and magnitude are both derived from the SAME rounded value, so we
 * never show e.g. "−€0.00": a value that rounds to zero is treated as +€0.00.
 */
export function fmtMoneyEur(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const rounded = roundTo(n, 2);
  const nonNeg = rounded === 0 ? 0 : rounded; // collapse -0
  const sign = nonNeg >= 0 ? '+' : '−';
  return `${sign}€${money2.format(Math.abs(nonNeg))}`;
}

/** "24.3" — a percentage to 1 dp. Positive has no sign; negative uses U+2212. */
export function fmtPct(n: number, dp = 1): string {
  if (!Number.isFinite(n)) return '—';
  return fmtFixed(n, dp);
}

/** "59.4" — cents to 1 dp for the breakeven line (always ≥ 0 in practice). */
export function fmtCents(n: number, dp = 1): string {
  if (!Number.isFinite(n)) return '—';
  return fmtFixed(n, dp);
}
