import { useMemo, useState } from 'react';
import './App.css';
import {
  FEE_RATES,
  MARKET_TYPES,
  breakevenNo,
  lockTest,
  sizePosition,
  effectivePrice,
  type MarketType,
} from './calc';
import { fmtCents, fmtMoneyEur, fmtPct, fmtShares, fmtUsd } from './format';

const MARKET_LABELS: Record<MarketType, string> = {
  sports: 'Sports',
  politics: 'Politics',
  finance: 'Finance',
  crypto: 'Crypto',
  geopolitics: 'Geopolitics',
};

// Fixed stake rows plus one custom row.
const FIXED_STAKES = [10, 20];

/** Parse a text input to a finite number, or null if blank/invalid. */
function num(s: string): number | null {
  if (s.trim() === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

interface CalcInputs {
  odds: number;
  noPrice: number;
  feeRate: number;
  isMaker: boolean;
  isFreeBet: boolean;
  xe: number;
  isLock: boolean;
}

/** The computed shares / cost / profit cells for one stake, with copy-to-clipboard on shares. */
function ResultCells({ inputs, stake }: { inputs: CalcInputs; stake: number }) {
  const { odds, noPrice, feeRate, isMaker, isFreeBet, xe, isLock } = inputs;
  const [copied, setCopied] = useState(false);
  const r = sizePosition({ odds, noPrice, feeRate, isMaker, isFreeBet, xe, stake });

  async function copyShares() {
    try {
      await navigator.clipboard.writeText(fmtShares(r.shares));
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // clipboard blocked (e.g. non-secure context) — silently ignore
    }
  }

  return (
    <>
      <td className="col-shares">
        <button
          type="button"
          className={`shares-copy ${isLock ? '' : 'muted'}`}
          onClick={copyShares}
          title="Copy shares to clipboard"
        >
          <span className="mono">{fmtShares(r.shares)}</span>
          <span className="copy-hint">{copied ? '✓' : '⧉'}</span>
        </button>
      </td>
      <td className="col-cost mono">{fmtUsd(r.hedgeCostUsd)}</td>
      <td className={`col-profit mono ${r.lockProfit >= 0 ? 'pos' : 'neg'}`}>
        {fmtMoneyEur(r.lockProfit)}
      </td>
    </>
  );
}

export default function App() {
  const [oddsStr, setOddsStr] = useState('2.55');
  const [noStr, setNoStr] = useState('50');
  const [market, setMarket] = useState<MarketType>('sports');
  const [isMaker, setIsMaker] = useState(false);
  const [isFreeBet, setIsFreeBet] = useState(false);
  const [xeStr, setXeStr] = useState('1.146');
  const [customStr, setCustomStr] = useState('50');
  const [advOpen, setAdvOpen] = useState(false);

  const odds = num(oddsStr);
  const noPrice = num(noStr);
  const xe = num(xeStr);
  const custom = num(customStr);
  const feeRate = FEE_RATES[market];

  // Validation — gentle hints, never crash.
  const errors: string[] = [];
  if (odds !== null && odds <= 1) errors.push('Odds must be greater than 1.');
  if (noPrice !== null && (noPrice <= 0 || noPrice >= 100))
    errors.push('NO price must be between 0 and 100¢.');
  if (xe !== null && xe <= 0) errors.push('Exchange rate must be greater than 0.');

  const inputsReady =
    odds !== null &&
    odds > 1 &&
    noPrice !== null &&
    noPrice > 0 &&
    noPrice < 100 &&
    xe !== null &&
    xe > 0;

  const view = useMemo(() => {
    if (!inputsReady) return null;
    // narrowed to numbers by inputsReady
    const o = odds as number;
    const n = noPrice as number;
    const x = xe as number;
    const pEff = effectivePrice(n / 100, feeRate, isMaker);
    const lock = lockTest(o, pEff);
    const breakeven = breakevenNo(o, feeRate, isMaker);

    const inputs: CalcInputs = {
      odds: o,
      noPrice: n,
      feeRate,
      isMaker,
      isFreeBet,
      xe: x,
      isLock: lock.isLock,
    };

    // Depth reminder: warn when any shown hedge cost exceeds $50.
    const stakes = [...FIXED_STAKES];
    if (custom !== null && custom > 0) stakes.push(custom);
    const bigOrder = stakes.some(
      (s) =>
        sizePosition({ odds: o, noPrice: n, feeRate, isMaker, isFreeBet, xe: x, stake: s })
          .hedgeCostUsd > 50,
    );

    return { pEff, lock, breakeven, inputs, bigOrder };
  }, [inputsReady, odds, noPrice, feeRate, isMaker, isFreeBet, xe, custom]);

  const takerMaker = isMaker ? 'maker' : 'taker';

  return (
    <div className="app">
      <header className="app-head">
        <h1>Boost Hedge</h1>
        <p className="tagline">
          Bookie boost × Polymarket NO — lock check &amp; share sizing.
        </p>
      </header>

      {/* ---- Inputs ---- */}
      <section className="card">
        <div className="grid2">
          <label className="field">
            <span className="field-label">Boost odds</span>
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="1"
              value={oddsStr}
              onChange={(e) => setOddsStr(e.target.value)}
              placeholder="2.55"
            />
          </label>

          <label className="field">
            <span className="field-label">Polymarket NO (¢)</span>
            <input
              type="number"
              inputMode="decimal"
              step="0.1"
              min="0"
              max="100"
              value={noStr}
              onChange={(e) => setNoStr(e.target.value)}
              placeholder="50"
            />
          </label>
        </div>

        <label className="field">
          <span className="field-label">Market type</span>
          <select
            value={market}
            onChange={(e) => setMarket(e.target.value as MarketType)}
          >
            {MARKET_TYPES.map((m) => (
              <option key={m} value={m}>
                {MARKET_LABELS[m]} — fee {(FEE_RATES[m] * 100).toFixed(0)}%
              </option>
            ))}
          </select>
        </label>

        <div className="toggle-row">
          <div className="segmented" role="group" aria-label="Order type">
            <button
              type="button"
              className={!isMaker ? 'seg on' : 'seg'}
              onClick={() => setIsMaker(false)}
            >
              Taker
            </button>
            <button
              type="button"
              className={isMaker ? 'seg on' : 'seg'}
              onClick={() => setIsMaker(true)}
            >
              Maker
            </button>
          </div>

          <label className="checkbox">
            <input
              type="checkbox"
              checked={isFreeBet}
              onChange={(e) => setIsFreeBet(e.target.checked)}
            />
            <span>Free bet (SNR)</span>
          </label>
        </div>

        <div className="advanced">
          <button
            type="button"
            className="adv-toggle"
            onClick={() => setAdvOpen((v) => !v)}
            aria-expanded={advOpen}
          >
            {advOpen ? '▾' : '▸'} Advanced
          </button>
          {advOpen && (
            <label className="field">
              <span className="field-label">EUR → USD rate</span>
              <input
                type="number"
                inputMode="decimal"
                step="0.001"
                min="0"
                value={xeStr}
                onChange={(e) => setXeStr(e.target.value)}
                placeholder="1.146"
              />
            </label>
          )}
        </div>

        {errors.length > 0 && (
          <ul className="hints">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
      </section>

      {/* ---- Verdict ---- */}
      {view && (
        <section className="verdict">
          <div className={view.lock.isLock ? 'pill lock' : 'pill dead'}>
            {view.lock.isLock ? (
              <>
                LOCK{' '}
                <span className="pill-pct">+{fmtPct(view.lock.marginPct)}%</span>
              </>
            ) : (
              <>
                DEAD{' '}
                <span className="pill-pct">{fmtPct(view.lock.marginPct)}%</span>
              </>
            )}
          </div>
          <p className="breakeven">
            Profitable if NO ≤ <strong>{fmtCents(view.breakeven)}¢</strong> (
            {takerMaker})
          </p>
        </section>
      )}

      {/* ---- Results ---- */}
      {view && (
        <section className="card">
          <table className="results">
            <thead>
              <tr>
                <th>{isFreeBet ? 'FB face' : 'Stake'}</th>
                <th>Shares</th>
                <th>Hedge cost</th>
                <th>Net profit</th>
              </tr>
            </thead>
            <tbody>
              {FIXED_STAKES.map((s) => (
                <tr key={s} className={view.lock.isLock ? '' : 'row-dead'}>
                  <td className="col-stake">€{s}</td>
                  <ResultCells inputs={view.inputs} stake={s} />
                </tr>
              ))}
              <tr className={`custom-row ${view.lock.isLock ? '' : 'row-dead'}`}>
                <td className="col-stake">
                  <span className="euro-prefix">€</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="1"
                    min="0"
                    value={customStr}
                    onChange={(e) => setCustomStr(e.target.value)}
                    placeholder="custom"
                    aria-label="Custom stake in euros"
                  />
                </td>
                {custom !== null && custom > 0 ? (
                  <ResultCells inputs={view.inputs} stake={custom} />
                ) : (
                  <>
                    <td className="dim">—</td>
                    <td className="dim">—</td>
                    <td className="dim">—</td>
                  </>
                )}
              </tr>
            </tbody>
          </table>

          {view.bigOrder && (
            <p className="depth-note">
              ⚠ Depth check: for orders &gt; $50, verify the book holds the size.
            </p>
          )}
        </section>
      )}

      <footer className="app-foot">
        <p>
          Sizes one bet's hedge. Does <strong>not</strong> check order-book depth. No
          data leaves your device.
        </p>
      </footer>
    </div>
  );
}
