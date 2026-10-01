// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { BoostCalc } from './BoostCalc';
import { breakevenSxOdds } from './calc';

/**
 * The SX panel (user 2026-10-02: "boost tab only, make it a second rectangle maybe? exactly the same but with no
 * inputs"): one extra input — the SX price IN PERCENT (user 2026-10-02: "change everything to be percent"; up to 3
 * decimals, as SX limit orders take them) — and a second results panel driven by the SAME boost odds, stakes and
 * EUR→USD rate. Typed % → decimal odds 100 / %, the maths unchanged. Defaults: boost 2.55, xe 1.16.
 * Numbers (TEST INPUTS): SX 50% → odds 2 → a winning $1 returns 1.99 → €10: payout $29.58 → SX stake 29.58 / 1.99 = $14.86.
 */
afterEach(cleanup);
const setup = (xe = '1.16') => render(<BoostCalc xeStr={xe} setXeStr={() => {}} />);
const typeSx = (v: string) => fireEvent.change(screen.getByLabelText('SX %'), { target: { value: v } });

describe('BoostCalc — the SX panel', () => {
  it('no SX % → no SX panel (the Poly calculator is exactly as before)', () => {
    setup();
    expect(screen.queryByTestId('sx-panel')).toBeNull();
    expect(screen.getByText(/Profitable if NO ≤/)).toBeTruthy();
  });

  it('SX 50% → its own LOCK %, the SX stake per row, the breakeven SX % and "no void tail"', () => {
    setup();
    typeSx('50');
    const panel = screen.getByTestId('sx-panel');
    const t = within(panel);
    expect(t.getByText(/LOCK/)).toBeTruthy();
    expect(panel.textContent).toContain('+26.9%');
    expect(panel.textContent).toContain('$14.86');            // €10: stake on SX
    expect(panel.textContent).toContain('$29.58');            // €10: what the SX bet returns
    expect(panel.textContent).toContain('$29.73');            // €20: 59.16 / 1.99
    expect(panel.textContent).toContain('+€2.69');            // €10 net, both outcomes
    // the highest SX % that still locks, floored to 3 decimals (a rounded-up price would not lock)
    const be = Math.floor((100 / breakevenSxOdds(2.55)) * 1000 + 1e-9) / 1000;
    expect(panel.textContent).toContain(`Profitable if SX ≤ ${be}%`);
    expect(panel.textContent).toContain('50.3¢ with the fee'); // 1 / 1.99 per $1 payout
    expect(panel.textContent).toMatch(/void.*refund/i);
    // the Poly panel is still there, unchanged
    expect(screen.getByText(/Profitable if NO ≤/)).toBeTruthy();
  });

  it('the user\'s Oct 2 bet: 1.94 at €50, SX 46.875%, xe 1.123955265 → $51.38 on SX (the exact 2.1333, not a rounded 2.13)', () => {
    setup('1.123955265');
    fireEvent.change(screen.getByLabelText('Boost odds'), { target: { value: '1.94' } });
    typeSx('46.875');
    const panel = screen.getByTestId('sx-panel');
    // SX custom row defaults to €50: payout 50 · 1.94 · 1.123955265 = $109.02 → / (1 + 0.99 · 1.13333) = $51.38
    expect(panel.textContent).toContain('$109.02');
    expect(panel.textContent).toContain('$51.38');
  });

  it('a 3-decimal SX % is used exactly as typed (SX limit orders take 3 decimals)', () => {
    setup();
    typeSx('46.93');
    // 100 / 46.93 = 2.130833 → €10: 29.58 / (1 + 0.99 · 1.130833) = $13.96. A 0.125% grid would have snapped it to
    // 46.875 ($13.94) or 47 ($13.98) — off-grid prices are placeable, so it must not be snapped
    expect(screen.getByTestId('sx-panel').textContent).toContain('$13.96');
  });

  it('SX % above the breakeven → DEAD, still shown', () => {
    setup();
    typeSx('70');
    expect(screen.getByTestId('sx-panel').textContent).toMatch(/DEAD/);
  });

  it('the SX panel has its OWN custom stake (default €50), independent of the Poly custom row', () => {
    setup();
    typeSx('50');
    const panel = screen.getByTestId('sx-panel');
    const input = within(panel).getByLabelText('SX custom stake in euros') as HTMLInputElement;
    expect(input.value).toBe('50');
    fireEvent.change(input, { target: { value: '30' } });
    // €30 → payout 30·2.55·1.16 = $88.74 → SX stake 88.74 / 1.99 = $44.59
    expect(panel.textContent).toContain('$88.74');
    expect(panel.textContent).toContain('$44.59');
    // the Poly custom row is untouched
    expect((screen.getByLabelText('Custom stake in euros') as HTMLInputElement).value).toBe('50');
  });

  it('the SX stake copies like Poly shares — the bare number, no "$"', async () => {
    let copied = '';
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t: string) => { copied = t; } } });
    setup();
    typeSx('50');
    const buttons = within(screen.getByTestId('sx-panel')).getAllByLabelText('Copy SX stake');
    expect(buttons).toHaveLength(3);                          // €10, €20, custom
    fireEvent.click(buttons[0]);
    await new Promise((r) => setTimeout(r, 0));
    expect(copied).toBe('14.86');                             // €10 at 50%, xe 1.16
  });

  it('Poly and SX sit side by side (Poly left, SX right)', () => {
    setup();
    typeSx('50');
    const cols = screen.getByTestId('hedge-cols');
    expect(cols.className).toContain('two');
    expect(cols.lastElementChild?.getAttribute('data-testid')).toBe('sx-panel');
    expect(cols.firstElementChild?.textContent).toMatch(/Profitable if NO ≤/);
  });

  it('a comma decimal works (mobile), and a % outside 0–100 hides the panel with a hint', () => {
    setup();
    typeSx('46,875');
    // 100 / 46.875 = 2.13333 → €10: 29.58 / 2.122 = $13.94
    expect(screen.getByTestId('sx-panel').textContent).toContain('$13.94');
    typeSx('100');
    expect(screen.queryByTestId('sx-panel')).toBeNull();
    expect(screen.getByText(/SX % must be between 0 and 100/)).toBeTruthy();
    typeSx('0');
    expect(screen.queryByTestId('sx-panel')).toBeNull();
  });
});
