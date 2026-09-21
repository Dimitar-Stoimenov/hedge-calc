import { useState } from 'react';
import { FxToast } from './FxToast';
import { BoostCalc } from './BoostCalc';
import { RollingCalc } from './RollingCalc';
import { DEFAULT_XE } from './calc';
import './App.css';

export type CalcTab = 'boost' | 'rolling';

/**
 * Two calculators side by side (2026-09-21): the original single-boost hedge and the two-leg
 * ROLLING double. They share the EUR→USD rate (one FX toast fills both) and the page chrome.
 */
export default function App() {
  const [tab, setTab] = useState<CalcTab>('boost');
  const [xeStr, setXeStr] = useState(String(DEFAULT_XE));

  return (
    <div className="app">
      {/* Fetches EUR→USD once on load and applies it; pinned top-right until dismissed. */}
      <FxToast onRate={(r) => setXeStr(String(r))} />
      <header className="app-head">
        <h1>{tab === 'boost' ? 'Boost Hedge' : 'Rolling Double'}</h1>
        <p className="tagline">
          {tab === 'boost'
            ? 'Bookie boost × Polymarket NO — lock check & share sizing.'
            : 'Rolling hedge — equal profit on all three outcomes.'}
        </p>
        <div className="tabs" role="tablist" aria-label="Calculator">
          <button type="button" role="tab" aria-selected={tab === 'boost'} className={tab === 'boost' ? 'tab on' : 'tab'} onClick={() => setTab('boost')}>
            Single boost
          </button>
          <button type="button" role="tab" aria-selected={tab === 'rolling'} className={tab === 'rolling' ? 'tab on' : 'tab'} onClick={() => setTab('rolling')}>
            Rolling double
          </button>
        </div>
      </header>

      {tab === 'boost' ? <BoostCalc xeStr={xeStr} setXeStr={setXeStr} /> : <RollingCalc xeStr={xeStr} setXeStr={setXeStr} />}

      <footer className="app-foot">
        <p>
          {tab === 'boost' ? "Sizes one bet's hedge." : 'Sizes both hedges of a double; buy the second only if leg 1 wins.'}{' '}
          Does <strong>not</strong> check order-book depth. No data leaves your device.
        </p>
      </footer>
    </div>
  );
}
