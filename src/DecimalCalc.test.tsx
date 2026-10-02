// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { DecimalCalc } from './DecimalCalc';

/**
 * The Bookie vs bookie tab (plan 2026-10-03, Task 6). Defaults: leg A 2.10, leg B 2.25, stake on leg A €10 — the
 * live scanner's worked example. Odds are test inputs.
 */
afterEach(cleanup);
const type = (label: string, v: string) => fireEvent.change(screen.getByLabelText(label), { target: { value: v } });
const result = () => screen.getByTestId('decimal-result').textContent ?? '';

describe('DecimalCalc', () => {
  it('defaults: 2.10 vs 2.25, leg A €10 → leg B €9.30, LOCK +8.62 %, worst case +€1.63 on €19.30', () => {
    render(<DecimalCalc />);
    const t = result();
    expect(t).toContain('LOCK');
    expect(t).toContain('+8.62%');
    expect(t).toContain('€10.00');
    expect(t).toContain('€9.30');
    expect(t).toContain('€21.00');           // leg A returns
    expect(t).toContain('€20.93');           // leg B returns 20.925
    expect(t).toContain('+€1.63');
    expect(t).toContain('€19.30');
    expect(t).toContain('Leg B must be ≥ 1.91');
  });
  it('comma decimals work (mobile keyboards)', () => {
    render(<DecimalCalc />);
    type('Leg A odds', '2,10');
    type('Leg B odds', '2,25');
    expect(result()).toContain('€9.30');
  });
  it('DEAD when the prices do not lock', () => {
    render(<DecimalCalc />);
    type('Leg B odds', '1.80');
    expect(result()).toContain('DEAD');
  });
  it('3-way shows a third odds input and three stake rows', () => {
    render(<DecimalCalc />);
    fireEvent.click(screen.getByText('3-way (1X2)'));
    type('Leg A odds', '2.6');
    type('Leg B odds', '3.5');
    type('Leg C odds', '3.9');
    expect(screen.getAllByLabelText('Copy stake')).toHaveLength(3);
    expect(result()).toContain('Leg C must be ≥');
  });
  it('total-stake mode splits €100', () => {
    render(<DecimalCalc />);
    fireEvent.click(screen.getByText('Total stake'));
    expect(result()).toContain('€51.70');
  });
  it('the stake copy button copies the bare number', async () => {
    let copied = '';
    Object.assign(navigator, { clipboard: { writeText: async (s: string) => { copied = s; } } });
    render(<DecimalCalc />);
    fireEvent.click(screen.getAllByLabelText('Copy stake')[1]);
    await Promise.resolve();
    expect(copied).toBe('9.30');
  });
  it('a free-bet leg A is marked and excluded from the cash', () => {
    render(<DecimalCalc />);
    fireEvent.click(screen.getByLabelText(/Leg A free bet/));
    expect(result()).toContain('A (FB)');
    expect(result()).toContain('of the free bet');
  });
});
