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

/**
 * Defaults per leg count — each a KNOWN-GOOD position pinned in rolling.test.ts, so the page
 * opens on numbers the tests vouch for: the double is the spec's worked example, the triple is
 * the double's two legs plus a third positive leg (2.10 @44¢) — a lock, four equal branches.
 */
const DEFAULTS: Record<2 | 3, { stake: string; legs: LegForm[] }> = {
  2: { stake: '37.15', legs: [{ info: '', odds: '2.02', price: '43', feeOn: true }, { info: '', odds: '2.20', price: '50', feeOn: true }] },
  3: { stake: '20', legs: [{ info: '', odds: '2.02', price: '43', feeOn: true }, { info: '', odds: '2.20', price: '50', feeOn: true }, { info: '', odds: '2.10', price: '44', feeOn: true }] },
};
const INFO_PLACEHOLDER = 'paste the board row: date · league · bookie · fixture · bet';

/** "leg 1" / "legs 1–2" / "legs 1–3": the legs that must have WON before leg k's hedge is bought. */
const priorLegs = (k: number): string => (k === 1 ? 'leg 1' : `legs 1–${k}`);
const legSub = (k: number): string => (k === 0 ? 'finishes first — hedge bought now' : k === 1 ? 'hedge bought only if leg 1 wins' : `hedge bought only if legs 1–${k} win`);
const stepLabel = (k: number): string => (k === 0 ? '1 · buy now' : `${k + 1} · only if ${priorLegs(k)} win${k === 1 ? 's' : ''}`);
/** Branch names A, B, C, …: "leg 1 fails", "leg 1 wins, leg 2 fails", "legs 1–2 win, leg 3 fails", "all win". */
function branchName(k: number, n: number): string {
  const letter = String.fromCharCode(65 + k);
  if (k === n) return `${letter} · ${n === 2 ? 'both' : 'all'} win`;
  if (k === 0) return `${letter} · leg 1 fails`;
  return `${letter} · ${priorLegs(k)} win${k === 1 ? 's' : ''}, leg ${k + 1} fails`;
}

