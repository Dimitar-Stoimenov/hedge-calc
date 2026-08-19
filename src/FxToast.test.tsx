// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderToStaticMarkup } from 'react-dom/server';
import { FxToast } from './FxToast';
import { fxRateText } from './fx';
import { DEFAULT_XE } from './calc';
import App from './App';

/**
 * FxToast behaviour. Two things here are load-bearing rather than cosmetic:
 *
 *  1. A FAILED lookup must NOT push a rate into the calculator. Every euro figure on the page is
 *     multiplied by the rate, so a fallback that silently looked like a live rate would produce
 *     confidently wrong money numbers.
 *  2. The toast must PERSIST until dismissed (user: "permanent top right, unless we click x on
 *     it") and its message must be copiable, because its job is to be pasted elsewhere.
 *
 * This file runs under jsdom (see the docblock above); the rest of the suite stays on the node
 * environment, which is why the environment is set per-file rather than globally.
 */
const ok = (body: unknown) => ({ ok: true, json: async () => body }) as unknown as Response;
const RATE = 1.16558928;
const okRate = (rate: number = RATE, date?: string) =>
  vi.fn(async () => ok({ rates: { USD: rate }, ...(date ? { date } : {}) }));

// @testing-library's auto-cleanup only registers when vitest `globals` are on; this project
// keeps them off, so unmount explicitly or state leaks between tests.
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
beforeEach(() => { vi.restoreAllMocks(); });

describe('FxToast — success path', () => {
  it('fetches on mount and applies the rate to the caller', async () => {
    vi.stubGlobal('fetch', okRate());
    const onRate = vi.fn();
    render(<FxToast onRate={onRate} />);
    await waitFor(() => expect(onRate).toHaveBeenCalledWith(RATE));
    expect(onRate).toHaveBeenCalledTimes(1);
  });

  it('shows the applied title, the rate, the source and the date', async () => {
    vi.stubGlobal('fetch', okRate(RATE, '2026-08-19T13:40:00.000Z'));
    render(<FxToast onRate={() => {}} />);
    expect(await screen.findByText('EUR→USD')).toBeTruthy();
    // the rate stands alone; provenance is a separate, smaller line and is NOT copied
    expect(await screen.findByText(String(RATE))).toBeTruthy();
    expect(screen.getByText(/fxratesapi/)).toBeTruthy();
    expect(screen.getByText(/2026-08-19 13:40 UTC/)).toBeTruthy(); // tidied, not raw ISO
  });

  it('the displayed number is EXACTLY fxRateText — i.e. exactly what Copy yields', async () => {
    vi.stubGlobal('fetch', okRate(RATE, '2026-08-19'));
    const { container } = render(<FxToast onRate={() => {}} />);
    await screen.findByText('EUR→USD');
    const shown = container.querySelector('.fx-toast-rate')?.textContent;
    expect(shown).toBe(fxRateText({ rate: RATE, source: 'fxratesapi (live)' }, DEFAULT_XE));
    expect(shown).toBe(String(RATE));
  });

  it('is NOT styled as a warning on success', async () => {
    vi.stubGlobal('fetch', okRate());
    const { container } = render(<FxToast onRate={() => {}} />);
    await screen.findByText('EUR→USD');
    expect(container.querySelector('.fx-toast')).toBeTruthy();
    expect(container.querySelector('.fx-toast-warn')).toBeNull();
  });

  it('falls through to Coinbase when the primary fails, and says so', async () => {
    let n = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      if (++n === 1) throw new Error('primary down');
      return ok({ data: { rates: { USD: '1.16543735' } } });
    }));
    const onRate = vi.fn();
    render(<FxToast onRate={onRate} />);
    await waitFor(() => expect(onRate).toHaveBeenCalledWith(1.16543735));
    expect(await screen.findByText(/Coinbase \(live\)/)).toBeTruthy();
  });
});

