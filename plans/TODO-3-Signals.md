# TODO 3 — Event Signal Layer

> Planning document only. Nothing in this file is implemented yet.
>
> Working UI name: **Signals** (fifth tab). Page title: **Signal Lab**.
>
> Supersedes the earlier TA-feature version of this file. TODO-4 lists additional data
> sources; none of them start until this file's events table and evaluation engine exist.

## 0. What we are trying to build

TODO-2 built honest optimization and validation. The results were honest: strategies built
from OHLCV-derived indicators have no edge, and no optimizer can create edge that is not in
the data. The conclusion is not "optimize differently" — it is "bring data that can contain
edge."

That data arrives as **events**: `(ticker, date, kind, details)`. Insider purchases, earnings
surprises, filings, disclosures. This file builds the machinery to:

1. **Store** events from any source in one normalized table with strict point-in-time rules.
2. **Ingest** one real source end-to-end: SEC Form 4 insider transactions (free, structured,
   and the best-documented candidate — officers buying their own stock with their own money).
3. **Evaluate** an event stream *pooled across the whole universe*: "in the 60 trading days
   after this kind of event, does the stock beat the market, by how much, for how long?"
4. **Promote** an event stream with real evidence into the existing stack: a new operand type
   makes events usable in the strategy builder, so the existing backtester and TODO-2
   optimizer consume them unchanged.

Why pooled evaluation is not optional: events are sparse per ticker. One ticker may have 30
insider cluster-buys in a decade — a single-ticker backtest of that is statistically
meaningless. Pooling tens of thousands of events across ~950 tickers is the only way to get
an answer. The existing per-ticker backtest stays what it is: the final check on a promoted
strategy, never the discovery tool.

Division of labor after this file ships: **events are triggers; indicators are confirmation
filters** (the existing trigger+filter design rule). The TODO-2 optimizer's legitimate job
becomes tuning the harness around a validated event: holding period, thresholds, filters,
exits.

### Principles

- **Point-in-time or it does not exist.** Every event has two timestamps: when it happened
  (`event_ts`) and when the public could know (`available_ts`). All evaluation and trading
  logic uses `available_ts`. For Form 4 these differ by up to 2+ business days — using the
  transaction date instead of the filing date is the classic way to fabricate insider alpha.
- **Evaluate the event stream before building any strategy on it.** The pooled event study is
  ~1000x cheaper than backtests and answers the only question that matters first: is there
  any post-event abnormal return at all, and over what horizon?
- **Market-adjusted by default.** Post-event returns are only evidence if they beat what the
  market did over the same window.
- **Record every evaluation, including failures.** Testing many event definitions and keeping
  the winners is multiple testing; at p < 0.05, one in twenty is lucky. The registry counts
  the draws. A final holdout window is checked once, at promotion, like `optimizationHoldout`.
- **Full compute, exact reproducibility.** Fan work across all cores (reuse the
  `evaluationPool.ts` pattern: task-order-preserving, byte-identical to single-threaded).
  Every evaluation stores a seed, definition hashes, and version constants.
