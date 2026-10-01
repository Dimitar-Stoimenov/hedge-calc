import { useMemo, useState } from 'react';
import {
  DEFAULT_XE,
  FEE_RATES,
  MARKET_TYPES,
  breakevenNo,
  breakevenSxOdds,
  lockTest,
  sizePosition,
  sizeSx,
  sxCostPerDollar,
  effectivePrice,
  voidTail,
  VOID_WATCH_PRICE_CENTS,
  type MarketType,
  type SxSizeResult,
} from './calc';
import { fmtCents, fmtMoneyEur, fmtPct, fmtShares, fmtUsd } from './format';
import { parseNum } from './parse';

const MARKET_LABELS: Record<MarketType, string> = {
  sports: 'Sports',
  politics: 'Politics',
  finance: 'Finance',
  crypto: 'Crypto',
  geopolitics: 'Geopolitics',
};

// Fixed stake rows plus one custom row.
const FIXED_STAKES = [10, 20];

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
  const tail = voidTail(r, stake, xe);

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
      {/* What a VOID does to this stake, signed like a P&L: NEGATIVE = it costs you
          (the usual case above 50¢), positive = it pays you. See calc.voidTail. */}
      <td className={`col-void mono ${tail.tailEur > 0 ? 'neg' : 'pos'}`}>
        {fmtMoneyEur(-tail.tailEur)}
      </td>
    </>
  );
}

/** One SX row's cells, in the Poly table's column order: returns · stake on SX · net profit · void tail (none).
 *  The SX stake is the number typed into sx.bet, so it copies like Poly's shares — bare, no "$" (user 2026-10-02). */