function NumField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input type="text" inputMode="decimal" autoComplete="off" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function LegCard({ k, leg, onChange, gate }: { k: number; leg: LegForm; onChange: (patch: Partial<LegForm>) => void; gate: number | null }) {
  const n = k + 1;
  return (
    <fieldset className="leg">
      <legend>
        Leg {n} <span className="leg-sub">{legSub(k)}</span>
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

/**
 * The rolling-hedge calculator for a DOUBLE (legCount 2, the 2026-09-21 original) or a TRIPLE
 * (legCount 3, 2026-09-24). One component: the math (rolling.ts) and the summary were already
 * N-leg, only this UI was wired to two legs. Each tab mounts its own instance, so the double's
 * numbers survive a visit to the triple tab and back.
 */
export function RollingCalc({ legCount = 2, xeStr, setXeStr }: { legCount?: 2 | 3; xeStr: string; setXeStr: (s: string) => void }) {
  const [stakeStr, setStakeStr] = useState(DEFAULTS[legCount].stake);
  const [payoutStr, setPayoutStr] = useState('');
  // MULTIPLE BONUS (user 2026-09-24): "some bookies give you bonuses for multiples/doubles/triples".
  // Percent on top of stake × odds; blank = none. A slip payout, when given, already includes it.
  const [bonusStr, setBonusStr] = useState('');
  const [market, setMarket] = useState<MarketType>('sports');
  const [legs, setLegs] = useState<LegForm[]>(DEFAULTS[legCount].legs);
  const [advOpen, setAdvOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const patchLeg = (i: number) => (patch: Partial<LegForm>) =>
    setLegs((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  /** Swap legs i and i+1 — leg order is chronological, and that is what the strategy hinges on. */
  const swapLegs = (i: number) => () =>
    setLegs((prev) => prev.map((l, j) => (j === i ? prev[i + 1] : j === i + 1 ? prev[i] : l)));

  const stake = parseNum(stakeStr);
  const payout = parseNum(payoutStr);
  const bonus = parseNum(bonusStr);
  const xe = parseNum(xeStr);
  const odds = legs.map((l) => parseNum(l.odds));
  const prices = legs.map((l) => parseNum(l.price));
  const feeRate = FEE_RATES[market];
  const n = legs.length;

  const errors: string[] = [];
  if (stake !== null && stake <= 0) errors.push('Stake must be greater than 0.');
  odds.forEach((o, i) => { if (o !== null && o <= 1) errors.push(`Leg ${i + 1} odds must be greater than 1.`); });
  prices.forEach((p, i) => { if (p !== null && (p <= 0 || p >= 100)) errors.push(`Leg ${i + 1} Poly price must be between 0 and 100¢.`); });
  if (xe !== null && xe <= 0) errors.push('Exchange rate must be greater than 0.');
  if (payoutStr.trim() && (payout === null || payout <= 0)) errors.push('Slip payout must be a positive number (or blank).');
  if (bonusStr.trim() && (bonus === null || bonus < 0)) errors.push('Bonus must be a percentage of 0 or more (or blank).');

  const ready = stake !== null && stake > 0 && xe !== null && xe > 0
    && odds.every((o) => o !== null && o > 1) && prices.every((p) => p !== null && p > 0 && p < 100)
    && (!payoutStr.trim() || (payout !== null && payout > 0))
    && (!bonusStr.trim() || (bonus !== null && bonus >= 0));

  const view = useMemo(() => {
    if (!ready) return null;
    const r = rollingHedge({
      stake: stake as number,
      legs: legs.map((l, i) => ({ odds: odds[i] as number, priceCents: prices[i] as number, feeOn: l.feeOn })),
      feeRate,
      xe: xe as number,
      payout: payoutStr.trim() ? payout : null,
      bonusPct: bonusStr.trim() ? bonus : null,
    });
    const info: LegInfo[] = legs.map((l, i) => ({ info: l.info, odds: odds[i] as number, priceCents: prices[i] as number, feeOn: l.feeOn }));
    const summary = rollingSummary({ stake: stake as number, xe: xe as number, legs: info }, r);
    const bigOrder = r.legs.some((l) => l.costUsd > 50);
    return { r, summary, bigOrder };
  }, [ready, stake, legs, odds, prices, feeRate, xe, payout, payoutStr, bonus, bonusStr]);

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

  const negLegs = view ? view.r.legs.filter((l) => l.gate < 1).length : 0;
  const bonusApplied = view && bonusStr.trim() && bonus !== null && bonus > 0;

  return (
    <>
      <section className="card">
        <div className="grid2">
          <NumField label="Stake (€)" value={stakeStr} onChange={setStakeStr} placeholder={DEFAULTS[legCount].stake} />
          <NumField label="Slip payout (€, optional)" value={payoutStr} onChange={setPayoutStr} placeholder={view ? fmtShares(view.r.nominalPayout) : 'stake × odds'} />
        </div>
        <div className="grid2">
          <NumField label="Multiple bonus (%, optional)" value={bonusStr} onChange={setBonusStr} placeholder="e.g. 10" />
          <label className="field">
            <span className="field-label">Market type</span>
            <select value={market} onChange={(e) => setMarket(e.target.value as MarketType)}>
              {MARKET_TYPES.map((m) => (
                <option key={m} value={m}>{MARKET_LABELS[m]} — fee {(FEE_RATES[m] * 100).toFixed(0)}%</option>
              ))}
            </select>
          </label>
        </div>

        {legs.map((leg, k) => (
          <div key={k}>
            {k > 0 && (
              <div className="swap-row">
                <button type="button" className="swap" onClick={swapLegs(k - 1)} title={`Leg ${k} must finish before leg ${k + 1} starts`}>⇅ swap legs</button>
              </div>
            )}
            <LegCard k={k} leg={leg} onChange={patchLeg(k)} gate={view ? view.r.legs[k].gate : null} />
          </div>
        ))}

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
            {' '}({view.r.legs.map((l, k) => `leg ${k + 1} ${l.gate >= 1 ? '+' : ''}${fmtPct((l.gate - 1) * 100)}%`).join(' · ')})
          </p>
          {negLegs > 0 && view.r.isLock && (
            <p className="void-tail void-warn">
              {negLegs === 1 ? 'One leg is negative on its own — the other leg' : `${negLegs} legs are negative on their own — the rest`}{negLegs === 1 && n > 2 ? 's carry' : negLegs === 1 ? ' carries' : ' carry'} the whole edge.
            </p>
          )}
          {view.r.gate < 1 && <p className="void-tail void-warn">Gate below 1: this {n === 2 ? 'double' : 'triple'} loses on every branch after hedge costs.</p>}
        </section>
      )}

      {view && (
        <section className="card">
          <table className="results">
            <thead>
              <tr><th>Step</th><th>Shares</th><th>@ eff.</th><th>Cost</th></tr>
            </thead>
            <tbody>
              {view.r.legs.map((l, k) => (
                <tr key={k}>
                  <td className="col-stake">{stepLabel(k)}</td>
                  <td className="mono">{fmtShares(l.shares)}</td>
                  <td className="mono">{fmtCents(l.pEff * 100)}¢</td>
                  <td className="mono">{fmtUsd(l.costUsd)}</td>
                </tr>
              ))}
              <tr>
                <td className="col-stake">total if {n === 2 ? 'both' : 'all'} fire</td>
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
              {view.r.branches.map((net, k) => (
                <tr key={k}>
                  <td className="col-stake">{branchName(k, n)}</td>
                  <td className="dim">{k === n ? `bookie €${fmtShares(view.r.payout)}` : `leg-${k + 1} tokens`}</td>
                  <td className={`col-profit mono ${net >= 0 ? 'pos' : 'neg'}`}>{fmtMoneyEur(net)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {bonusApplied && !payoutStr.trim() && (
            <p className="depth-note">Bonus {fmtShares(bonus as number)}% applied: payout €{fmtShares(view.r.nominalPayout)} instead of €{fmtShares(view.r.nominalPayout / (1 + (bonus as number) / 100))}.</p>
          )}
          {payoutStr.trim() && Math.abs(view.r.payout - view.r.nominalPayout) >= 0.005 && (
            <p className="depth-note">Slip pays €{fmtShares(view.r.payout)} vs nominal €{fmtShares(view.r.nominalPayout)}{bonusApplied ? ' (bonus included)' : ''} — sized on the slip.</p>
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
