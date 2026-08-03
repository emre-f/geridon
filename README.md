To start

- `cd frontend` then `npm run dev`
- `cd backend` then `npm run dev`

Current progress:
- charts, strategies, backtest and optimize tabs are up & running
- TODO-3 and TODO-4 are done (in the `signals` branch, not yet merged to `main`; the plan files double as the research log). Every event source is ingested, LLM-labeled where needed, and evaluated: earnings, guidance extraction, 8-K filings, congress trades, short interest, 13F.
    - Verdict: zero validated long-only triggers. But, three independent sources confirm disclosed good news (beats, guidance raises, fresh 13F stakes) is mildly *anti*-alpha at drift horizons. All event kinds are usable as strategy operands/filters in the builder.
- possible next (no TODO-5 yet): wire the anti-alpha vetoes into existing strategies as entry filters and measure whether backtests improve.
