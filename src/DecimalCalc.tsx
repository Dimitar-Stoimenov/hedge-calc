import { useState } from 'react';
import { sizeDecimalArb } from './calc';
import { fmtMoneyEur, fmtPct } from './format';
import { parseNum } from './parse';

const LEG_NAMES = ['A', 'B'];

/** One stake cell: the bare number copies (what gets typed into the bookie), like the SX stake. */
function StakeCopy({ eur, isLock }: { eur: number; isLock: boolean }) {
  const [copied, setCopied] = useState(false);
  const text = eur.toFixed(2);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // clipboard blocked (e.g. non-secure context) — silently ignore
    }
  }
  return (
    <button type="button" className={`shares-copy ${isLock ? '' : 'muted'}`} onClick={copy} title="Copy stake to clipboard" aria-label="Copy stake">
      <span className="mono">€{text}</span>
      <span className="copy-hint">{copied ? '✓' : '⧉'}</span>
    </button>
  );
}

/**
 * BOOKIE vs BOOKIE — decimal vs decimal (user 2026-10-03: "i need a calculator for regular odds"). The sizing tool for
 * the live scanner's bookie-vs-bookie rows, with the SAME rule: leg A fixed (default €10), every other leg rounded to a
 * multiple of €0.10, floor or ceil, whichever keeps the higher worst case. Euro only — both legs are bookies.
 */
export function DecimalCalc() {
  // TWO legs only (user 2026-10-03: "remove the calc 3 way") — the same rule as the live scanner's rows.
  const ways = 2;
  const [oddsStr, setOddsStr] = useState(['2.10', '2.25']);
  const [mode, setMode] = useState<'lead' | 'total'>('lead');
  const [leadStr, setLeadStr] = useState('10');
  const [totalStr, setTotalStr] = useState('100');
  const [freeBet, setFreeBet] = useState(false);

  const odds = oddsStr.slice(0, ways).map(parseNum);
  const amount = parseNum(mode === 'lead' ? leadStr : totalStr);

  const errors: string[] = [];
  odds.forEach((o, i) => { if (o !== null && o <= 1) errors.push(`Leg ${LEG_NAMES[i]} odds must be greater than 1.`); });
  if (amount !== null && amount <= 0) errors.push('Stake must be greater than 0.');

  const ready = odds.every((o) => o !== null && o > 1) && amount !== null && amount > 0;
  // two legs × floor/ceil — cheap enough to size on every render
  const r = ready ? sizeDecimalArb({ odds: odds as number[], mode, amount: amount as number, freeBetLead: freeBet }) : null;

  const setOdd = (i: number, v: string) => setOddsStr((xs) => xs.map((x, j) => (j === i ? v : x)));
  const last = LEG_NAMES[ways - 1];
  const be = r?.breakevenLast;

  return (
    <>
      <section className="card inputs-card">
        <div className="grid2">
          {LEG_NAMES.slice(0, ways).map((name, i) => (
            <label className="field" key={name}>
              <span className="field-label">Leg {name} odds</span>
              <input
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={oddsStr[i]}
                onChange={(e) => setOdd(i, e.target.value)}
                placeholder="2.00"
                aria-label={`Leg ${name} odds`}
              />
            </label>
          ))}
        </div>

        <div className="toggle-row">
          <div className="segmented" role="group" aria-label="Stake mode">
            <button type="button" className={mode === 'lead' ? 'seg on' : 'seg'} onClick={() => setMode('lead')}>Stake on leg A</button>
            <button type="button" className={mode === 'total' ? 'seg on' : 'seg'} onClick={() => setMode('total')}>Total stake</button>
          </div>
          <label className="checkbox">
            <input type="checkbox" checked={freeBet} onChange={(e) => setFreeBet(e.target.checked)} />
            <span>Leg A free bet (SNR)</span>
          </label>
        </div>

        <label className="field">
          <span className="field-label">{mode === 'lead' ? (freeBet ? 'Free bet on leg A €' : 'Stake on leg A €') : 'Total stake €'}</span>
          <input
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={mode === 'lead' ? leadStr : totalStr}
            onChange={(e) => (mode === 'lead' ? setLeadStr(e.target.value) : setTotalStr(e.target.value))}
            placeholder={mode === 'lead' ? '10' : '100'}
            aria-label="Stake amount in euros"
          />
        </label>

        {errors.length > 0 && (
          <ul className="hints">
            {errors.map((e) => <li key={e}>{e}</li>)}
          </ul>
        )}
      </section>

      {r && (
        <section className="card hedge-panel" data-testid="decimal-result">
          <div className="verdict">
            <div className={r.isLock ? 'pill lock' : 'pill dead'}>
              {r.isLock ? 'LOCK' : 'DEAD'}{' '}
              <span className="pill-pct">{r.isLock ? '+' : ''}{fmtPct(r.exactProfitPct, 2)}%</span>
            </div>
            <p className="breakeven">
              Rounded to €0.10: worst case <strong>{fmtMoneyEur(r.rounded.worstProfitEur)}</strong> ({fmtPct(r.rounded.worstProfitPct, 2)}%{freeBet ? ' of the free bet' : ''})
              {' '}on <strong>€{r.rounded.totalEur.toFixed(2)}</strong> cash
            </p>
            <p className="breakeven">
              {be !== undefined && Number.isFinite(be)
                ? <>Leg {last} must be ≥ <strong>{(Math.ceil(be * 100 - 1e-9) / 100).toFixed(2)}</strong> to lock</>
                : <>No leg {last} price can lock against the others</>}
            </p>
          </div>
          <table className="results">
            <thead>
              <tr>
                <th>Leg</th>
                <th>Odds</th>
                <th>Stake</th>
                <th>Returns</th>
                <th>Profit if it wins</th>
              </tr>
            </thead>
            <tbody>
              {r.rounded.stakes.map((s, i) => (
                <tr key={i} className={r.isLock ? '' : 'row-dead'}>
                  <td className="col-stake">{LEG_NAMES[i]}{freeBet && i === 0 ? ' (FB)' : ''}</td>
                  <td className="mono">{(odds[i] as number).toFixed(2)}</td>
                  <td className="col-cost"><StakeCopy eur={s} isLock={r.isLock} /></td>
                  <td className="mono">€{r.rounded.returns[i].toFixed(2)}</td>
                  <td className={`col-profit mono ${r.rounded.profitsEur[i] >= 0 ? 'pos' : 'neg'}`}>{fmtMoneyEur(r.rounded.profitsEur[i])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
