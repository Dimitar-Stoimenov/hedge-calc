import { useMemo, useState } from 'react';
import { DEFAULT_XE, FEE_RATES, MARKET_TYPES, type MarketType } from './calc';
import { rollingHedge } from './rolling';
import { rollingSummary, type LegInfo } from './summary';
import { fmtCents, fmtMoneyEur, fmtPct, fmtShares, fmtUsd } from './format';
import { parseNum } from './parse';

const MARKET_LABELS: Record<MarketType, string> = {
  sports: 'Sports',
  politics: 'Politics',
  finance: 'Finance',
  crypto: 'Crypto',
  geopolitics: 'Geopolitics',
};

/** Everything the user types about ONE leg — numbers as strings (mid-typing tolerant). */
interface LegForm {
  /** Free text pasted from the board — see summary.LegInfo.info. */
  info: string;
  odds: string;
  price: string;
  feeOn: boolean;
}

// Defaults = the spec's worked example, so the page opens on a known-good position.
const LEG1: LegForm = { info: '', odds: '2.02', price: '43', feeOn: true };
const LEG2: LegForm = { info: '', odds: '2.20', price: '50', feeOn: true };
const INFO_PLACEHOLDER = 'paste the board row: date · league · bookie · fixture · bet';

function NumField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input type="text" inputMode="decimal" autoComplete="off" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function LegCard({ n, leg, onChange, gate }: { n: 1 | 2; leg: LegForm; onChange: (patch: Partial<LegForm>) => void; gate: number | null }) {
  return (
    <fieldset className="leg">
      <legend>
        Leg {n} <span className="leg-sub">{n === 1 ? 'finishes first — hedge bought now' : 'hedge bought only if leg 1 wins'}</span>
        {gate !== null && (
          <span className={`leg-gate ${gate >= 1 ? 'pos' : 'neg'}`} title="This leg's own edge: odds × (1 − effective Poly price) − 1">
            {gate >= 1 ? '+' : ''}{fmtPct((gate - 1) * 100)}%
          </span>
        )}
      </legend>
      <label className="field">
        <span className="field-label">Bet info</span>
        <textarea rows={2} value={leg.info} placeholder={INFO_PLACEHOLDER} onChange={(e) => onChange({ info: e.target.value })} />
      </label>
      <div className="grid2">
        <NumField label="Bookie odds" value={leg.odds} onChange={(v) => onChange({ odds: v })} placeholder="2.02" />
        <NumField label="Poly opposite side (¢)" value={leg.price} onChange={(v) => onChange({ price: v })} placeholder="43" />
      </div>
      <div className="segmented" role="group" aria-label={`Leg ${n} fee`}>
        <button type="button" className={leg.feeOn ? 'seg on' : 'seg'} onClick={() => onChange({ feeOn: true })}>Taker</button>
        <button type="button" className={!leg.feeOn ? 'seg on' : 'seg'} onClick={() => onChange({ feeOn: false })}>No fee</button>
      </div>
    </fieldset>
  );
}