function SxCells({ r, isLock }: { r: SxSizeResult; isLock: boolean }) {
  const [copied, setCopied] = useState(false);
  const stakeText = r.sxStakeUsd.toFixed(2);

  async function copyStake() {
    try {
      await navigator.clipboard.writeText(stakeText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // clipboard blocked (e.g. non-secure context) — silently ignore
    }
  }

  return (
    <>
      <td className="col-shares mono">{fmtUsd(r.payoutUsd)}</td>
      <td className="col-cost">
        <button
          type="button"
          className={`shares-copy ${isLock ? '' : 'muted'}`}
          onClick={copyStake}
          title="Copy SX stake to clipboard"
          aria-label="Copy SX stake"
        >
          <span className="mono">{fmtUsd(r.sxStakeUsd)}</span>
          <span className="copy-hint">{copied ? '✓' : '⧉'}</span>
        </button>
      </td>
      <td className={`col-profit mono ${r.lockProfit >= 0 ? 'pos' : 'neg'}`}>{fmtMoneyEur(r.lockProfit)}</td>
      {/* SX refunds both legs on a void — nothing lost */}
      <td className="col-void mono dim">€0.00</td>
    </>
  );
}

/** The original single-bet BOOST hedge calculator (2026-07). The EUR→USD rate is owned by App so
 *  both calculators (this and the rolling double) share one rate and one FX toast. */
export function BoostCalc({ xeStr, setXeStr }: { xeStr: string; setXeStr: (s: string) => void }) {
  const [oddsStr, setOddsStr] = useState('2.55');
  const [noStr, setNoStr] = useState('50');
  const [market, setMarket] = useState<MarketType>('sports');
  const [isMaker, setIsMaker] = useState(false);
  const [isFreeBet, setIsFreeBet] = useState(false);
  const [customStr, setCustomStr] = useState('50');
  const [advOpen, setAdvOpen] = useState(false);
  // SX (2026-10-02): the decimal odds sx.bet shows for backing the OTHER side. Empty = no SX panel.
  const [sxStr, setSxStr] = useState('');
  // the SX panel's own custom stake (user 2026-10-02) — independent of the Poly custom row
  const [sxCustomStr, setSxCustomStr] = useState('50');

  const odds = parseNum(oddsStr);
  const noPrice = parseNum(noStr);
  const xe = parseNum(xeStr);
  const custom = parseNum(customStr);
  const sxOdds = parseNum(sxStr);
  const sxCustom = parseNum(sxCustomStr);
  const feeRate = FEE_RATES[market];

  // Validation — gentle hints, never crash.
  const errors: string[] = [];
  if (odds !== null && odds <= 1) errors.push('Odds must be greater than 1.');
  if (noPrice !== null && (noPrice <= 0 || noPrice >= 100))
    errors.push('NO price must be between 0 and 100¢.');
  if (xe !== null && xe <= 0) errors.push('Exchange rate must be greater than 0.');
  if (sxOdds !== null && sxOdds <= 1) errors.push('SX odds must be greater than 1.');

  // THE SX PANEL — the same boost odds, stakes and rate, hedged on SX instead of Poly. Independent of the Poly NO
  // price: either panel shows as soon as its own hedge price is filled in.
  const sxView = useMemo(() => {
    if (odds === null || odds <= 1 || xe === null || xe <= 0 || sxOdds === null || sxOdds <= 1) return null;
    const lock = lockTest(odds, sxCostPerDollar(sxOdds));
    const size = (stake: number) => sizeSx({ odds, sxOdds, isFreeBet, xe, stake });
    const rows = FIXED_STAKES.map((stake) => ({ stake, r: size(stake) }));
    const customRow = sxCustom !== null && sxCustom > 0 ? size(sxCustom) : null;
    // same depth reminder as the Poly panel: any SX stake shown above $50
    const bigOrder = [...rows.map((x) => x.r), ...(customRow ? [customRow] : [])].some((x) => x.sxStakeUsd > 50);
    return { lock, breakeven: breakevenSxOdds(odds), rows, customRow, bigOrder };
  }, [odds, xe, sxOdds, isFreeBet, sxCustom]);

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

    // VOID TAIL — both headline numbers are STAKE-INDEPENDENT (lock and tail scale
    // linearly with stake, so the multiple and the breakeven ratio don't move), which is
    // why they belong in the verdict rather than the per-stake table. Computed off a
    // €1 probe purely to reach `voidTail`; the EUR column in the table is per row.
    const probe = sizePosition({ odds: o, noPrice: n, feeRate, isMaker, isFreeBet, xe: x, stake: 1 });
    const tail = voidTail(probe, 1, x);

    return { pEff, lock, breakeven, inputs, bigOrder, tail };
  }, [inputsReady, odds, noPrice, feeRate, isMaker, isFreeBet, xe, custom]);

  const takerMaker = isMaker ? 'maker' : 'taker';

  return (
    <>

      {/* ---- Inputs ---- */}
      <section className="card inputs-card">
        <div className="grid2">
          <label className="field">
            <span className="field-label">Boost odds</span>
            <input
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={oddsStr}
              onChange={(e) => setOddsStr(e.target.value)}
              placeholder="2.55"
            />
          </label>

          <label className="field">
            <span className="field-label">Polymarket NO (¢)</span>
            <input
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={noStr}
              onChange={(e) => setNoStr(e.target.value)}
              placeholder="50"
            />
          </label>
        </div>

        {/* SX (2026-10-02): the decimal odds for backing the OTHER side on sx.bet — fills the SX panel below */}
        <label className="field">
          <span className="field-label">SX odds</span>
          <input
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={sxStr}
            onChange={(e) => setSxStr(e.target.value)}
            placeholder="optional, e.g. 2.05"
            aria-label="SX odds"
          />
        </label>

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
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={xeStr}
                onChange={(e) => setXeStr(e.target.value)}
                placeholder={String(DEFAULT_XE)}
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

      {/* Poly LEFT, SX RIGHT (user 2026-10-02) — two cards of the SAME shape and size: title, verdict pill,
          breakeven line, void line, the same five columns, a depth note. Stacked on a phone. */}
      <div className={`hedge-cols ${sxView ? 'two' : ''}`} data-testid="hedge-cols">
        {view ? (
          <section className="card hedge-panel">
            {sxView && <h3 className="panel-title">Hedge on Polymarket</h3>}
            <div className="verdict">
              <div className={view.lock.isLock ? 'pill lock' : 'pill dead'}>
                {view.lock.isLock ? 'LOCK' : 'DEAD'}{' '}
                <span className="pill-pct">{view.lock.isLock ? '+' : ''}{fmtPct(view.lock.marginPct)}%</span>
              </div>
              <p className="breakeven">
                Profitable if NO ≤ <strong>{fmtCents(view.breakeven)}¢</strong> ({takerMaker})
              </p>
              {/* VOID TAIL — a void resolves the market 50-50, so the hedge leg alone decides
                  it and the LOCK % above says nothing about the damage. Both figures here are
                  stake-independent, so one line covers every row of the table. */}
              <p
                className={`void-tail ${
                  view.tail.tailEur > 0 && noPrice !== null && noPrice > VOID_WATCH_PRICE_CENTS
                    ? 'void-warn'
                    : ''
                }`}
              >
                {view.tail.tailEur > 0 ? (
                  <>
                    Void tail <strong>{fmtPct(view.tail.tailPerStake, 2)}× stake</strong>
                    {view.tail.breakevenVoidProb !== null && (
                      <>
                        {' — '}−EV if void chance &gt;{' '}
                        <strong>{fmtPct(view.tail.breakevenVoidProb * 100)}%</strong>
                      </>
                    )}
                  </>
                ) : (
                  <>
                    Void <strong>pays</strong> {fmtPct(-view.tail.tailPerStake, 2)}× stake — hedge
                    bought under 50¢
                  </>
                )}
              </p>
            </div>
            <table className="results">
              <thead>
                <tr>
                  <th>{isFreeBet ? 'FB face' : 'Stake'}</th>
                  <th>Shares</th>
                  <th>Hedge cost</th>
                  <th>Net profit</th>
                  <th>Void tail</th>
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
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
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
                      <td className="dim">—</td>
                    </>
                  )}
                </tr>
              </tbody>
            </table>
            {view.bigOrder && (
              <p className="depth-note">⚠ Depth check: for orders &gt; $50, verify the book holds the size.</p>
            )}
          </section>
        ) : (
          // SX odds filled, Poly NO not (or invalid): keep the left slot so SX stays on the right
          sxView && <div className="hedge-panel" />
        )}

        {/* ---- SX panel (2026-10-02): the same bet hedged on SX — same stakes and rate; its own custom stake ---- */}
        {sxView && (
          <section className="card hedge-panel sx-panel" data-testid="sx-panel">
            <h3 className="panel-title">Hedge on SX</h3>
            <div className="verdict">
              <div className={sxView.lock.isLock ? 'pill lock' : 'pill dead'}>
                {sxView.lock.isLock ? 'LOCK' : 'DEAD'}{' '}
                <span className="pill-pct">{sxView.lock.isLock ? '+' : ''}{fmtPct(sxView.lock.marginPct)}%</span>
              </div>
              <p className="breakeven">
                Profitable if SX odds ≥ <strong>{Number.isFinite(sxView.breakeven) ? sxView.breakeven.toFixed(3) : '—'}</strong> (taker, 1% of winnings)
              </p>
              {/* SX refunds every leg on a cancel / draw / no contest, like the bookie — unlike Poly's 50-50 */}
              <p className="void-tail">A void refunds both legs — <strong>no void tail</strong></p>
            </div>
            <table className="results">
              <thead>
                <tr>
                  <th>{isFreeBet ? 'FB face' : 'Stake'}</th>
                  {/* the SX bet's return = the bookie payout — the same figure as Poly's share count */}
                  <th>Returns</th>
                  <th>Stake on SX</th>
                  <th>Net profit</th>
                  <th>Void tail</th>
                </tr>
              </thead>
              <tbody>
                {sxView.rows.map(({ stake, r }) => (
                  <tr key={stake} className={sxView.lock.isLock ? '' : 'row-dead'}>
                    <td className="col-stake">€{stake}</td>
                    <SxCells r={r} isLock={sxView.lock.isLock} />
                  </tr>
                ))}
                <tr className={`custom-row ${sxView.lock.isLock ? '' : 'row-dead'}`}>
                  <td className="col-stake">
                    <span className="euro-prefix">€</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      value={sxCustomStr}
                      onChange={(e) => setSxCustomStr(e.target.value)}
                      placeholder="custom"
                      aria-label="SX custom stake in euros"
                    />
                  </td>
                  {sxView.customRow ? (
                    <SxCells r={sxView.customRow} isLock={sxView.lock.isLock} />
                  ) : (
                    <>
                      <td className="dim">—</td>
                      <td className="dim">—</td>
                      <td className="dim">—</td>
                      <td className="dim">—</td>
                    </>
                  )}
                </tr>
              </tbody>
            </table>
            {sxView.bigOrder && (
              <p className="depth-note">⚠ Depth check: for orders &gt; $50, verify the SX book holds the size.</p>
            )}
          </section>
        )}
      </div>

    </>
  );
}