- **Known limitation, disclosed not hidden:** the candle universe is survivorship-biased
  (today's listings; delisted losers missing), which inflates long-side results. State it in
  the UI; prefer baselines that partially cancel it (matched random-date baseline, below).

## 1. Concepts

Shared vocabulary; type names should mirror it.

- **Event**: one row: `source`, `ticker`, `event_kind`, `event_ts`, `available_ts`,
  `payload` (source-specific JSON), optional `score` (bigger = stronger, comparable within a
  kind). Example kinds from Form 4: `insider_buy`, `insider_sell`, `insider_cluster_buy`.
- **Timing convention** (single most important definition): an event with `available_ts`
  during or after bar `t`'s close is first *actionable* at bar `t+1`. Its forward return at
  horizon `k` is `close(t+1+k) / close(t+1) - 1`. Skipping the full bar between knowledge and
  entry is slightly conservative and immune to same-bar lookahead. Horizons: 1, 5, 10, 21, 63
  trading days.
- **Market-adjusted forward return**: the ticker's forward return minus SPY's over the
  identical calendar window (align by timestamps, not bar offsets).
- **Event study** (the primary instrument): mean cumulative market-adjusted return for bars
  `t+1 … t+63` after all events of a kind, versus a **matched baseline** — same tickers,
  seeded random non-event dates, same count — with a bootstrap confidence band. The gap
  between curves is the signal; where the gap stops growing is the natural holding period.
- **Score buckets**: events split by score quantile (e.g. cluster size, dollar value) —
  a believable signal is stronger in the stronger bucket.
- **Holdout**: final ~18 months excluded from every evaluation by default; one explicit
  check per signal at promotion time, consumption recorded in the registry.
- **Calibrated expectations**: a real event edge looks like tens of basis points of abnormal
  return over days-to-weeks, visible only because N is huge. Anchor UI copy to that, not to
  "beats SPY on a chart".

## 2. Milestone A — Events domain model (backend)

Goal: one table any source can land in, with the point-in-time contract enforced at the door.
This is the contract TODO-4 sources conform to; get it right once.

- [ ] `types/events.ts`: `EventRecord`, `EventKind` (string union, extended per source),
      `EventSourceId` (`"sec_form4"` first), payload types per kind.
- [ ] `events` table in `createDb` (`backend/src/db.ts`, follow existing migration pattern):
      `id, source, ticker, event_kind, event_ts_ms, available_ts_ms, score, payload TEXT,
      dedupe_key VARCHAR UNIQUE, created_at` — indexes on `(event_kind, available_ts_ms)` and
      `(ticker, available_ts_ms)`. `dedupe_key` makes re-ingestion idempotent (for Form 4:
      accession number + transaction row identity).
- [ ] `event_ingestions` table: source, range covered, row counts, status, started/finished —
      the `fetch_ranges` equivalent so incremental syncs know what exists.
- [ ] `eventStore.ts`: batched insert-or-ignore writes, range queries by kind/ticker/window,
      coverage summary (events per kind per year — the first thing the UI shows).
- [ ] Validation at insert: `available_ts_ms >= event_ts_ms` (reject otherwise — this single
      check is the point-in-time firewall), ticker normalized to the candles table's symbols,
      unknown tickers counted and reported, not silently dropped.

## 3. Milestone B — Form 4 ingestion (v1 source)

Goal: every open-market insider purchase and sale since ~2006, normalized into `events`.

Mechanics an agent needs to know up front:

- **Bulk backfill**: SEC DERA publishes quarterly "Insider Transactions Data Sets" (zip of
  TSV tables derived from Forms 3/4/5) — `SUBMISSION`, `REPORTINGOWNER`, `NONDERIV_TRANS`,
  and others. This is the entire history without scraping. `SUBMISSION.ACCEPTANCE_DATETIME`
  is the `available_ts`. Find them at sec.gov under "Insider Transactions Data Sets".
- **Ticker mapping**: filings key on CIK; map via SEC's `company_tickers.json`. Some CIKs map
  to multiple/zero tickers — count and skip, don't guess.
- **SEC etiquette**: declared `User-Agent` with contact email, ≤10 requests/second, and we
  cache everything downloaded (raw zips kept under `backend/data/raw/sec/` so re-parsing
  never re-downloads).
- **What is signal**: transaction code `P` (open-market purchase) and `S` (open-market sale)
  on non-derivative transactions. Option exercises, awards, gifts (`A`, `M`, `G`, …) are not
  v1 signal. Buys are the documented signal; sells are mostly liquidity/tax noise — ingest
  both, expect asymmetry.
- **Freshness**: quarterly bulk data is enough for research (this milestone). Live daily
  ingestion via the EDGAR daily index + ownership XML is a TODO-4 ticket, only worth it once
  a Form 4 signal is validated and actually traded.

Tickets:

- [ ] `sec/form4Ingest.ts`: download + cache quarterly zips for a year range, parse TSVs
      streaming (files are large; do not load whole files into memory), join
      SUBMISSION + REPORTINGOWNER + NONDERIV_TRANS, filter to codes P/S.
- [ ] Normalize each transaction row → `EventRecord`: kind `insider_buy` / `insider_sell`,
      `event_ts` = transaction date, `available_ts` = ACCEPTANCE_DATETIME, payload = insider
      name, role flags (officer / director / 10% owner), shares, price, dollar value;
      score = log10(dollar value) with an officer bonus (exact weights are a constant, not a
      tunable — resist optimizing ingestion).
- [ ] Derived kind `insider_cluster_buy`, computed after base ingestion: ≥N distinct insiders
      with `insider_buy` events on the same ticker within a W-day window and combined value ≥
      $V (defaults N=2, W=10, V=$100k; stored as payload so evaluation can bucket by them).
      `available_ts` = the Nth insider's filing time — the cluster only exists once the last
      member is public.
- [ ] CLI command (extend `cli.ts` like the candle sync): `ingest form4 --from 2006 --to now`,
      idempotent, resumable via `event_ingestions`, prints per-year event counts and skipped
      row/ticker stats at the end.
- [ ] Fixture test: a small checked-in TSV sample → exact expected `EventRecord` rows,
      including one CIK-with-no-ticker skip, one amended-filing dedupe, one cluster.

## 4. Milestone C — Labels (backend)

Goal: forward returns as cached, first-class data. Only this module constructs labels, so
lookahead has exactly one place to be impossible.

- [ ] `forwardReturns.ts`: per ticker's daily bars, for each date `t` compute
      `close(t+1+k)/close(t+1) - 1` for k ∈ {1, 5, 10, 21, 63}; `null` where bars missing.
- [ ] Market adjustment: compute SPY once; adjusted = raw − SPY over the identical calendar
      window, timestamp-aligned.
- [ ] `forward_returns` table + store: `(ticker, timestamp_ms, horizon, raw, market_adjusted)`,
      cached, keyed by a `labelVersion` constant.
- [ ] `eventAnchor.ts`: map an event's `available_ts` → the first actionable bar per the
      timing convention (next daily bar after availability; events on weekends/after-close
      roll forward). Unit-tested against hand-computed cases including a Friday-evening filing.
- [ ] Deliberate-lookahead fixtures: (a) a fake event stream using `event_ts` instead of
      `available_ts` on a constructed dataset must show inflated returns that the real
      convention kills; (b) shifting all events one bar later must kill a planted signal.
      These tests insure every future source in TODO-4.

## 5. Milestone D — Pooled evaluation engine (backend)

Goal: `evaluateEventSignal(eventQuery, universeFilters, dateRange, seed)` → the full evidence
package, deterministic, seconds when caches are warm.

- [ ] Event selection: kind + payload filters (e.g. officer-only, min dollar value, cluster
      params) + universe filters (min price, min median dollar volume — penny stocks fake
      signals through bid-ask bounce) + date range clamped to pre-holdout.
- [ ] Event study: mean cumulative market-adjusted return t+1…t+63 across selected events;
      matched baseline (same tickers, seeded random non-event dates, same count, same
      missing-data handling); bootstrap confidence band; report N events, tickers covered,
      events/year over time (a dying source shows up here).
- [ ] Horizon summary: abnormal return at each of {1, 5, 10, 21, 63}, with the implied
      natural holding period (where the gap vs baseline stops growing).
- [ ] Score analysis: study split by score quantiles and by key payload flags
      (officer vs director; cluster vs single). Monotonic-in-score is strong evidence.
- [ ] Cost line: abnormal return per event net of configurable per-side costs (`TradeCosts`
      shape) — the headline number, since a 20bp edge with 25bp costs is a "no".
- [ ] Overlap honesty: cluster events on the same ticker within a horizon are not independent
      observations; deduplicate or block-bootstrap by ticker-month so the confidence band is
      not fake-tight.
- [ ] Determinism test: same inputs + seed ⇒ identical output JSON, worker pool on or off.
- [ ] Registry: `signal_evaluations` table — event query JSON + hash, universe, range, seed,
      results JSON, versions, `created_at`, `holdout_consumed_at` + holdout results. Append
      only; normal flows never delete. Computed verdict: `no_signal` / `weak` / `candidate`
      from thresholds on (baseline-gap t-stat, net-of-cost abnormal return, N events).
      `candidate` unlocks holdout + promotion.
- [ ] Registry summary: evaluations grouped by event kind, best/median stats, prominent
      total-draws counter ("N evaluations run; expect ~N/20 lucky ones").
- [ ] API (`/api/signals/...`): coverage summary, run evaluation (async job with progress,
      like optimization experiments), list/get evaluations, one-shot holdout endpoint.

## 6. Milestone E — Strategy integration (backend)

Goal: a validated event stream becomes usable by the existing builder, backtester, and
optimizer — the payoff for all previous milestones.

The schema change: extend the operand union in `backend/src/types/strategies.ts:32`
(`IndicatorOperand | PriceOperand | ValueOperand`) with:

```ts
interface SignalOperand {
  type: "signal";
  kind: EventKind;                       // e.g. "insider_cluster_buy"
  filters?: Record<string, number>;      // payload filters, e.g. min score
  output: "days_since" | "count_in_window" | "last_score";
  window?: number;                       // bars, for count_in_window
}
```

Each output resolves to an ordinary per-bar numeric series (aligned via `eventAnchor`), so
all six comparison operators work unchanged. `days_since(insider_cluster_buy) lte 1` is an
entry trigger; `count_in_window(insider_buy, 63) gte 2` is a filter; exits stay indicator- or
time-based. Events are triggers, indicators are confirmation — the builder should nudge that.

- [ ] `SignalOperand` type + validation in `strategyOperandValidation.ts` (kind exists, output
      valid, window required iff `count_in_window`; a strategy whose ticker has zero events is
      valid but the backtest response carries a warning).
- [ ] Series resolution in `signals.ts`: batched event fetch per (ticker, range), then pure
      per-bar series construction; `days_since` is +Infinity before the first event.
- [ ] Backtester passthrough: `backtest.ts` needs nothing but the resolved series; verify with
      a golden test — constructed events + strategy "enter on days_since lte 1, exit after
      10 bars" produces exactly the expected trades.
- [ ] Optimizer compatibility (TODO-2 engine): signal operands appear in the search space as
      typed values (thresholds, windows, score filters) like indicator params; event *kind* is
      locked, never mutated by evolution. This is where the optimizer becomes useful: tuning
      the harness around a validated trigger.
- [ ] Promotion endpoint: from a `candidate` evaluation, generate a starter strategy JSON
      (event trigger entry, time-based exit at the natural holding period from Milestone D,
      optional trend filter) saved as a normal strategy, visible in the Strategies tab.

## 7. Milestone F — Frontend: Signals tab

Fifth tab: `Charts / Strategies / Backtest / Optimize / Signals`. Flat components in
`frontend/src/components` (`signal-*.tsx`, ≤250 lines each). Use the dataviz skill for every
chart; tooltips in the structured style (bold label + bullets, no em-dashes). Run the
react-doctor skill at the end.

- [ ] Coverage view: events per kind per year, ingestion status, "run ingestion" affordance.
- [ ] Evaluation form: event kind + payload filters, universe filters with live
      "N events, M tickers" preview, seed; visible holdout boundary + survivorship caveat.
- [ ] Run flow: async job with progress; history list from the registry (reuse Optimize tab's
      experiment-list patterns).
- [ ] Results view: verdict card (baseline-gap t-stat, net-of-cost abnormal return, N,
      natural holding period), event-study chart (signal vs baseline, confidence band),
      horizon bar chart, score-bucket comparison.
- [ ] Registry view: all evaluations, verdicts, total-draws counter, holdout status.
- [ ] Promotion actions on a `candidate`: "Run holdout check" (one-shot, confirmation states
      it is consumable) → "Create strategy" (pre-filled from evaluation) → link to Backtest.
- [ ] Strategy builder: signal operand pickers (kind/output/filters dropdowns), catalog-driven
      like the indicator picker.

## 8. Testing and reproducibility

- [ ] Fixture world: ~20 synthetic tickers, ~3 years of candles, three planted event streams —
      real effect (+2% abnormal over 20 bars), pure noise, and lookahead-contaminated. Suite
      asserts verdicts: candidate / no_signal / flagged-by-timing-tests respectively.
- [ ] Form 4 parser fixtures (Milestone B ticket) run offline; no network in any test.
- [ ] Cache correctness: cold vs warm evaluation byte-identical.
- [ ] Everything runs under the existing `backend/test` setup.

## 9. Implementation order

1. Milestone C labels + timing fixtures (smallest, everything depends on it).
2. Milestone A events model → Milestone B Form 4 ingestion (first real data arrives).
3. Milestone D evaluation engine — fixtures first, then the real Form 4 answer.
4. Milestone F coverage + evaluation UI (seeing the first honest event study).
5. Milestone E strategy integration, then promotion UI.

## 10. MVP completion criteria

- [ ] Form 4 backfill 2006→now completes on this machine; coverage view shows sane counts.
- [ ] `insider_cluster_buy` evaluated on the full universe (ex-holdout) in under ~2 min cold /
      seconds warm, with event study, buckets, and verdict — whatever the verdict is.
- [ ] Noise fixture reads as nothing; lookahead fixture is caught by tests.
- [ ] One candidate signal goes end-to-end: holdout check → generated strategy → ordinary
      backtest run from the Backtest tab, with the TODO-2 optimizer able to tune it.
- [ ] Every evaluation ever run is in the registry with the total-draws counter.

## 11. Decisions to confirm before implementation

- **Holdout boundary**: proposal — 2025-01-01 onward (~18 months).
- **Universe filters**: proposal — min price $5, min median dollar volume $5M/day.
- **Cluster defaults**: N=2 insiders / W=10 days / V=$100k combined; bucketable at evaluation
  time, so defaults are not critical.
- **Backfill start**: 2006 (start of DERA coverage) vs 2010 (post-crisis regime only).
  Proposal: ingest from 2006, let evaluations choose ranges.
- **Sells**: ingested but expected near-noise; evaluated once for completeness, not iterated on.
