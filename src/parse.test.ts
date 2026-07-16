import { describe, it, expect } from 'vitest';
import { parseNum } from './parse';

describe('parseNum — decimal separator', () => {
  it('parses a dot decimal', () => {
    expect(parseNum('2.55')).toBe(2.55);
    expect(parseNum('0.5')).toBe(0.5);
    expect(parseNum('1.146')).toBe(1.146);
  });

  it('parses a COMMA decimal as if it were a dot (the mobile bug)', () => {
    // This is the whole point: European keyboards emit "2,55".
    expect(parseNum('2,55')).toBe(2.55);
    expect(parseNum('0,5')).toBe(0.5);
    expect(parseNum('1,146')).toBe(1.146);
    expect(parseNum('50,')).toBe(50); // trailing comma while typing
    expect(parseNum(',5')).toBe(0.5); // leading comma
  });

  it('parses plain integers', () => {
    expect(parseNum('50')).toBe(50);
    expect(parseNum('10')).toBe(10);
    expect(parseNum('0')).toBe(0);
  });

  it('ignores surrounding whitespace', () => {
    expect(parseNum('  2,55 ')).toBe(2.55);
    expect(parseNum(' 50')).toBe(50);
  });

  it('handles negatives (away from zero)', () => {
    expect(parseNum('-1,5')).toBe(-1.5);
    expect(parseNum('-3.2')).toBe(-3.2);
  });
});

describe('parseNum — invalid / mid-typing input returns null (never NaN)', () => {
  it('returns null for blank', () => {
    expect(parseNum('')).toBeNull();
    expect(parseNum('   ')).toBeNull();
  });

  it('returns null for lone separators / signs mid-typing', () => {
    expect(parseNum('.')).toBeNull();
    expect(parseNum(',')).toBeNull();
    expect(parseNum('-')).toBeNull();
  });

  it('returns null for letters and junk (does NOT silently truncate)', () => {
    // parseFloat("2,55abc") would return 2 — dangerous. We return null instead.
    expect(parseNum('abc')).toBeNull();
    expect(parseNum('2,55abc')).toBeNull();
    expect(parseNum('1.2.3')).toBeNull();
    expect(parseNum('2,5,5')).toBeNull(); // multiple commas -> not a clean number
  });

  it('never returns NaN', () => {
    for (const s of ['', ' ', '.', ',', '-', 'x', '1,2,3', 'e', '1e', 'NaN']) {
      const r = parseNum(s);
      expect(r === null || Number.isFinite(r)).toBe(true);
    }
  });

  it('is robust to non-string input', () => {
    // @ts-expect-error — guard against accidental non-string callers
    expect(parseNum(null)).toBeNull();
    // @ts-expect-error
    expect(parseNum(undefined)).toBeNull();
  });
});
