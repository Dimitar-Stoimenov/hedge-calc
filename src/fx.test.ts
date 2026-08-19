import { describe, it, expect, vi } from 'vitest';
import { fetchEurUsd, fxMessage, FX_SOURCES, tidyAsOf } from './fx';
import { DEFAULT_XE } from './calc';

/**
 * FX lookup. The risks worth pinning are all about a BAD rate reaching the calculator, since
 * every euro figure on the page is multiplied by it:
 *  - an inverted quote (USD→EUR ≈ 0.86) or a zero must be rejected, not applied;
 *  - a dead source must fall through to the next rather than failing the whole lookup;
 *  - total failure must return null so the caller keeps DEFAULT_XE and SAYS so.
 */
const res = (body: unknown, ok = true) =>
  ({ ok, json: async () => body }) as unknown as Response;

describe('fetchEurUsd', () => {
  it('reads the primary source (fxratesapi shape)', async () => {
    const f = (async () => res({ rates: { USD: 1.16558928 }, date: '2026-08-19' })) as unknown as typeof fetch;
    expect(await fetchEurUsd(f)).toEqual({ rate: 1.16558928, source: 'fxratesapi (live)', asOf: '2026-08-19' });
  });

  it('falls through to the NEXT source when the first throws', async () => {
    let n = 0;
    const f = (async (url: string) => {
      if (++n === 1) throw new Error('network down');
      // Coinbase returns rates as STRINGS — the parser must cope
      expect(String(url)).toContain('coinbase');
      return res({ data: { rates: { USD: '1.16543735' } } });
    }) as unknown as typeof fetch;
    const r = await fetchEurUsd(f);
    expect(r?.rate).toBeCloseTo(1.16543735, 8);
    expect(r?.source).toBe('Coinbase (live)');
  });

  it('falls through on a non-OK response', async () => {
    let n = 0;
    const f = (async () => (++n === 1 ? res({}, false) : res({ data: { rates: { USD: '1.165' } } }))) as unknown as typeof fetch;
    expect((await fetchEurUsd(f))?.source).toBe('Coinbase (live)');
  });

  it('REJECTS an inverted quote (USD→EUR ~0.86) instead of applying it', async () => {
    // This is the dangerous case: 0.86 is a perfectly well-formed number that would silently
    // scale every euro figure by ~0.74x.
    const f = (async () => res({ rates: { USD: 0.858 } })) as unknown as typeof fetch;
    expect(await fetchEurUsd(f, [FX_SOURCES[0]])).toBeNull();
  });

  it.each([0, -1, Number.NaN, 5, null, undefined, 'abc'])('rejects the implausible rate %s', async (bad) => {
    const f = (async () => res({ rates: { USD: bad } })) as unknown as typeof fetch;
    expect(await fetchEurUsd(f, [FX_SOURCES[0]])).toBeNull();
  });

  it('returns null when EVERY source fails (caller keeps the default)', async () => {
    const f = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    expect(await fetchEurUsd(f)).toBeNull();
  });

  it('never throws, whatever the body is', async () => {
    const f = (async () => ({ ok: true, json: async () => { throw new Error('not json'); } }) as unknown as Response) as unknown as typeof fetch;
    await expect(fetchEurUsd(f)).resolves.toBeNull();
  });

  it('sources are ordered by measured closeness to XE, live before daily-reference', async () => {
    // ECB/Frankfurter measured -0.694% vs XE (it is a once-a-day fix), so it must never
    // outrank a live source.
    expect(FX_SOURCES.map((s) => s.name)).toEqual([
      'fxratesapi (live)', 'Coinbase (live)', 'ECB via Frankfurter (daily)',
    ]);
  });
});

describe('fxMessage', () => {
  it('names the rate, the source and the date, in one copiable line', () => {
    const m = fxMessage({ rate: 1.16558928, source: 'fxratesapi (live)', asOf: '2026-08-19' }, DEFAULT_XE);
    expect(m).toContain('1.16558928');
    expect(m).toContain('fxratesapi (live)');
    expect(m).toContain('2026-08-19');
    expect(m).toContain('xe.com');
  });

  it('on failure says the DEFAULT is in use and names it — no silent fallback', () => {
    const m = fxMessage(null, DEFAULT_XE);
    expect(m).toContain(String(DEFAULT_XE));
    expect(m).toMatch(/could not fetch/i);
  });
});

describe('DEFAULT_XE', () => {
  it('is 1.16 (user 2026-08-19) and inside the plausible band', () => {
    expect(DEFAULT_XE).toBe(1.16);
    expect(DEFAULT_XE).toBeGreaterThan(0.5);
    expect(DEFAULT_XE).toBeLessThan(2);
  });
});

describe('tidyAsOf', () => {
  it('turns a full ISO instant into something readable in a pasted line', () => {
    expect(tidyAsOf('2026-08-19T13:40:00.000Z')).toBe('2026-08-19 13:40 UTC');
  });

  it('passes a bare date through (Frankfurter reports only a date)', () => {
    expect(tidyAsOf('2026-08-19')).toBe('2026-08-19');
  });
});
describe('fetchEurUsd — plausibility band boundaries', () => {
  // The band exists to reject an INVERTED quote; these pin its exact edges so a future widening
  // is a deliberate decision rather than an accident.
  const only = [FX_SOURCES[0]];
  const at = (rate: number) => (async () => res({ rates: { USD: rate } })) as unknown as typeof fetch;

  it.each([0.95, 0.96, 1.0, 1.16, 1.6, 2.0])('ACCEPTS %s (a plausible EUR→USD)', async (r) => {
    expect((await fetchEurUsd(at(r), only))?.rate).toBe(r);
  });

  it.each([0.9499, 0.858, 0.86, 0.5, 0.01, 2.0001, 3, 1000])('REJECTS %s', async (r) => {
    expect(await fetchEurUsd(at(r), only)).toBeNull();
  });
});

