# GatewayBench

> A transparency study of AI routers — cost truth, latency, model fidelity, and on-chain payment rails.

GatewayBench is the framework behind Check4U, a public ledger of AI router behavior for developers who refuse to take vendor claims at face value. Three tiers, nine dimensions, all anchored to published research.

## Stack

- **Next.js 15** App Router + React 19
- **TypeScript** (strict)
- **Tailwind CSS 3.4** with CSS-variable theme tokens (light + dark)
- **Mock data** for now — no backend yet (`lib/data.ts`)

## Quick start

```bash
npm install
npm run dev          # http://localhost:3000
npm run build        # production static build
npm run typecheck    # strict TS check
```

## Project layout

```
app/
  layout.tsx              # root html + Providers wrapper
  providers.tsx           # ThemeProvider + LangProvider + WalletProvider + ToastProvider
  globals.css             # CSS variables + custom CSS classes (range-brand, kbd, shimmer, ...)
  page.tsx                # Home (ranking)
  run/page.tsx            # Run (skeleton — see MIGRATION.md)
  validate/page.tsx       # Validate (skeleton)
  wallet/page.tsx         # Wallet (skeleton)
  docs/page.tsx           # Methodology (skeleton)
  providers/[slug]/page.tsx  # Provider detail (skeleton, 8 static params)
components/
  header.tsx              # nav + theme/lang toggles + wallet button
  footer.tsx              # 3-column footer + disclaimer
  page-skeleton.tsx       # placeholder used by stub routes
  home/home-page.tsx      # mini hero + ranking table (full version: see MIGRATION.md)
lib/
  types.ts                # Provider / SubScores / FingerprintResult / RunState etc.
  data.ts                 # PROVIDERS, MODELS, HERO_STATS
  scoring.ts              # computeL1/2/3/Overall, tier, costScore, latencyScore, subNote
  fingerprint.ts          # fingerprint(), syntheticFingerprint(), trustHistory()
  benchmarks.ts           # BENCHMARK_TEMPLATES, BENCHMARK_RESPONSES, getMockResponse
  setup-prompt.ts         # generates the prompt for "Set up via Agent" flow
  velocity-notes.ts       # per-provider 30-day commentary (en + zh)
  utils.ts                # cx, fmtUSD, fmtPct, fmtMoney, strHash, copyToClipboard
  i18n-dict.ts            # CN/EN dictionary (partial — see MIGRATION.md)
  contexts/
    lang.tsx              # useLang() — t() with {var} interpolation, localStorage persistence
    theme.tsx             # useTheme() — dark/light, [data-theme] on <html>
    wallet.tsx            # useWallet() — mock wallet state
    toast.tsx             # useToast() — bottom-right toast stack
```

## Migration status

This repo started as a single-file demo (`index.html`, ~6000 lines of inline JSX) and is being modularized into Next.js. Foundation, data layer, contexts, and the app shell are done. Per-page UI is being ported. **See [`MIGRATION.md`](./MIGRATION.md) for the full roadmap and what's pending.**

## GatewayBench rubric

| Tier | Dimension | Weight | Core question |
| --- | --- | --- | --- |
| L1 | Trustworthiness | 40% | Is it really the model & service it claims? |
| L3 | Economics | 40% | How much does it actually cost? |
| L2 | Performance | 20% | How fast and how stable? |

Each tier decomposes into 3 sub-dimensions (9 total). Full rubric will live on `/docs` once that page is ported.

## Status

This is a product preview built on mock data. Trust scores, fingerprint readings, latency and cost figures are illustrative — not investment, integration or procurement advice.

## License

TBD.
