import { useEffect, useState } from 'react';
import { DEFAULT_XE } from './calc';
import { fetchEurUsd, fxMessage, type FxResult } from './fx';

/**
 * FX rate toast — fetches EUR→USD once on mount, applies it, and reports what happened.
 *
 * BEHAVIOUR (user 2026-08-19): "call it once on page load and put a toaster to tell us to
 * update it. toaster to be permanent top right, unless we click x on it. it should be copiable,
 * so i can directly take and copy into claude or whatever i need it for."
 *  - fetched ONCE per page load, never polled;
 *  - pinned top-right and PERSISTENT — no auto-dismiss timer, only the × closes it;
 *  - the message is selectable text PLUS a one-click copy, because its job is to be pasted
 *    somewhere else;
 *  - on total failure the calculator keeps DEFAULT_XE and the toast says so, so a silent
 *    fallback to a hardcoded constant can never look like a live rate.
 */
export function FxToast({ onRate }: { onRate: (rate: number) => void }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [result, setResult] = useState<FxResult | null>(null);
  const [closed, setClosed] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    void fetchEurUsd().then((r) => {
      if (!live) return;
      setResult(r);
      setMsg(fxMessage(r, DEFAULT_XE));
      // Apply ONLY a real rate. A failed lookup leaves the field on DEFAULT_XE.
      if (r) onRate(r.rate);
    });
    return () => { live = false; };
    // Mount-only on purpose: this is a page-load lookup, not a subscription. `onRate` is a
    // stable setter from the parent, so leaving it out cannot capture a stale value that
    // matters — and including it would re-fetch on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (closed || !msg) return null;

  const copy = () => {
    // navigator.clipboard needs a secure context; the textarea fallback keeps copy working on
    // plain http (and in older browsers) rather than failing silently.
    const done = () => { setCopied(true); setTimeout(() => setCopied(false), 1500); };
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(msg).then(done).catch(() => fallbackCopy(msg, done));
    } else {
      fallbackCopy(msg, done);
    }
  };

  return (
    <div className={`fx-toast ${result ? '' : 'fx-toast-warn'}`} role="status" aria-live="polite">
      <div className="fx-toast-head">
        <strong>{result ? 'Exchange rate applied' : 'Exchange rate unavailable'}</strong>
        <button className="fx-toast-x" onClick={() => setClosed(true)} aria-label="Dismiss" title="Dismiss">×</button>
      </div>
      {/* user-select is forced on in CSS — the message exists to be copied out */}
      <p className="fx-toast-msg">{msg}</p>
      <button className="fx-toast-copy" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
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
