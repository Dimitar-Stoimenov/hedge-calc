// Input parsing for the calculator.
//
// The reason this is its own module: on most of Europe the decimal separator is
// a COMMA, so mobile numeric keyboards emit "2,55" rather than "2.55". Plain
// Number("2,55") is NaN and parseFloat("2,55") is a silent 2 — either way a money
// app would show the wrong figure or nothing. parseNum accepts both separators.

/**
 * Parse a user-entered decimal to a finite Number, or null if blank/invalid.
 *
 * Accepts either separator:
 *   "2.55" -> 2.55
 *   "2,55" -> 2.55   (comma treated as the decimal point)
 * A leading/trailing space is ignored. A lone "-" / "." / "," (mid-typing) is
 * treated as "not a number yet" (null), so the UI simply shows no result rather
 * than flashing NaN while the user is still typing.
 */
export function parseNum(s: string): number | null {
  if (typeof s !== 'string') return null;
  const trimmed = s.trim();
  if (trimmed === '') return null;

  // Normalize the decimal separator: comma -> dot. Prices here never use a
  // thousands separator (values are like 2.55, 50, 1.146), so a single comma is
  // always the decimal point.
  const normalized = trimmed.replace(',', '.');

  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}
