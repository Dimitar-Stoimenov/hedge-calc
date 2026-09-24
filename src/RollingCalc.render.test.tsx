import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { RollingCalc } from './RollingCalc';
import App from './App';

/**
 * Static render of the rolling calculator at its defaults (the spec's worked example: €37.15,
 * 2.02 @43¢ × 2.20 @50¢, sports taker) with the spec's XE — guards the JSX wiring; the
 * arithmetic itself is pinned in rolling.test.ts and swept in rolling.invariants.test.ts.
 */
const h = renderToStaticMarkup(<RollingCalc xeStr="1.147649513" setXeStr={() => {}} />);

describe('RollingCalc (worked-example defaults)', () => {
  it('shows LOCK +20.8% and the equal lock on every outcome', () => {
    expect(h).toMatch(/class="pill lock"/);
    expect(h).toMatch(/\+20\.8%/);
    expect(h).toMatch(/Lock <strong>\+€7\.7[0-9]<\/strong> on every outcome/);
    // three branch rows, all the same figure
    expect((h.match(/class="col-profit mono pos">\+€7\.7[0-9]/g) ?? []).length).toBe(3);
  });

  it('shows both steps: buy now 92.37 @44.2¢ ≈ $40.85, then 189.47 @51.2¢ only if leg 1 wins (no slip payout → nominal, the spec figures exactly)', () => {
    expect(h).toMatch(/1 · buy now<\/td><td class="mono">92.3[67]<\/td><td class="mono">44\.2¢<\/td><td class="mono">\$40\.8[0-9]/);
    expect(h).toMatch(/2 · only if leg 1 wins<\/td><td class="mono">189\.47<\/td><td class="mono">51.[23]¢<\/td><td class="mono">\$97\.1[0-9]/);
    expect(h).toMatch(/total if both fire/);
  });

  it('per-leg gates: +12.7% and +7.3%', () => {
    expect(h).toMatch(/leg-gate pos"[^>]*>\+12\.7%/);
    expect(h).toMatch(/leg-gate pos"[^>]*>\+7\.3%/);
  });

  it('renders the lean copyable summary: both Poly actions, "?" for blank bet info, the verify line', () => {
    expect(h).toMatch(/<pre class="summary">ROLLING DOUBLE — stake €37\.15/);
    expect(h).toMatch(/→ BUY NOW: 92\.3[67] shares ≈ \$40\.8[0-9]/);
    expect(h).toMatch(/→ BUY ONLY IF LEG 1 WINS: 189\.47 shares ≈ \$97\.1[0-9]/);
    expect(h).toMatch(/Leg 1: \? @2\.02 · Poly opposite @43¢ \(taker\)/);
    expect(h).toMatch(/Please verify all calculations are correct\.<\/pre>/);
  });

  it('has one free-text bet-info box per leg, a plain Taker / No fee toggle, and the swap button', () => {
    expect((h.match(/<textarea[^>]*rows="2"/g) ?? []).length).toBe(2);
    expect((h.match(/class="seg on">Taker<\/button>/g) ?? []).length).toBe(2);
    expect(h).not.toMatch(/fee 5%<\/button>/);
    expect(h).toMatch(/⇅ swap legs/);
    expect(h).not.toMatch(/datetime-local/);
  });

  it('numeric inputs stay type=text + inputmode=decimal; no type=number anywhere', () => {
    expect(h).not.toMatch(/type="number"/);
    expect((h.match(/inputmode="decimal"/gi) ?? []).length).toBeGreaterThanOrEqual(6);
  });
});

describe('a dead double', () => {
  const d = renderToStaticMarkup(<RollingCalc xeStr="1.15" setXeStr={() => {}} />);
  it('defaults are a lock, so the DEAD copy is absent at the defaults (sanity of the branch)', () => {
    expect(d).not.toMatch(/Gate below 1/);
  });
});

describe('App shell', () => {
  const a = renderToStaticMarkup(<App />);
  it('opens on the single-boost tab with both tabs present', () => {
    expect(a).toMatch(/role="tab" aria-selected="true"[^>]*>Single boost/);
    expect(a).toMatch(/role="tab" aria-selected="false"[^>]*>Rolling double/);
    expect(a).toMatch(/<h1>Boost Hedge<\/h1>/);
    expect(a).not.toMatch(/ROLLING DOUBLE/);
  });
});

/**
 * ROLLING TRIPLE (user 2026-09-24): the same component with legCount 3, at the tested three-leg
 * defaults (€20; 2.02 @43¢, 2.20 @50¢, 2.10 @44¢, sports taker, XE 1.15) — a LOCK with four equal outcomes.
 */
describe('RollingCalc legCount=3 (triple defaults)', () => {
  const t = renderToStaticMarkup(<RollingCalc legCount={3} xeStr="1.15" setXeStr={() => {}} />);
  it('three leg cards, two swap buttons (1↔2, 2↔3), three step rows and a total, FOUR equal branch rows', () => {
    expect((t.match(/<textarea[^>]*rows="2"/g) ?? []).length).toBe(3);
    expect((t.match(/⇅ swap legs/g) ?? []).length).toBe(2);
    expect(t).toMatch(/1 · buy now/);
    expect(t).toMatch(/2 · only if leg 1 wins/);
    expect(t).toMatch(/3 · only if legs 1–2 win/);
    expect(t).toMatch(/total if all fire/);
    expect(t).toMatch(/A · leg 1 fails/);
    expect(t).toMatch(/B · leg 1 wins, leg 2 fails/);
    expect(t).toMatch(/C · legs 1–2 win, leg 3 fails/);
    expect(t).toMatch(/D · all win/);
    const nets = t.match(/class="col-profit mono (?:pos|neg)">([^<]+)</g) ?? [];
    expect(nets).toHaveLength(4);
    expect(new Set(nets).size).toBe(1); // every outcome pays the same
  });
  it('leg 3 says its hedge waits for legs 1 and 2; the summary is a 3-LEG PARLAY', () => {
    expect(t).toMatch(/hedge bought only if legs 1–2 win/);
    expect(t).toMatch(/class="pill lock"/); // the page opens on a known-good triple
    expect(t).toMatch(/<pre class="summary">ROLLING 3-LEG PARLAY — stake €20\.00/);
    expect(t).toMatch(/→ BUY ONLY IF LEGS 1–2 WIN:/);
  });
  it('has a bonus % field, blank by default', () => {
    expect(t).toMatch(/Multiple bonus \(%, optional\)/);
  });
});

describe('RollingCalc bonus', () => {
  it('the double still renders exactly as before when the bonus is blank (no bonus text)', () => {
    expect(h).not.toMatch(/bonus applied/i);
  });
});

describe('App shell — three tabs', () => {
  const a = renderToStaticMarkup(<App />);
  it('shows the Rolling triple tab too', () => {
    expect(a).toMatch(/role="tab" aria-selected="false"[^>]*>Rolling triple/);
  });
});
