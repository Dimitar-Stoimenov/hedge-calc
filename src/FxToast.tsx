import { useEffect, useState } from 'react';
import { DEFAULT_XE } from './calc';
import { fetchEurUsd, fxRateText, tidyAsOf, type FxResult } from './fx';

/**
 * FX rate toast — fetches EUR→USD once on mount, applies it, and shows just the number.
 *
 * BEHAVIOUR (user 2026-08-19): fetched ONCE per page load, never polled; pinned top-right with
 * NO auto-dismiss timer, so only the × closes it; the rate is selectable text and Copy puts
 * **only the number** on the clipboard ("only XE and on copy i want the number copied only") —
 * the earlier version copied a whole explanatory sentence, which is useless for pasting a value
 * into another tool.
 *
 * On a failed lookup the calculator keeps DEFAULT_XE, the toast says `default`, and Copy yields
 * that same default — so the number on screen is always the one the maths is using.
 */
export function FxToast({ onRate }: { onRate: (rate: number) => void }) {
  const [done, setDone] = useState(false);
  const [result, setResult] = useState<FxResult | null>(null);
  const [closed, setClosed] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    void fetchEurUsd().then((r) => {
      if (!live) return;
      setResult(r);
      setDone(true);
      // Apply ONLY a real rate. A failed lookup leaves the field on DEFAULT_XE.
      if (r) onRate(r.rate);
    });
    return () => { live = false; };
    // Mount-only on purpose: a page-load lookup, not a subscription. Including `onRate` would
    // re-fetch on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (closed || !done) return null;

  const rate = fxRateText(result, DEFAULT_XE);

  const copy = () => {
    // navigator.clipboard needs a secure context; the textarea fallback keeps copy working on
    // plain http and in older browsers rather than failing silently.
    const ok = () => { setCopied(true); setTimeout(() => setCopied(false), 1500); };
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(rate).then(ok).catch(() => fallbackCopy(rate, ok));
    } else {
      fallbackCopy(rate, ok);
    }
  };

  return (
    <div className={`fx-toast ${result ? '' : 'fx-toast-warn'}`} role="status" aria-live="polite">
      <div className="fx-toast-head">
        <strong>EUR→USD</strong>
        <button className="fx-toast-x" onClick={() => setClosed(true)} aria-label="Dismiss" title="Dismiss">×</button>
      </div>
      <div className="fx-toast-row">
        {/* user-select is forced on in CSS — the number is here to be taken */}
        <span className="fx-toast-rate mono">{rate}</span>
        <button className="fx-toast-copy" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
      </div>
      {/* Provenance stays OUT of the copied string: a one-line hint, not part of the value. */}
      <p className="fx-toast-src">
        {result
          ? `${result.source}${result.asOf ? ` · ${tidyAsOf(result.asOf)}` : ''}`
          : 'default — live rate unavailable'}
      </p>
    </div>
  );
}

function fallbackCopy(text: string, done: () => void) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); done(); } catch { /* leave the text selectable instead */ }
  document.body.removeChild(ta);
}
