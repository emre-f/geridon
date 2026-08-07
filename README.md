# Geridon

Chart, build, backtest and optimize TA or event-driven equity strategies.

**[Demo Video on YouTube](https://youtu.be/Fudvhs9mLSI)**

## Getting started

Run each in its own terminal:

```bash
cd frontend && npm run dev
cd backend  && npm run dev
```

## Current progress

**Shipped**

- Charts, strategies, backtest and optimize tabs are up & running.
- The signals & new data sources projects are done (see `/plans/`) but in the `signals` branch, not merged into `main ` yet. The plan markdown files double as the research log.
    - Every event source is ingested, LLM-labeled where needed, and evaluated:
    `earnings` · `guidance extraction` · `8-K filings` · `congress trades` ·
    `short interest` · `13F`

**Verdict (of the New Signals)**

Zero validated long-only triggers. But three independent sources confirm that disclosed
good news (beats, guidance raises, fresh 13F stakes) is mildly *anti*-alpha at drift
horizons. All event kinds are usable as strategy operands/filters in the builder.

**Possible next** (no TODO-5 plan written yet)

Wire the anti-alpha vetoes into existing strategies as entry filters and measure whether
backtests improve.