export function RollingCalc({ xeStr, setXeStr }: { xeStr: string; setXeStr: (s: string) => void }) {
  const [stakeStr, setStakeStr] = useState('37.15');
  const [payoutStr, setPayoutStr] = useState('');
  const [market, setMarket] = useState<MarketType>('sports');
  const [legs, setLegs] = useState<[LegForm, LegForm]>([LEG1, LEG2]);
  const [advOpen, setAdvOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const patchLeg = (i: 0 | 1) => (patch: Partial<LegForm>) =>
    setLegs((prev) => (i === 0 ? [{ ...prev[0], ...patch }, prev[1]] : [prev[0], { ...prev[1], ...patch }]));
  const swapLegs = () => setLegs((prev) => [prev[1], prev[0]]);

  const stake = parseNum(stakeStr);
  const payout = parseNum(payoutStr);
  const xe = parseNum(xeStr);
  const odds = legs.map((l) => parseNum(l.odds));
  const prices = legs.map((l) => parseNum(l.price));
  const feeRate = FEE_RATES[market];

  const errors: string[] = [];
  if (stake !== null && stake <= 0) errors.push('Stake must be greater than 0.');
  odds.forEach((o, i) => { if (o !== null && o <= 1) errors.push(`Leg ${i + 1} odds must be greater than 1.`); });
  prices.forEach((p, i) => { if (p !== null && (p <= 0 || p >= 100)) errors.push(`Leg ${i + 1} Poly price must be between 0 and 100¢.`); });
  if (xe !== null && xe <= 0) errors.push('Exchange rate must be greater than 0.');
  if (payoutStr.trim() && (payout === null || payout <= 0)) errors.push('Slip payout must be a positive number (or blank).');

  const ready = stake !== null && stake > 0 && xe !== null && xe > 0
    && odds.every((o) => o !== null && o > 1) && prices.every((p) => p !== null && p > 0 && p < 100)
    && (!payoutStr.trim() || (payout !== null && payout > 0));

  const view = useMemo(() => {
    if (!ready) return null;
    const r = rollingHedge({
      stake: stake as number,
      legs: legs.map((l, i) => ({ odds: odds[i] as number, priceCents: prices[i] as number, feeOn: l.feeOn })),
      feeRate,
      xe: xe as number,
      payout: payoutStr.trim() ? payout : null,
    });
    const info: LegInfo[] = legs.map((l, i) => ({ info: l.info, odds: odds[i] as number, priceCents: prices[i] as number, feeOn: l.feeOn }));
    const summary = rollingSummary({ stake: stake as number, xe: xe as number, legs: info }, r);
    const bigOrder = r.legs.some((l) => l.costUsd > 50);
    return { r, summary, bigOrder };
  }, [ready, stake, legs, odds, prices, feeRate, xe, payout, payoutStr]);

  async function copySummary() {
    if (!view) return;
    try {
      await navigator.clipboard.writeText(view.summary);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // clipboard blocked — the text stays selectable below
    }
  }

  return (
    <>
      <section className="card">
        <div className="grid2">
          <NumField label="Stake (€)" value={stakeStr} onChange={setStakeStr} placeholder="37.15" />
          <NumField label="Slip payout (€, optional)" value={payoutStr} onChange={setPayoutStr} placeholder={view ? fmtShares(view.r.nominalPayout) : 'stake × odds'} />
        </div>
        <label className="field">
          <span className="field-label">Market type</span>
          <select value={market} onChange={(e) => setMarket(e.target.value as MarketType)}>
            {MARKET_TYPES.map((m) => (
              <option key={m} value={m}>{MARKET_LABELS[m]} — fee {(FEE_RATES[m] * 100).toFixed(0)}%</option>
            ))}
          </select>
        </label>

        <LegCard n={1} leg={legs[0]} onChange={patchLeg(0)} gate={view ? view.r.legs[0].gate : null} />
        <div className="swap-row">
          <button type="button" className="swap" onClick={swapLegs} title="Leg 1 must be the match that finishes first">⇅ swap legs</button>
        </div>
        <LegCard n={2} leg={legs[1]} onChange={patchLeg(1)} gate={view ? view.r.legs[1].gate : null} />

        <div className="advanced">
          <button type="button" className="adv-toggle" onClick={() => setAdvOpen((v) => !v)} aria-expanded={advOpen}>
            {advOpen ? '▾' : '▸'} Advanced
          </button>
          {advOpen && (
            <label className="field">
              <span className="field-label">EUR → USD rate</span>
              <input type="text" inputMode="decimal" autoComplete="off" value={xeStr} onChange={(e) => setXeStr(e.target.value)} placeholder={String(DEFAULT_XE)} />
            </label>
          )}
        </div>

        {errors.length > 0 && <ul className="hints">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
      </section>

      {view && (
        <section className="verdict">
          <div className={view.r.isLock ? 'pill lock' : 'pill dead'}>
            {view.r.isLock ? 'LOCK' : 'DEAD'}{' '}
            <span className="pill-pct">{view.r.lock >= 0 ? '+' : ''}{fmtPct(view.r.lockPct * 100)}%</span>
          </div>
          <p className="breakeven">
            Lock <strong>{fmtMoneyEur(view.r.lock)}</strong> on every outcome · gate{' '}
            <strong className={view.r.gate >= 1 ? '' : 'neg-text'}>{view.r.gate >= 1 ? '+' : ''}{fmtPct((view.r.gate - 1) * 100)}%</strong>
            {' '}(leg 1 {view.r.legs[0].gate >= 1 ? '+' : ''}{fmtPct((view.r.legs[0].gate - 1) * 100)}% · leg 2 {view.r.legs[1].gate >= 1 ? '+' : ''}{fmtPct((view.r.legs[1].gate - 1) * 100)}%)
          </p>
          {view.r.legs.some((l) => l.gate < 1) && view.r.isLock && (
            <p className="void-tail void-warn">One leg is negative on its own — the other leg carries the whole edge.</p>
          )}
          {view.r.gate < 1 && <p className="void-tail void-warn">Gate below 1: this double loses on every branch after hedge costs.</p>}
        </section>
      )}

      {view && (
        <section className="card">
          <table className="results">
            <thead>
              <tr><th>Step</th><th>Shares</th><th>@ eff.</th><th>Cost</th></tr>
            </thead>
            <tbody>
              <tr>
                <td className="col-stake">1 · buy now</td>
                <td className="mono">{fmtShares(view.r.legs[0].shares)}</td>
                <td className="mono">{fmtCents(view.r.legs[0].pEff * 100)}¢</td>
                <td className="mono">{fmtUsd(view.r.legs[0].costUsd)}</td>
              </tr>
              <tr>
                <td className="col-stake">2 · only if leg 1 wins</td>
                <td className="mono">{fmtShares(view.r.legs[1].shares)}</td>
                <td className="mono">{fmtCents(view.r.legs[1].pEff * 100)}¢</td>
                <td className="mono">{fmtUsd(view.r.legs[1].costUsd)}</td>
              </tr>
              <tr>
                <td className="col-stake">total if both fire</td>
                <td className="dim">—</td>
                <td className="dim">—</td>
                <td className="mono">{fmtUsd(view.r.totalCostUsd)}</td>
              </tr>
            </tbody>
          </table>

          <table className="results branches">
            <thead>
              <tr><th>Outcome</th><th>Who pays</th><th>Net</th></tr>
            </thead>
            <tbody>
              {[
                ['A · leg 1 fails', 'leg-1 tokens'],
                ['B · leg 1 wins, leg 2 fails', 'leg-2 tokens'],
                ['C · both win', `bookie €${fmtShares(view.r.payout)}`],
              ].map(([name, who], i) => (
                <tr key={name}>
                  <td className="col-stake">{name}</td>
                  <td className="dim">{who}</td>
                  <td className={`col-profit mono ${view.r.branches[i] >= 0 ? 'pos' : 'neg'}`}>{fmtMoneyEur(view.r.branches[i])}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {payoutStr.trim() && Math.abs(view.r.payout - view.r.nominalPayout) >= 0.005 && (
            <p className="depth-note">Slip pays €{fmtShares(view.r.payout)} vs nominal €{fmtShares(view.r.nominalPayout)} — sized on the slip.</p>
          )}
          {view.bigOrder && <p className="depth-note">⚠ Depth check: for orders &gt; $50, verify the book holds the size.</p>}
        </section>
      )}

      {view && (
        <section className="card summary-card">
          <div className="summary-head">
            <span className="field-label">Summary — paste to your bet log</span>
            <button type="button" className="fx-toast-copy" onClick={copySummary}>{copied ? '✓ copied' : 'Copy'}</button>
          </div>
          <pre className="summary">{view.summary}</pre>
        </section>
      )}
    </>
  );
}
