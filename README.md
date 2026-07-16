# Boost Hedge Calculator

A tiny, mobile-friendly React app for sizing a bookie-boost / Polymarket hedge on
the fly. Enter the boosted odds and the Polymarket **NO** ask, and it instantly
shows whether the position **locks**, the profit %, the shares to buy for €10 / €20
/ a custom stake, the USD hedge cost, the net EUR profit, and the breakeven NO price.

No backend, no storage, no network — everything is a pure function of the inputs.

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
