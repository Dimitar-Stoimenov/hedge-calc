# Boost Hedge Calculator

A tiny, mobile-friendly React app for sizing a bookie-boost / Polymarket hedge on
the fly. Enter the boosted odds and the Polymarket **NO** ask, and it instantly
shows whether the position **locks**, the profit %, the shares to buy for €10 / €20
/ a custom stake, the USD hedge cost, the net EUR profit, and the breakeven NO price.

A second tab, **Rolling double** (2026-09-21), sizes a two-leg bookie parlay hedged one leg at a time:
the leg-2 hedge is bought only if leg 1 wins, and the share counts make all three outcomes (leg 1 fails;
leg 1 wins, leg 2 fails; both win) pay the same. It takes per-leg game info and produces a plain-text
summary to paste into a bet log. Math in [src/rolling.ts](src/rolling.ts), pinned by the spec's worked
example in [src/rolling.test.ts](src/rolling.test.ts) and swept over thousands of random positions by an
independent cash-flow replay in [src/rolling.invariants.test.ts](src/rolling.invariants.test.ts).

No backend, no storage — the only network call is the EUR→USD rate on load.

## Develop

```bash
npm install
npm run dev      # start the dev server
npm run test     # watch unit tests (formulas)
npm run test:run # run unit tests once
npm run build    # type-check + production build to dist/
```

The math lives in [src/calc.ts](src/calc.ts) as pure functions, pinned by the
Section 3 worked examples in [src/calc.test.ts](src/calc.test.ts).

## Deploy (GitHub Pages)

Two options, both configured:

1. **GitHub Actions (recommended).** Push to `main`; the workflow in
   [.github/workflows/deploy.yml](.github/workflows/deploy.yml) tests, builds, and
   publishes `dist/`. In the repo settings enable **Pages → Source: GitHub Actions**.
2. **Manual.** `npm run deploy` (uses `gh-pages` to push `dist/` to the `gh-pages`
   branch). Then set **Pages → Source: `gh-pages` branch**.

The Vite `base` is set to `/hedge-calc/` in [vite.config.ts](vite.config.ts) to match
the repo name. If you rename the repo, update `base` (and the favicon path in
[index.html](index.html)) to match.
