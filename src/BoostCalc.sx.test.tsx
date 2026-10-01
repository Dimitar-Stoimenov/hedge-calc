// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { BoostCalc } from './BoostCalc';
import { breakevenSxOdds } from './calc';

/**
 * The SX panel (user 2026-10-02: "boost tab only, make it a second rectangle maybe? exactly the same but with no
 * inputs"): one extra input — SX odds (decimal) — and a second results panel driven by the SAME boost odds, stakes and
 * EUR→USD rate. Defaults: boost 2.55, xe 1.16. Numbers: €10 → payout $29.58 → SX stake 29.58 / 2.0395 = $14.50.
 */
afterEach(cleanup);
const setup = () => render(<BoostCalc xeStr="1.16" setXeStr={() => {}} />);
const typeSx = (v: string) => fireEvent.change(screen.getByLabelText('SX odds'), { target: { value: v } });

describe('BoostCalc — the SX panel', () => {
  it('no SX odds → no SX panel (the Poly calculator is exactly as before)', () => {
    setup();
    expect(screen.queryByTestId('sx-panel')).toBeNull();
    expect(screen.getByText(/Profitable if NO ≤/)).toBeTruthy();
  });

  it('SX odds 2.05 → its own LOCK %, the SX stake per row, the breakeven SX odds and "no void tail"', () => {
    setup();
    typeSx('2.05');
    const panel = screen.getByTestId('sx-panel');
    const t = within(panel);
    expect(t.getByText(/LOCK/)).toBeTruthy();
    expect(panel.textContent).toContain('+30.0%');
    expect(panel.textContent).toContain('$14.50');            // €10: stake on SX
    expect(panel.textContent).toContain('$29.58');            // €10: what the SX bet returns
    expect(panel.textContent).toContain('$29.01');            // €20: 59.16 / 2.0395
    expect(panel.textContent).toContain('+€3.00');            // €10 net, both outcomes
    expect(panel.textContent).toContain(`Profitable if SX odds ≥ ${breakevenSxOdds(2.55).toFixed(3)}`);
    expect(panel.textContent).toMatch(/void.*refund/i);
    // the Poly panel is still there, unchanged
    expect(screen.getByText(/Profitable if NO ≤/)).toBeTruthy();
  });

  it('SX odds below the breakeven → DEAD, still shown', () => {
    setup();
    typeSx('1.5');
    const panel = screen.getByTestId('sx-panel');
    expect(panel.textContent).toMatch(/DEAD/);
  });

  it('the SX panel has its OWN custom stake (default €50), independent of the Poly custom row', () => {
    setup();
    typeSx('2.05');
    const panel = screen.getByTestId('sx-panel');
    const input = within(panel).getByLabelText('SX custom stake in euros') as HTMLInputElement;
    expect(input.value).toBe('50');
    fireEvent.change(input, { target: { value: '30' } });
    // €30 → payout 30·2.55·1.16 = $88.74 → SX stake 88.74 / 2.0395 = $43.51
    expect(panel.textContent).toContain('$88.74');
    expect(panel.textContent).toContain('$43.51');
    // the Poly custom row is untouched
    expect((screen.getByLabelText('Custom stake in euros') as HTMLInputElement).value).toBe('50');
  });

  it('Poly and SX sit side by side (Poly left, SX right)', () => {
    setup();
    typeSx('2.05');
    const cols = screen.getByTestId('hedge-cols');
    expect(cols.className).toContain('two');
    expect(cols.lastElementChild?.getAttribute('data-testid')).toBe('sx-panel');
    expect(cols.firstElementChild?.textContent).toMatch(/Profitable if NO ≤/);
  });

  it('a comma decimal works (mobile), and odds ≤ 1 hide the panel with a hint', () => {
    setup();
    typeSx('2,05');
    expect(screen.getByTestId('sx-panel').textContent).toContain('$14.50');
    typeSx('1');
    expect(screen.queryByTestId('sx-panel')).toBeNull();
    expect(screen.getByText(/SX odds must be greater than 1/)).toBeTruthy();
  });
});
