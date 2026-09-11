# Geridon

Chart, build, backtest and optimize TA or event-driven equity strategies.

**[Demo Video on YouTube](https://youtu.be/Fudvhs9mLSI)**

## Getting started

Run each in its own terminal:

```bash
cd frontend && npm run dev
cd backend  && npm run dev
```

## Features

- Charts, strategy builder, backtests, optimization, and Signals are available on `main`.
- Signals supports event ingestion, evaluation, and strategy filters. Data sources
  include insider trades, earnings, guidance, 8-K filings, congress trades,
  short interest, and 13F filings.

## Research notes

The [plans](plans/) contain implementation notes and research results.
The evaluations found no validated long-only entry signals. Earnings beats,
guidance raises, and new 13F stakes showed mildly negative returns relative to
the baseline over the measured periods. A possible next step is to test these
events as filters that block entries in existing strategies.

Local research work in `/projects/` is excluded from Git. Local environment
files and the database in `backend/data/` are also excluded.
