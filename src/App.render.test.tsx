import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import App from './App';
import { DEFAULT_XE } from './calc';

// Renders the real <App/> with its default inputs (Example A: odds 2.55, NO 50¢,
// sports, taker) and asserts the calc wires through to the displayed strings.
// This guards the JSX wiring; the arithmetic itself is covered in calc.test.ts.
function html() {
  return renderToStaticMarkup(<App />);
}

describe('App (default Example-A inputs)', () => {
  const h = html();

  it('shows the LOCK verdict with +24.3%', () => {
    expect(h).toMatch(/LOCK/);
    expect(h).toMatch(/\+24\.3%/);
    expect(h).not.toMatch(/DEAD/);
  });

  it('shows €20 shares = 59.16 and €10 shares = 29.58', () => {
    // Shares scale LINEARLY with DEFAULT_XE, so these literals move whenever the default rate
    // does. At DEFAULT_XE = 1.16 (bumped 2026-08-19): 20*2.55*1.16 = 59.16, 10*2.55*1.16 = 29.58.
    // Derived from DEFAULT_XE below rather than hardcoded twice, so the next bump only needs
    // calc.ts changed.
    const per10 = 10 * 2.55 * DEFAULT_XE;
    expect(h).toContain((per10 * 2).toFixed(2)); // €20 row
    expect(h).toContain(per10.toFixed(2));       // €10 row
  });

  it('shows USD hedge costs and a positive net profit', () => {
    expect(h).toMatch(/\$\d+\.\d{2}/);
    // €20 branch nets ~ +€4.86
    expect(h).toMatch(/\+€4\.8[0-9]/);
  });

  it('shows the breakeven line for taker', () => {
    expect(h).toMatch(/Profitable if NO ≤/);
    expect(h).toMatch(/\(taker\)/);
  });

  it('shows the depth-check note (custom €50 order exceeds $50)', () => {
    expect(h).toMatch(/Depth check/);
  });

  it('renders the green lock pill (not the dead pill)', () => {
    expect(h).toMatch(/class="pill lock"/);
    expect(h).not.toMatch(/class="pill dead"/);
  });

  it('renders all three stake rows (€10, €20, custom €50)', () => {
    expect(h).toMatch(/>€10</);
    expect(h).toMatch(/>€20</);
    // custom row carries an input defaulted to 50
    expect(h).toMatch(/aria-label="Custom stake in euros"[^>]*value="50"/);
    // custom €50 shares, same linear scaling: 50*2.55*1.16 = 147.90
    expect(h).toContain((50 * 2.55 * DEFAULT_XE).toFixed(2));
  });

  it('shows the Taker segment active and defaults market to Sports', () => {
    expect(h).toMatch(/class="seg on">Taker/);
    expect(h).toMatch(/<option value="sports" selected[^>]*>Sports/);
  });

  it('uses a real U+2212 minus sign, never an ASCII hyphen, in money', () => {
    const results = h.slice(h.indexOf('class="results"'));
    // The PROFIT/COST figures are all positive at the default inputs, so no minus
    // may appear on them — guards against a stray hyphen from a formatter.
    for (const cell of results.match(/class="col-profit[^"]*">[^<]*/g) ?? []) {
      expect(cell).not.toMatch(/[−-]€/);
    }
    // The VOID TAIL is legitimately negative here (2026-08-17): at a 50¢ book the
    // TAKER FEE lifts the net price paid above 50¢, so a void costs a little —
    // 10 × 2.55 × (0.5125 − 0.50) = €0.32. What matters is the character used.
    expect(results).toMatch(/class="col-void[^"]*">−€0\.32/);
    expect(results).not.toMatch(/-€/); // ASCII hyphen: never
  });

  it('numeric inputs use type=text + inputmode=decimal (mobile comma-key fix)', () => {
    // type="number" makes some mobile browsers reject/clear a comma decimal.
    // Every data input must be type=text with inputmode=decimal so the numeric
    // keypad still shows but the browser stops fighting the separator.
    const inputs = h.match(/<input[^>]*>/g) ?? [];
    // React preserves the camelCase property name (inputMode) in the markup.
    const decimals = inputs.filter((t) => /inputmode="decimal"/i.test(t));
    // odds, NO price, custom stake are always rendered (XE is behind Advanced).
    expect(decimals.length).toBeGreaterThanOrEqual(3);
    for (const t of decimals) {
      expect(t).toMatch(/type="text"/);
      expect(t).not.toMatch(/type="number"/);
    }
    // and there should be no leftover type=number anywhere
    expect(h).not.toMatch(/type="number"/);
  });
});

// ── VOID TAIL (2026-08-17) ───────────────────────────────────────────────────────
// A void resolves the market 50-50, so the hedge leg alone decides it — the LOCK %
// above says nothing about that damage. Both verdict figures are stake-independent
// (lock and tail scale together), which is why one line covers the whole table.
describe('void tail (default Example-A inputs: 2.55 @ 50¢, sports taker)', () => {
  const h = html();

  it('shows the tail as a multiple of stake and the breakeven void chance', () => {
    // pEff = 0.50 + 5%·0.50·0.50 = 0.5125, so even a 50¢ book carries a small tail:
    // multiple = 2.55 × 0.0125 = 0.031875 → "0.03× stake".
    expect(h).toMatch(/Void tail <strong>0\.03× stake<\/strong>/);
    expect(h).toMatch(/−EV if void chance &gt; <strong>8\d\.\d%<\/strong>/);
  });

  it('does NOT flag the amber watch state at 50¢ (only above 60¢)', () => {
    expect(h).toMatch(/class="void-tail "/);
    expect(h).not.toMatch(/void-warn/);
  });

  it('adds a Void tail column to the results table', () => {
    expect(h).toMatch(/<th>Void tail<\/th>/);
    // signed like a P&L: a void COSTS €0.32 on the €10 row → shown negative
    expect(h).toMatch(/class="col-void mono neg">−€0\.32/);
  });
});
