import { describe, it, expect } from 'vitest';
import {
  roundTo,
  fmtShares,
  fmtUsd,
  fmtMoneyEur,
  fmtPct,
  fmtCents,
} from './format';

// These tests exist mainly to pin the HALF-CENT ROUNDING behavior. JS's toFixed
// rounds off the IEEE-754 binary value and gets several exact-half decimals
// "wrong" for a money UI (e.g. (8.575).toFixed(2) === "8.57"). Our Intl-based
// helpers must round half away from zero. If anyone swaps them back to toFixed,
// the boundary cases below fail loudly.

describe('roundTo — half away from zero', () => {
  it('rounds the classic toFixed-failure boundaries UP', () => {
    // Sanity: document what toFixed does, then assert we do better.
    expect((8.575).toFixed(2)).toBe('8.57'); // the bug we are avoiding
    expect(roundTo(8.575, 2)).toBe(8.58);
    expect(roundTo(1.005, 2)).toBe(1.01);
    expect(roundTo(35.855, 2)).toBe(35.86);
    expect(roundTo(1.255, 2)).toBe(1.26);
    expect(roundTo(2.675, 2)).toBe(2.68);
  });

  it('is symmetric for negatives (away from zero)', () => {
    expect(roundTo(-8.575, 2)).toBe(-8.58);
    expect(roundTo(-1.005, 2)).toBe(-1.01);
    expect(roundTo(-2.5, 0)).toBe(-3);
  });

  it('rounds exact halves up at 0 dp', () => {
    expect(roundTo(0.5, 0)).toBe(1);
    expect(roundTo(1.5, 0)).toBe(2);
    expect(roundTo(2.5, 0)).toBe(3); // NOT banker's rounding (which would give 2)
  });

  it('leaves already-short values untouched', () => {
    expect(roundTo(58.45, 2)).toBe(58.45);
    expect(roundTo(10, 2)).toBe(10);
    expect(roundTo(0, 2)).toBe(0);
  });

  it('handles more decimals', () => {
    expect(roundTo(58.4547, 2)).toBe(58.45);
    expect(roundTo(58.4567, 2)).toBe(58.46);
    expect(roundTo(0.12345, 4)).toBe(0.1235);
  });

  it('passes through non-finite values', () => {
    expect(Number.isNaN(roundTo(NaN, 2))).toBe(true);
    expect(roundTo(Infinity, 2)).toBe(Infinity);
    expect(roundTo(-Infinity, 2)).toBe(-Infinity);
  });
});

describe('fmtShares', () => {
  it('always shows 2 dp, no sign, no grouping', () => {
    expect(fmtShares(58.4547)).toBe('58.45');
    expect(fmtShares(20)).toBe('20.00');
    expect(fmtShares(1234.5)).toBe('1234.50'); // no thousands separator
  });

  it('rounds half up at the boundary', () => {
    expect(fmtShares(0.005)).toBe('0.01');
    expect(fmtShares(148.995)).toBe('149.00');
  });

  it('renders a dash for non-finite input', () => {
    expect(fmtShares(NaN)).toBe('—');
    expect(fmtShares(Infinity)).toBe('—');
  });
});

describe('fmtUsd', () => {
  it('prefixes $ and shows 2 dp', () => {
    expect(fmtUsd(29.96)).toBe('$29.96');
    expect(fmtUsd(0)).toBe('$0.00');
    expect(fmtUsd(120.394)).toBe('$120.39');
    expect(fmtUsd(120.395)).toBe('$120.40'); // boundary up
  });

  it('renders a dash for non-finite input', () => {
    expect(fmtUsd(NaN)).toBe('—');
  });
});

describe('fmtMoneyEur — signed, real minus sign', () => {
  it('prefixes + for non-negative', () => {
    expect(fmtMoneyEur(4.86)).toBe('+€4.86');
    expect(fmtMoneyEur(0)).toBe('+€0.00');
    expect(fmtMoneyEur(12.155)).toBe('+€12.16'); // boundary up
  });

  it('uses a U+2212 minus (not a hyphen) for negatives', () => {
    expect(fmtMoneyEur(-1.2)).toBe('−€1.20');
    expect(fmtMoneyEur(-1.2).charCodeAt(0)).toBe(0x2212);
    expect(fmtMoneyEur(-1.2).includes('-')).toBe(false); // no ASCII hyphen
  });

  it('never shows a negative zero', () => {
    // -0.004 rounds to 0.00 — must render as +€0.00, not −€0.00.
    expect(fmtMoneyEur(-0.004)).toBe('+€0.00');
    expect(fmtMoneyEur(-0)).toBe('+€0.00');
  });

  it('renders a dash for non-finite input', () => {
    expect(fmtMoneyEur(NaN)).toBe('—');
  });
});

describe('fmtPct / fmtCents', () => {
  it('fmtPct is 1 dp by default, no sign', () => {
    expect(fmtPct(24.3125)).toBe('24.3');
    expect(fmtPct(9.46)).toBe('9.5');
    expect(fmtPct(-3.5)).toBe('−3.5'); // Intl adds the minus for negatives
  });

  it('fmtPct honors a custom precision', () => {
    expect(fmtPct(24.3125, 2)).toBe('24.31');
    expect(fmtPct(5, 0)).toBe('5');
  });

  it('fmtCents is 1 dp', () => {
    expect(fmtCents(59.44)).toBe('59.4');
    expect(fmtCents(64.436)).toBe('64.4');
    expect(fmtCents(100)).toBe('100.0');
  });

  it('both render a dash for non-finite input', () => {
    expect(fmtPct(NaN)).toBe('—');
    expect(fmtCents(Infinity)).toBe('—');
  });
});
