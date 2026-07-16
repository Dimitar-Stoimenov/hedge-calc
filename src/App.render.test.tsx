import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import App from './App';

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

  it('shows €20 shares = 58.45 and €10 shares = 29.22', () => {
    // App default XE = 1.146: 20*2.55*1.146 = 58.446 -> 58.45 ; 10*2.55*1.146 = 29.223 -> 29.22
    expect(h).toMatch(/58\.45/);
    expect(h).toMatch(/29\.22/);
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
    // custom €50 shares: 50*2.55*1.146 = 146.11499… -> 146.11 (genuinely below the half)
    expect(h).toMatch(/146\.11/);
  });

  it('shows the Taker segment active and defaults market to Sports', () => {
    expect(h).toMatch(/class="seg on">Taker/);
    expect(h).toMatch(/<option value="sports" selected[^>]*>Sports/);
  });

  it('uses a real U+2212 minus sign nowhere-positive default (no ASCII hyphen in money)', () => {
    // All default figures are positive here, so there should be no minus at all
    // in the results section — guards against a stray hyphen from a formatter.
    const results = h.slice(h.indexOf('class="results"'));
    expect(results).not.toMatch(/[−-]€/);
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
