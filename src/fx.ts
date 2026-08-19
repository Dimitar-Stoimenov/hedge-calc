/**
 * EUR → USD rate, fetched once on page load.
 *
 * WHY NOT XE.COM, WHICH IS WHAT WE ACTUALLY QUOTE AGAINST. Tested 2026-08-19: neither
 * xe.com's converter page nor its internal `/api/protected/midmarket-converter/` sends an
 * `Access-Control-Allow-Origin` header (and the API 403s without an Authorization header
 * besides). This app is a STATIC GitHub Pages build with no server to proxy through, so a
 * browser fetch to xe.com is blocked by CORS no matter how it is written. Not a workaround
 * problem — a same-origin-policy one.
 *
 * SO THE SOURCES ARE CHOSEN BY HOW CLOSELY THEY TRACK XE, measured against XE's live
 * mid-market rate of 1.165686 the same day:
 *
 *   fxratesapi        1.16558928   −0.008%   ← primary
 *   coinbase          1.16543735   −0.021%   ← fallback (very high uptime)
 *   frankfurter/ECB   1.1576       −0.694%   ← last resort, see below
 *
 * The ECB gap is not noise: ECB publishes ONE daily reference rate fixed around 16:00 CET,
 * while XE quotes live mid-market. 0.7% flows straight into the lock and the void tail, which
 * is why the daily-reference sources rank last even though they are the most "official".
 * Frankfurter is kept anyway because a stale-but-real rate beats silently falling back to a
 * hardcoded constant.
 */

export interface FxResult {
  rate: number;
  /** Human-readable source name for the toast. */
  source: string;
  /** As-of date the source reported, when it reports one. */
  asOf?: string;
}

interface Source {
  name: string;
  url: string;
  pick: (json: unknown) => { rate: number; asOf?: string } | null;
}

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;

/** Ordered by measured closeness to XE — see the header table. */
export const FX_SOURCES: Source[] = [
  {
    name: 'fxratesapi (live)',
    url: 'https://api.fxratesapi.com/latest?base=EUR&currencies=USD',
    pick: (j) => {
      const o = j as { rates?: { USD?: unknown }; date?: unknown };
      const rate = num(o?.rates?.USD);
      return rate ? { rate, asOf: typeof o.date === 'string' ? o.date : undefined } : null;
    },
  },
  {
    name: 'Coinbase (live)',
    url: 'https://api.coinbase.com/v2/exchange-rates?currency=EUR',
    pick: (j) => {
      const o = j as { data?: { rates?: { USD?: unknown } } };
      // Coinbase returns rates as STRINGS.
      const rate = num(Number(o?.data?.rates?.USD));
      return rate ? { rate } : null;
    },
  },
  {
    name: 'ECB via Frankfurter (daily)',
    url: 'https://api.frankfurter.app/latest?from=EUR&to=USD',
    pick: (j) => {
      const o = j as { rates?: { USD?: unknown }; date?: unknown };
      const rate = num(o?.rates?.USD);
      return rate ? { rate, asOf: typeof o.date === 'string' ? o.date : undefined } : null;
    },
  },
];

/** Per-source timeout. Page load must not hang on a slow FX host. */
const TIMEOUT_MS = 4000;
/**
 * Sanity band, sized to catch an INVERTED quote — the dangerous failure, because 0.86 is a
 * perfectly well-formed number that would silently scale every euro figure on the page by
 * ~0.74x. At today's ~1.166 an inversion lands at ~0.858, so the floor has to sit above that.
 *
 * 0.95 is the choice: EUR→USD has not closed below ~0.96 since 2002 (the 2022 parity dip was
 * its modern low), while an inversion only stays above 0.95 if EUR→USD itself is under ~1.052.
 * The two ranges cannot be separated perfectly, so this errs toward REJECTING: a rejected real
 * rate falls through to the next source and ultimately to DEFAULT_XE with the toast saying so,
 * whereas an accepted inverted rate corrupts every number silently.
 */
const MIN_RATE = 0.95;
const MAX_RATE = 2.0;

/**
 * Try each source in order; first plausible answer wins. Returns null only when every source
 * failed — the caller then keeps DEFAULT_XE.
 *
 * Never throws: a rate lookup must not be able to break the calculator.
 */
export async function fetchEurUsd(
  fetchImpl: typeof fetch = fetch,
  sources: Source[] = FX_SOURCES,
): Promise<FxResult | null> {
  for (const src of sources) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      try {
        const res = await fetchImpl(src.url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
        if (!res.ok) continue;
        const hit = src.pick(await res.json());
        if (!hit) continue;
        if (hit.rate < MIN_RATE || hit.rate > MAX_RATE) continue;
        return { rate: hit.rate, source: src.name, asOf: hit.asOf };
      } finally {
        clearTimeout(timer);
      }
    } catch {
      // network error, abort, or unparseable body — try the next source
    }
  }
  return null;
}

/**
 * The toast text. Deliberately ONE self-contained line that reads correctly on its own, since
 * the whole point is that it gets copied out of here and pasted somewhere else.
 */
export function fxMessage(result: FxResult | null, fallback: number): string {
  if (!result) {
    return `EUR→USD: could not fetch a live rate — using the built-in default ${fallback}. `
      + `Check xe.com and update the rate under Advanced.`;
  }
  // Sources report the timestamp in different shapes: fxratesapi sends a full ISO instant
  // ("2026-08-19T13:40:00.000Z"), Frankfurter a bare date. Normalise to "YYYY-MM-DD HH:MM UTC"
  // (or just the date) — this line gets pasted elsewhere, so it should read cleanly.
  const asOf = result.asOf ? `, as of ${tidyAsOf(result.asOf)}` : '';
  return `EUR→USD = ${result.rate} (${result.source}${asOf}). Applied. `
    + `xe.com is the quoted source and can differ ~0.0-0.7%; verify there and update under Advanced if it matters.`;
}

/** "2026-08-19T13:40:00.000Z" → "2026-08-19 13:40 UTC"; a bare date passes through. */
export function tidyAsOf(raw: string): string {
  const iso = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(raw);
  if (iso) return `${iso[1]} ${iso[2]} UTC`;
  return raw;
}