describe('fetchEurUsd — malformed payloads fall through rather than throw', () => {
  const only = [FX_SOURCES[0]];
  const body = (b: unknown) => (async () => res(b)) as unknown as typeof fetch;

  it.each([
    ['null', null],
    ['array', []],
    ['empty object', {}],
    ['rates missing USD', { rates: {} }],
    ['rates is a string', { rates: 'nope' }],
    ['USD is an object', { rates: { USD: {} } }],
    ['USD is a numeric string', { rates: { USD: '1.16' } }], // fxratesapi sends numbers; a string is unexpected
    ['plain string body', 'not json at all'],
  ])('%s → null', async (_label, b) => {
    expect(await fetchEurUsd(body(b), only)).toBeNull();
  });

  it('a non-string date is dropped rather than rendered', async () => {
    const f = (async () => res({ rates: { USD: 1.16 }, date: 12345 })) as unknown as typeof fetch;
    expect(await fetchEurUsd(f, only)).toEqual({ rate: 1.16, source: 'fxratesapi (live)', asOf: undefined });
  });
});

describe('fetchEurUsd — source chain', () => {
  it('tries sources IN ORDER and stops at the first success', async () => {
    const seen: string[] = [];
    const f = (async (url: string) => {
      seen.push(String(url));
      // fail the first two, succeed on Frankfurter
      if (seen.length < 3) throw new Error('down');
      return res({ rates: { USD: 1.1576 }, date: '2026-08-19' });
    }) as unknown as typeof fetch;
    const r = await fetchEurUsd(f);
    expect(r?.source).toBe('ECB via Frankfurter (daily)');
    expect(seen[0]).toContain('fxratesapi');
    expect(seen[1]).toContain('coinbase');
    expect(seen[2]).toContain('frankfurter');
  });

  it('does NOT call later sources once one succeeds', async () => {
    const f = vi.fn(async () => res({ rates: { USD: 1.165 } })) as unknown as typeof fetch;
    await fetchEurUsd(f);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('every source targets https (no mixed-content block on a Pages site)', () => {
    for (const s of FX_SOURCES) expect(s.url.startsWith('https://')).toBe(true);
  });

  it('every source asks for EUR as the base', () => {
    // A source silently quoting another base would produce a plausible-looking wrong number.
    for (const s of FX_SOURCES) expect(s.url.toLowerCase()).toMatch(/eur/);
  });

  it('an aborted (slow) source falls through to the next', async () => {
    let n = 0;
    const f = (async (_u: string, init?: RequestInit) => {
      if (++n === 1) {
        // mimic what AbortController does to fetch when the timeout fires
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        void init;
        throw err;
      }
      return res({ data: { rates: { USD: '1.1654' } } });
    }) as unknown as typeof fetch;
    expect((await fetchEurUsd(f))?.source).toBe('Coinbase (live)');
  });
});

describe('fetchEurUsd — Coinbase string handling', () => {
  const only = [FX_SOURCES[1]];
  it('parses a numeric STRING rate', async () => {
    const f = (async () => res({ data: { rates: { USD: '1.16543735' } } })) as unknown as typeof fetch;
    expect((await fetchEurUsd(f, only))?.rate).toBeCloseTo(1.16543735, 8);
  });

  it.each(['', 'abc', null, undefined])('rejects the unparseable string %s', async (v) => {
    const f = (async () => res({ data: { rates: { USD: v } } })) as unknown as typeof fetch;
    expect(await fetchEurUsd(f, only)).toBeNull();
  });

  it('reports no asOf (Coinbase sends none) rather than inventing one', async () => {
    const f = (async () => res({ data: { rates: { USD: '1.165' } } })) as unknown as typeof fetch;
    expect((await fetchEurUsd(f, only))?.asOf).toBeUndefined();
  });
});

describe('tidyAsOf — more shapes', () => {
  it.each([
    ['2026-08-19T13:40:00.000Z', '2026-08-19 13:40 UTC'],
    ['2026-08-19T13:40:00Z', '2026-08-19 13:40 UTC'],
    ['2026-08-19T00:05:59+02:00', '2026-08-19 00:05 UTC'],
    ['2026-08-19', '2026-08-19'],
    ['', ''],
    ['garbage', 'garbage'],
  ])('%s → %s', (raw, want) => {
    expect(tidyAsOf(raw)).toBe(want);
  });
});

describe('fxMessage — copiability', () => {
  it('is a SINGLE line (it gets pasted into a chat box)', () => {
    const m = fxMessage({ rate: 1.165, source: 'fxratesapi (live)', asOf: '2026-08-19' }, DEFAULT_XE);
    expect(m).not.toContain('\n');
    expect(fxMessage(null, DEFAULT_XE)).not.toContain('\n');
  });

  it('states the full precision of the rate, not a rounded display value', () => {
    // The point of copying it is to paste the exact number elsewhere.
    expect(fxMessage({ rate: 1.165365145, source: 's' }, DEFAULT_XE)).toContain('1.165365145');
  });

  it('omits the as-of clause entirely when the source gives no date', () => {
    const m = fxMessage({ rate: 1.165, source: 'Coinbase (live)' }, DEFAULT_XE);
    expect(m).not.toMatch(/as of/);
    expect(m).toContain('Coinbase (live)');
  });

  it('always points at xe.com as the quoted source, success or failure', () => {
    expect(fxMessage({ rate: 1.165, source: 's' }, DEFAULT_XE)).toContain('xe.com');
    expect(fxMessage(null, DEFAULT_XE)).toContain('xe.com');
  });
});
