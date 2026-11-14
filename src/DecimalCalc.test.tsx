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
  it('TWO-WAY only (user 2026-10-03: "remove the calc 3 way") — no 3-way toggle, no third leg, two stake rows', () => {
    render(<DecimalCalc />);
    expect(screen.queryByText(/3-way/)).toBeNull();
    expect(screen.queryByLabelText('Leg C odds')).toBeNull();
    expect(screen.getAllByLabelText('Copy stake')).toHaveLength(2);
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

describe('DecimalCalc — a leg in dollars (user 2026-11-15: "dollars conversion for cloudbet. input to stay always eur … a toggle")', () => {
  // rate 1.16 is a test input (the app passes its live EUR→USD rate)
  const R = () => render(<DecimalCalc xeStr="1.16" setXeStr={() => {}} />);
  it('every leg has a € / $ switch; € by default, so nothing changes until $ is picked', () => {
    R();
    expect(screen.getByRole('button', { name: 'Leg A in euros' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Leg B in dollars' }).getAttribute('aria-pressed')).toBe('false');
    expect(result()).toContain('€9.30');
    expect(screen.queryByLabelText('EUR → USD rate')).toBeNull();
  });
  it('leg B in $: its stake is shown and COPIED in dollars ($0.10 step), the € value beside it; the stake input stays €', async () => {
    let copied = '';
    Object.assign(navigator, { clipboard: { writeText: async (s: string) => { copied = s; } } });
    R();
    fireEvent.click(screen.getByRole('button', { name: 'Leg B in dollars' }));
    const t = result();
    expect(t).toContain('$10.80');
    expect(t).toContain('≈ €9.31');
    expect(screen.getByText('Stake on leg A €')).toBeTruthy();
    fireEvent.click(screen.getAllByLabelText('Copy stake')[1]);
    await Promise.resolve();
    expect(copied).toBe('10.80');
  });
  it('the rate field appears with a dollar leg and drives the sizing', () => {
    R();
    fireEvent.click(screen.getByRole('button', { name: 'Leg B in dollars' }));
    expect((screen.getByLabelText('EUR → USD rate') as HTMLInputElement).value).toBe('1.16');
  });
  it('no usable rate → a hint, and the dollar leg falls back to € sizing', () => {
    render(<DecimalCalc xeStr="" setXeStr={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Leg B in dollars' }));
    expect(screen.getByText(/EUR → USD rate needed/)).toBeTruthy();
    expect(result()).toContain('€9.30');
  });
});