describe('FxToast — failure path (the dangerous one)', () => {
  it('does NOT apply a rate when every source fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const onRate = vi.fn();
    render(<FxToast onRate={onRate} />);
    await screen.findByText(/live rate unavailable/i);
    expect(onRate).not.toHaveBeenCalled();
  });

  it('SHOWS the default it fell back to — no silent fallback', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const { container } = render(<FxToast onRate={() => {}} />);
    await screen.findByText(/live rate unavailable/i);
    expect(container.querySelector('.fx-toast-rate')?.textContent).toBe(String(DEFAULT_XE));
  });

  it('is styled as a warning on failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const { container } = render(<FxToast onRate={() => {}} />);
    await screen.findByText(/live rate unavailable/i);
    expect(container.querySelector('.fx-toast-warn')).toBeTruthy();
  });

  it('does NOT apply an implausible rate (inverted USD→EUR quote)', async () => {
    // 0.858 is well-formed and would scale every euro figure by ~0.74x.
    vi.stubGlobal('fetch', vi.fn(async () => ok({ rates: { USD: 0.858 } })));
    const onRate = vi.fn();
    render(<FxToast onRate={onRate} />);
    await screen.findByText(/live rate unavailable/i);
    expect(onRate).not.toHaveBeenCalled();
  });
});

