import { useState } from 'react';
import { FxToast } from './FxToast';
import { BoostCalc } from './BoostCalc';
import { RollingCalc } from './RollingCalc';
import { DEFAULT_XE } from './calc';
import './App.css';

export type CalcTab = 'boost' | 'rolling' | 'triple';

const TITLE: Record<CalcTab, string> = { boost: 'Boost Hedge', rolling: 'Rolling Double', triple: 'Rolling Triple' };
const TAGLINE: Record<CalcTab, string> = {
  boost: 'Bookie boost × Polymarket NO — lock check & share sizing.',
  rolling: 'Rolling hedge — equal profit on all three outcomes.',
  triple: 'Rolling hedge — equal profit on all four outcomes.',
};
const FOOT: Record<CalcTab, string> = {
  boost: "Sizes one bet's hedge.",
  rolling: 'Sizes both hedges of a double; buy the second only if leg 1 wins.',
  triple: 'Sizes all three hedges of a triple; buy each only if every earlier leg won.',
};

/**
 * Three calculators (2026-09-21 boost + rolling double; 2026-09-24 rolling triple). They share
 * the EUR→USD rate (one FX toast fills all) and the page chrome. The double and the triple are
 * the SAME component with a different leg count, each mounted on its own tab so the numbers
 * typed into one survive a visit to the other.
 */
export default function App() {
  const [tab, setTab] = useState<CalcTab>('boost');
  const [xeStr, setXeStr] = useState(String(DEFAULT_XE));

  return (
    <div className="app">
      {/* Fetches EUR→USD once on load and applies it; pinned top-right until dismissed. */}
      <FxToast onRate={(r) => setXeStr(String(r))} />
      <header className="app-head">
        <h1>{TITLE[tab]}</h1>
        <p className="tagline">{TAGLINE[tab]}</p>
        <div className="tabs" role="tablist" aria-label="Calculator">
          {([['boost', 'Single boost'], ['rolling', 'Rolling double'], ['triple', 'Rolling triple']] as const).map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'tab on' : 'tab'} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>
      </header>

      {tab === 'boost' && <BoostCalc xeStr={xeStr} setXeStr={setXeStr} />}
      {tab === 'rolling' && <RollingCalc key="double" legCount={2} xeStr={xeStr} setXeStr={setXeStr} />}
      {tab === 'triple' && <RollingCalc key="triple" legCount={3} xeStr={xeStr} setXeStr={setXeStr} />}

      <footer className="app-foot">
        <p>
          {FOOT[tab]}{' '}
          Does <strong>not</strong> check order-book depth. No data leaves your device.
        </p>
      </footer>
    </div>
  );
}