describe('FxToast — persistence and dismissal', () => {
  it('fetches ONCE per page load, not once per render', async () => {
    const f = okRate();
    vi.stubGlobal('fetch', f);
    const { rerender } = render(<FxToast onRate={() => {}} />);
    await waitFor(() => expect(f).toHaveBeenCalledTimes(1));
    rerender(<FxToast onRate={() => {}} />);
    rerender(<FxToast onRate={() => {}} />);
    rerender(<FxToast onRate={() => {}} />);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('PERSISTS — five minutes of timers do not dismiss it', async () => {
    vi.stubGlobal('fetch', okRate());
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<FxToast onRate={() => {}} />);
    await screen.findByText('EUR→USD');
    await act(async () => { await vi.advanceTimersByTimeAsync(300_000); });
    expect(screen.queryByText('EUR→USD')).toBeTruthy();
  });

  it('the × dismisses it, and it stays gone', async () => {
    vi.stubGlobal('fetch', okRate());
    const user = userEvent.setup();
    const { container } = render(<FxToast onRate={() => {}} />);
    await screen.findByText('EUR→USD');
    await user.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(container.querySelector('.fx-toast')).toBeNull();
    // nothing re-opens it
    await new Promise((r) => setTimeout(r, 50));
    expect(container.querySelector('.fx-toast')).toBeNull();
  });

  it('the × is reachable by its accessible name (not just by class)', async () => {
    vi.stubGlobal('fetch', okRate());
    render(<FxToast onRate={() => {}} />);
    await screen.findByText('EUR→USD');
    expect(screen.getByRole('button', { name: /dismiss/i })).toBeTruthy();
  });

  it('announces itself politely to screen readers', async () => {
    vi.stubGlobal('fetch', okRate());
    render(<FxToast onRate={() => {}} />);
    const status = await screen.findByRole('status');
    expect(status.getAttribute('aria-live')).toBe('polite');
  });

  it('renders nothing at all before the lookup resolves', () => {
    // A pending fetch must not paint an empty shell that shifts the layout.
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
    const { container } = render(<FxToast onRate={() => {}} />);
    expect(container.querySelector('.fx-toast')).toBeNull();
  });

  it('unmounting before the lookup resolves does not warn or throw', async () => {
    let settle: (r: Response) => void = () => {};
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((res) => { settle = res; })));
    const spy = vi.spyOn(console, 'error');
    const { unmount } = render(<FxToast onRate={() => {}} />);
    unmount();
    settle(ok({ rates: { USD: RATE } }));
    await new Promise((r) => setTimeout(r, 20));
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('FxToast — copy', () => {
  // NB: clipboard is installed with defineProperty on the EXISTING navigator, never by
  // replacing the whole object — `userEvent.setup()` installs its own navigator.clipboard stub,
  // and swapping navigator out from under it silently stops its clicks from dispatching at all
  // (which is exactly how the first version of these tests "passed" nothing).
  // Clicks here use fireEvent for the same reason: no userEvent clipboard machinery involved.
  const setClipboard = (value: unknown) => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, writable: true, value });
  };
  afterEach(() => {
    setClipboard(undefined);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (document as any).execCommand;
  });

  it('copies the full message via the clipboard API', async () => {
    vi.stubGlobal('fetch', okRate(RATE, '2026-08-19'));
    // typed param so `mock.calls[0][0]` is a string rather than an empty tuple
    const writeText = vi.fn(async (_text: string) => {});
    setClipboard({ writeText });
    render(<FxToast onRate={() => {}} />);
    await screen.findByText('EUR→USD');
    fireEvent.click(screen.getByRole('button', { name: /^copy$/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    // ONLY the number — no label, no source, nothing to strip after pasting
    expect(writeText.mock.calls[0][0]).toBe(String(RATE));
  });

  it('confirms with "Copied" and then returns to "Copy"', async () => {
    vi.stubGlobal('fetch', okRate());
    setClipboard({ writeText: vi.fn(async () => {}) });
    render(<FxToast onRate={() => {}} />);
    await screen.findByText('EUR→USD');
    fireEvent.click(screen.getByRole('button', { name: /^copy$/i }));
    expect(await screen.findByRole('button', { name: /copied/i })).toBeTruthy();
    // the component resets after 1500ms — real timers, so just wait it out
    await waitFor(() => expect(screen.getByRole('button', { name: /^copy$/i })).toBeTruthy(), { timeout: 4000 });
  });

  it('falls back to execCommand when the clipboard API is unavailable (plain http)', async () => {
    vi.stubGlobal('fetch', okRate());
    setClipboard(undefined);
    const exec = vi.fn(() => true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (document as any).execCommand = exec;
    render(<FxToast onRate={() => {}} />);
    await screen.findByText('EUR→USD');
    fireEvent.click(screen.getByRole('button', { name: /^copy$/i }));
    await waitFor(() => expect(exec).toHaveBeenCalledWith('copy'));
    expect(await screen.findByRole('button', { name: /copied/i })).toBeTruthy();
  });

  it('a REJECTED clipboard write still copies via the fallback', async () => {
    vi.stubGlobal('fetch', okRate());
    setClipboard({ writeText: vi.fn(async () => { throw new Error('denied'); }) });
    const exec = vi.fn(() => true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (document as any).execCommand = exec;
    render(<FxToast onRate={() => {}} />);
    await screen.findByText('EUR→USD');
    fireEvent.click(screen.getByRole('button', { name: /^copy$/i }));
    await waitFor(() => expect(exec).toHaveBeenCalledWith('copy'));
  });

  it('a THROWING execCommand does not crash the toast (text stays selectable)', async () => {
    vi.stubGlobal('fetch', okRate());
    setClipboard(undefined);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (document as any).execCommand = vi.fn(() => { throw new Error('blocked'); });
    render(<FxToast onRate={() => {}} />);
    await screen.findByText('EUR→USD');
    fireEvent.click(screen.getByRole('button', { name: /^copy$/i }));
    // still rendered, still readable — the user can select the number by hand
    expect(screen.getByText(String(RATE))).toBeTruthy();
  });

  it('does not leave the temporary textarea in the DOM', async () => {
    vi.stubGlobal('fetch', okRate());
    setClipboard(undefined);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (document as any).execCommand = vi.fn(() => true);
    render(<FxToast onRate={() => {}} />);
    await screen.findByText('EUR→USD');
    fireEvent.click(screen.getByRole('button', { name: /^copy$/i }));
    await waitFor(() => expect(document.querySelectorAll('textarea').length).toBe(0));
  });
});

describe('FxToast — integration with the calculator', () => {
  it('a fetched rate flows into the live app and changes the share counts', async () => {
    // The whole point of fetching: the numbers must actually move. 2x the default rate doubles
    // shares, so this proves the value reaches the calc rather than only the input box.
    vi.stubGlobal('fetch', okRate(DEFAULT_XE * 2));
    const { container } = render(<App />);
    const before = container.textContent ?? '';
    const per10Default = (10 * 2.55 * DEFAULT_XE).toFixed(2);
    expect(before).toContain(per10Default);
    await waitFor(() => {
      expect(container.textContent).toContain((10 * 2.55 * DEFAULT_XE * 2).toFixed(2));
    });
  });

  it('a FAILED lookup leaves the app on DEFAULT_XE', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const { container } = render(<App />);
    await screen.findByText(/live rate unavailable/i);
    expect(container.textContent).toContain((10 * 2.55 * DEFAULT_XE).toFixed(2));
  });

  it('the app still server-renders with the toast mounted (first paint safe)', () => {
    const h = renderToStaticMarkup(<App />);
    expect(h).toMatch(/LOCK/);
    expect(h).not.toMatch(/fx-toast/); // effects never run in static rendering
  });
});
