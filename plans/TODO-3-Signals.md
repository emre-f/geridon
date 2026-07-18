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

- [x] `types/events.ts`: `EventRecord`, `EventKind` (string union, extended per source),
      `EventSourceId` (`"sec_form4"` first), payload types per kind.
      (`backend/src/types/events.ts`: `EventPayloadByKind` maps kind → payload and derives
      `EventKind`, so adding a source extends one interface; `EventRecord<K>` is generic over
      kind so payloads stay typed end-to-end)
- [x] `events` table in `createDb` (`backend/src/db.ts`, follow existing migration pattern):
      `id, source, ticker, event_kind, event_ts_ms, available_ts_ms, score, payload TEXT,
      dedupe_key VARCHAR UNIQUE, created_at` — indexes on `(event_kind, available_ts_ms)` and
      `(ticker, available_ts_ms)`. `dedupe_key` makes re-ingestion idempotent (for Form 4:
      accession number + transaction row identity).
      (in `backend/src/db.ts`; also a `CHECK (available_ts_ms >= event_ts_ms)` constraint, so
      the point-in-time firewall holds even if a writer bypasses `eventStore.ts`; schema tests
      in `backend/test/eventTables.test.ts` cover dedupe idempotency and the CHECK)
- [x] `event_ingestions` table: source, range covered, row counts, status, started/finished —
      the `fetch_ranges` equivalent so incremental syncs know what exists.
      (in `backend/src/db.ts`: `source, start_ms, end_ms, status` (default `running`),
      `inserted_rows, skipped_rows, error, started_at, finished_at`)
- [x] `eventStore.ts`: batched insert-or-ignore writes, range queries by kind/ticker/window,
      coverage summary (events per kind per year — the first thing the UI shows).
      (`backend/src/services/eventStore.ts`: `insertEvents` runs each batch in one transaction
      and returns inserted/duplicate counts; `getEvents` filters by kind(s)/ticker/
      `available_ts_ms` window; `getEventCoverage` groups by kind × year of availability;
      tests in `backend/test/eventStore.test.ts`)
- [x] Validation at insert: `available_ts_ms >= event_ts_ms` (reject otherwise — this single
      check is the point-in-time firewall), ticker normalized to the candles table's symbols,
      unknown tickers counted and reported, not silently dropped.
      (in `insertEvents`: a point-in-time violation rejects the whole batch before any write,
      naming the offending dedupe keys; tickers are uppercased/trimmed and checked against
      `getKnownTickers` (distinct candle symbols, overridable per call so ingestion loads it
      once); unknown-ticker rows are skipped with `unknown_ticker_rows` + sorted
      `unknown_tickers` in the returned summary)

## 3. Milestone B — Form 4 ingestion (v1 source)

Goal: every open-market insider purchase and sale since ~2006, normalized into `events`.

Mechanics an agent needs to know up front:

- **Bulk backfill**: SEC DERA publishes quarterly "Insider Transactions Data Sets" (zip of
  TSV tables derived from Forms 3/4/5) — `SUBMISSION`, `REPORTINGOWNER`, `NONDERIV_TRANS`,
  and others. This is the entire history without scraping. *(Verified against real 2024q1
  data: `SUBMISSION` has no `ACCEPTANCE_DATETIME` column — `FILING_DATE` is the only
  availability signal, so `available_ts` = FILING_DATE end-of-day UTC, which anchors the
  event to that day's bar and makes it actionable the next trading day; conservative.)*
- **Ticker mapping**: `SUBMISSION.ISSUERTRADINGSYMBOL` carries the symbol directly and is
  point-in-time correct (the symbol at filing time), unlike `company_tickers.json` which is
  a today-snapshot — so no CIK mapping needed. Placeholder junk (`NONE`, `N/A`, `-`,
  `(CALX)`-style wrapping) is cleaned or counted as missing, never guessed.
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

- [x] `sec/form4Ingest.ts`: download + cache quarterly zips for a year range, parse TSVs
      streaming (files are large; do not load whole files into memory), join
      SUBMISSION + REPORTINGOWNER + NONDERIV_TRANS, filter to codes P/S.
      (`backend/src/services/sec/form4Ingest.ts` + `secTsv.ts`: zips cached under
      `backend/data/raw/sec/`, the extracted TSV dir is the cache unit so re-parsing never
      re-downloads; downloads go to a `.partial` path first; streaming line reader; resumable
      per quarter via `event_ingestions` (completed quarters skipped, failed ones retried);
      sanity-checked on real 2024q1: ~0.5s parse, 14k events on the 952-ticker universe)
- [x] Normalize each transaction row → `EventRecord`: kind `insider_buy` / `insider_sell`,
      `event_ts` = transaction date, `available_ts` = FILING_DATE end-of-day (the data set
      has no ACCEPTANCE_DATETIME; see mechanics note), payload = insider
      name, role flags (officer / director / 10% owner), shares, price, dollar value;
      score = log10(dollar value) with an officer bonus (exact weights are a constant, not a
      tunable — resist optimizing ingestion).
      (`backend/src/services/sec/form4Normalize.ts`: joint filings aggregate owner names and
      OR the role flags; missing price ⇒ null dollar value and null score;
      `OFFICER_SCORE_BONUS = 0.5`; dedupe key is transaction identity — issuer CIK + owner
      CIKs + date + code + shares + price — not the accession number, so a 4/A amendment
      re-filing the same rows lands as duplicates instead of double-counting (identical
      same-day lots collapsing into one event is the accepted trade-off); rows whose filing
      date precedes the transaction date are skipped and counted, never inserted)
- [x] Derived kind `insider_cluster_buy`, computed after base ingestion: ≥N distinct insiders
      with `insider_buy` events on the same ticker within a W-day window and combined value ≥
      $V (defaults N=2, W=10, V=$100k; stored as payload so evaluation can bucket by them).
      `available_ts` = the Nth insider's filing time — the cluster only exists once the last
      member is public.
      (`backend/src/services/sec/form4Clusters.ts`: delete + full rebuild each run, so
      re-derivation after new quarters is idempotent by construction; window slides over
      transaction dates and is consumed when a cluster is emitted, so a long buy run yields
      disjoint clusters, not one per extra buy; insiders are distinct individual names — a
      joint filing "A; B" contributes two; `available_ts` = max member filing time; score =
      log10(combined value); null-price buys count toward N but $0 toward V)
- [x] CLI command (extend `cli.ts` like the candle sync): `ingest form4 --from 2006 --to now`,
      idempotent, resumable via `event_ingestions`, prints per-year event counts and skipped
      row/ticker stats at the end.
      (`npm run ingest -- form4 --from=2006 --to=now`; both flags optional, defaulting to
      2006→now; requires `SEC_USER_AGENT` in `backend/.env` per SEC etiquette (refuses to run
      without it); idempotency/resumability come from `ingestForm4`'s `event_ingestions`
      bookkeeping; re-derives `insider_cluster_buy` whenever a new quarter was ingested; final
      report = quarters/inserted/duplicates, skip counts by reason, distinct unknown tickers,
      and a per-year × per-kind event count table)
- [x] Fixture test: a small checked-in TSV sample → exact expected `EventRecord` rows,
      including one CIK-with-no-ticker skip, one amended-filing dedupe, one cluster.
      (`backend/test/form4Ingest.test.ts` with fixtures under
      `backend/test/fixtures/sec/2024q1/`: exact-row assertions, no-ticker skip, 4/A dedupe,
      unknown ticker, point-in-time skip, joint owners, missing price, paren-wrapped ticker;
      cluster case in `backend/test/form4Clusters.test.ts` — the fixture quarter derives
      exactly one FMBH cluster (3 insiders, $112.1k) with default params, plus synthetic
      cases: value threshold, single repeat insider, window boundary, window consumption,
      latest-filing availability, joint-name split)

## 4. Milestone C — Labels (backend)

Goal: forward returns as cached, first-class data. Only this module constructs labels, so
lookahead has exactly one place to be impossible.

- [x] `forwardReturns.ts`: per ticker's daily bars, for each date `t` compute
      `close(t+1+k)/close(t+1) - 1` for k ∈ {1, 5, 10, 21, 63}; `null` where bars missing.
      (`backend/src/services/forwardReturns.ts`, tests in `backend/test/forwardReturns.test.ts`)
- [x] Market adjustment: compute SPY once; adjusted = raw − SPY over the identical calendar
      window, timestamp-aligned. (same module: pass SPY bars as `marketBars`; closes matched
      by entry/exit timestamps so ticker gaps cannot misalign the window)
- [x] `forward_returns` table + store: `(ticker, timestamp_ms, horizon, raw, market_adjusted)`,
      cached, keyed by a `labelVersion` constant. (table in `backend/src/db.ts`; store in
      `backend/src/services/forwardReturnStore.ts` — reads filter by current `labelVersion`,
      re-storing a ticker replaces its rows; tests in `backend/test/forwardReturnStore.test.ts`)
- [x] `eventAnchor.ts`: map an event's `available_ts` → the first actionable bar per the
      timing convention (next daily bar after availability; events on weekends/after-close
      roll forward). Unit-tested against hand-computed cases including a Friday-evening filing.
      (`backend/src/services/eventAnchor.ts`: returns both the anchor bar `t` — the key into
      `forward_returns` rows — and the actionable bar `t+1`; events before data coverage
      resolve to null; tests in `backend/test/eventAnchor.test.ts`)
- [x] Deliberate-lookahead fixtures: (a) a fake event stream using `event_ts` instead of
      `available_ts` on a constructed dataset must show inflated returns that the real
      convention kills; (b) shifting all events one bar later must kill a planted signal.
      These tests insure every future source in TODO-4.
      (`backend/test/lookaheadFixtures.test.ts`: price jumps planted between `event_ts` and
      `available_ts` — anchoring on `event_ts` captures +10%/event, the real convention sees
      exactly 0; a planted on-time signal drops to 0 when entry slips one bar)

## 5. Milestone D — Pooled evaluation engine (backend)

Goal: `evaluateEventSignal(eventQuery, universeFilters, dateRange, seed)` → the full evidence
package, deterministic, seconds when caches are warm.

- [x] Event selection: kind + payload filters (e.g. officer-only, min dollar value, cluster
      params) + universe filters (min price, min median dollar volume — penny stocks fake
      signals through bid-ask bounce) + date range clamped to pre-holdout.
      (`backend/src/services/signalEval/eventSelection.ts`: `selectEvents(db, options)` clamps
      the range to before `signalHoldoutStartMs` (2025-01-01) unless `includeHoldout`; payload
      filters are generic min-thresholds — booleans coerce to 0/1 so `{ is_officer: 1 }` is
      officer-only, missing fields fail; universe stats are point-in-time: median close and
      median dollar volume over the trailing ≤63 daily bars ending at the anchor bar, ≥20 bars
      required; result carries anchor/actionable timestamps per event plus stats counting every
      exclusion by reason (the "N events, M tickers" preview data); `eventAnchor` now also
      returns `anchor_index` for window math; tests in `backend/test/eventSelection.test.ts`)
- [x] Event study: mean cumulative market-adjusted return t+1…t+63 across selected events;
      matched baseline (same tickers, seeded random non-event dates, same count, same
      missing-data handling); bootstrap confidence band; report N events, tickers covered,
      events/year over time (a dying source shows up here).
      (`backend/src/services/signalEval/eventStudy.ts` + `eventStudyStats.ts`: pure module —
      takes selected events, bars per ticker, market bars, seed; per-event curves share one
      code path so baseline missing-data handling matches by construction; baseline anchors
      are seeded draws from the same ticker's bars within the study's anchor date range,
      never an actual event anchor; 95% bootstrap band is on the signal−baseline gap
      (events resampled with replacement, both curves recomputed); deterministic for a given
      seed and independent of input event order (events sorted internally);
      `events_per_year` fills gap years with zero; tests in `backend/test/eventStudy.test.ts`
      include exact hand-computed curves and a collapsed-band case with identical events)
- [x] Horizon summary: abnormal return at each of {1, 5, 10, 21, 63}, with the implied
      natural holding period (where the gap vs baseline stops growing).
      (`backend/src/services/signalEval/horizonSummary.ts`: `summarizeHorizons(study)` —
      natural holding period = first horizon where the full per-bar gap curve reaches its
      maximum, null when the gap never goes positive; also reports `peak_gap`; tests in
      `backend/test/horizonSummary.test.ts` cover plateau, all-negative, and short-curve
      cases)
- [x] Score analysis: study split by score quantiles and by key payload flags
      (officer vs director; cluster vs single). Monotonic-in-score is strong evidence.
      (`backend/src/services/signalEval/scoreAnalysis.ts`: `analyzeScoreBuckets` takes the
      selected events and runs the full event study per bucket — score quantiles low→high
      (default terciles) plus with/without splits per flag field (default `is_officer`,
      `is_director`); each bucket reports N, score range, gap at the reference horizon
      (default 21), peak gap, and natural holding period; `monotonic_in_score` is true only
      when the reference gap strictly increases across buckets and null when any bucket
      cannot report one — never guessed; null-score events and missing flag fields are
      counted, not bucketed; cluster-vs-single stays a cross-kind comparison done by running
      two evaluations; tests in `backend/test/signalScoreAnalysis.test.ts`)
- [x] Cost line: abnormal return per event net of configurable per-side costs (`TradeCosts`
      shape) — the headline number, since a 20bp edge with 25bp costs is a "no".
      (`backend/src/services/signalEval/costLine.ts`: `roundTripCost` charges slippage +
      pct commission + fixed commission on both sides, the fixed part expressed as a return
      via `notionalPerEvent` (default $10k); `computeCostLine(horizonSummary, options)` nets
      every summary horizon and picks the headline at the natural holding period (gross =
      `peak_gap`), falling back to the longest horizon with data so a losing signal reports a
      negative net instead of null; feeds `SignalHeadlineStats.net_abnormal_return`; tests in
      `backend/test/signalCostLine.test.ts`)
- [x] Overlap honesty: cluster events on the same ticker within a horizon are not independent
      observations; deduplicate or block-bootstrap by ticker-month so the confidence band is
      not fake-tight.
      (block bootstrap in `eventStudyStats.ts` + `eventStudy.ts`: events grouped into
      ticker-month blocks of their anchor bar and resampled whole — each iteration draws
      `#blocks` blocks with replacement, paired signal/baseline curves travel together; means
      and per-event counts are unchanged, only the band widens; blocks are built from the
      internally sorted event list so determinism and input-order independence hold; tests in
      `eventStudy.test.ts` pin the band to exact block-resample quantiles that per-event
      resampling could not produce, plus single-block collapse and same-ticker
      different-month separation)
- [x] Determinism test: same inputs + seed ⇒ identical output JSON, worker pool on or off.
      (this ticket landed the milestone's goal function: `signalEval/evaluate.ts` —
      `evaluateEventSignal(db, { query, seed, … })` → selection stats, event study, horizon
      summary, cost line, score analysis, headline stats, verdict, in one package; bucket
      studies fan across worker threads via `studyPool.ts`/`studyWorker.ts` (evaluationPool
      pattern: task-order-preserving, per-study seeding, so pooled output is byte-identical
      to inline); `scoreAnalysis` split into plan/assemble so all studies batch through one
      runner, with a `dedupe_key` sort tiebreaker so DB insertion order can't change bucket
      membership; the headline `baseline_gap_t_stat` now exists: `gap_t_stat` per curve
      point in `eventStudyStats.ts`, block means over the same ticker-month blocks as the
      bootstrap so the t-stat can't be fake-tight where the band is not, read at the cost
      line's headline horizon; default costs = 5bps slippage/side, market = SPY; empty
      selection ⇒ zeroed headline + `no_signal`, never a crash; tests in
      `backend/test/signalEvaluate.test.ts`: identical JSON for repeat runs, pool on vs off,
      and shuffled insertion order; different seed ⇒ different study; hand-computed
      block t-stat)
- [x] Registry: `signal_evaluations` table — event query JSON + hash, universe, range, seed,
      results JSON, versions, `created_at`, `holdout_consumed_at` + holdout results. Append
      only; normal flows never delete. Computed verdict: `no_signal` / `weak` / `candidate`
      from thresholds on (baseline-gap t-stat, net-of-cost abnormal return, N events).
      `candidate` unlocks holdout + promotion.
      (table in `backend/src/db.ts`; store in `backend/src/services/signalEval/registry.ts` —
      the event study reports `SignalHeadlineStats` (baseline-gap t-stat, net-of-cost abnormal
      return, N events) plus an opaque `detail` package, stored together in the results JSON;
      the query is the full `EventSelectionOptions` (universe filters included), hashed
      key-order-independently; `versions` always carries `label_version`, callers merge in
      more; thresholds are fixed constants — weak: t ≥ 2, net > 0, N ≥ 100; candidate: t ≥ 3,
      net > 10bp, N ≥ 500, stricter than p < 0.05 because the registry counts draws;
      `consumeHoldout` enforces candidate-only and exactly-once; tests in
      `backend/test/signalRegistry.test.ts`)
- [x] Registry summary: evaluations grouped by event kind, best/median stats, prominent
      total-draws counter ("N evaluations run; expect ~N/20 lucky ones").
      (`backend/src/services/signalEval/registrySummary.ts`: per kind — evaluation count,
      verdict counts, best/median t-stat and net abnormal return, holdouts consumed; top-level
      `total_draws` + `expected_lucky = total_draws / 20` for the UI counter)
- [x] API (`/api/signals/...`): coverage summary, run evaluation (async job with progress,
      like optimization experiments), list/get evaluations, one-shot holdout endpoint.
      (routes under `/api/v1/signals/` in `backend/src/api/signalsRouter.ts` + `signals.ts` +
      `signalRequests.ts` — GET `coverage` (events per kind/year + recent ingestions), POST
      `preview` (selection stats only: the form's live "N events, M tickers"), POST/GET
      `evaluations` (+ `/:id`), GET `summary` (registry summary), GET `jobs` (+ `/:id`), POST
      `evaluations/:id/holdout`; evaluations and holdouts run as queued jobs in a
      `signal_evaluation_jobs` table driven by `signalEval/evaluationRunner.ts`, which calls
      Milestone D's `evaluateEventSignal` (full worker fanout) and keeps all DB writes on the
      main thread; completed jobs record to the registry (or `consumeHoldout`) and carry
      `evaluation_id` + selection stats; boot recovery marks running jobs interrupted and
      re-enqueues queued ones; the holdout endpoint 409s on non-candidate or already-consumed
      before enqueueing, and the job reruns the recorded query with the range forced to the
      sealed window (`startMs = signalHoldoutStartMs`, same seed); `includeHoldout` is never
      accepted from the API; costs default to `defaultSignalCosts` (5 bps/side) when omitted;
      tests in `backend/test/signalApi.test.ts`)

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

- [x] `SignalOperand` type + validation in `strategyOperandValidation.ts` (kind exists, output
      valid, window required iff `count_in_window`; a strategy whose ticker has zero events is
      valid but the backtest response carries a warning).
      (`SignalOperand` + `SignalOutput` in `backend/src/types/strategies.ts`; runtime
      `eventKinds` / `isEventKind` added to `types/events.ts` (a `Record<EventKind, true>`
      forces exhaustiveness when kinds are added); validation rejects a window on non-window
      outputs and drops empty filters; every operand-type fallthrough got an explicit signal
      branch — labels/keys in `ruleLabels.ts`, `cheapRejection.ts`, `strategyPaths.ts`, and
      `signals.ts`, where series resolution throws "not implemented yet" until the next
      ticket lands, so a saved signal strategy fails loudly instead of resolving as a bogus
      indicator; the zero-events backtest warning belongs to that resolution ticket; tests in
      `backend/test/signalOperandValidation.test.ts`)
- [x] Series resolution in `signals.ts`: batched event fetch per (ticker, range), then pure
      per-bar series construction; `days_since` is +Infinity before the first event.
      (pure construction in `backend/src/services/signalSeries.ts`: `buildSignalSeries` anchors
      matching events via `eventAnchor` — days_since = 0 on the anchor bar, so a rule firing on
      that close fills at the next bar's open, exactly the first actionable moment; events
      available before the first bar are dropped; `count_in_window` includes the current bar,
      `last_score` carries the latest event's score (null score stays null); operand filters
      reuse `eventSelection`'s payload-threshold semantics, with a `score` key reading the
      score column; `collectSignalKinds(strategy)` drives the batched fetch — API handlers
      fetch the ticker's events for those kinds with no start bound (history before the range
      feeds days_since) and pass them through `evaluateSignals`/`entrySignalFires`; a signal
      strategy on a path that provides no events still throws, so the optimizer stays
      fail-loud until its ticket; +Infinity is comparable only for signal operands, so
      non-finite indicator values stay inert and `days_since gt N` / `cross_below` work before
      and at the first event; zero events for a ticker yields a `warnings` line on the
      backtest run response; tests in `backend/test/signalSeries.test.ts`)
- [x] Backtester passthrough: `backtest.ts` needs nothing but the resolved series; verify with
      a golden test — constructed events + strategy "enter on days_since lte 1, exit after
      10 bars" produces exactly the expected trades.
      (`BacktestOptions.events` is the only change; golden test in
      `backend/test/backtest-signal.test.ts`: a cluster event available during bar 3 with
      entry `days_since lte 1` / exit `days_since gte 10` buys at bar 4's open and sells at
      bar 14's open — exactly 10 bars held, exact prices/shares/pnl asserted; the repeat
      entry signal at days_since = 1 is absorbed by the account's minimum-trade-value guard;
      zero events ⇒ zero trades)
- [x] Optimizer compatibility (TODO-2 engine): signal operands appear in the search space as
      typed values (thresholds, windows, score filters) like indicator params; event *kind* is
      locked, never mutated by evolution. This is where the optimizer becomes useful: tuning
      the harness around a validated trigger.
      (`signalParameterNodes` in `searchSpaceNodes.ts` compiles the count_in_window window
      (integer, hard bounds 1-250, surfaced in the search-space preview) and every filter
      threshold — score and payload keys — into numeric nodes with the free-value span used
      for value thresholds; kind/output never become nodes and evolution only mutates node
      values, so the trigger stays locked by construction; `validateCandidate` rejects
      out-of-bounds windows and non-finite filters; `searchSpaceVersion` bumped to 3;
      `OptimizationDataset` gained `events` — `loadExperimentDatasets` now takes the snapshot
      strategy, fetches its `collectSignalKinds` with no start bound, and returns 400 when no
      requested ticker has any matching events; events flow through fold backtests, the
      parallel worker pool, the signal-starvation probe, and holdout evaluation, and
      `searchDatasets` seals holdout-window events alongside the candles so they cannot
      anchor to the last search bar; tests in `backend/test/optimization-signal.test.ts`,
      including a full experiment run through the runner)
- [x] Promotion endpoint: from a `candidate` evaluation, generate a starter strategy JSON
      (event trigger entry, time-based exit at the natural holding period from Milestone D,
      optional trend filter) saved as a normal strategy, visible in the Strategies tab.
      (POST `/api/v1/signals/evaluations/:id/promote` in `signalsRouter.ts`/`signals.ts`,
      built by `signalEval/promotion.ts`: entry `days_since(kind) lte 1`, exit
      `days_since gte natural_holding_period_bars` from the stored horizon summary — a
      re-triggering event extends the hold, matching the golden-test semantics; the operand's
      filters replay exactly what the evaluation scored (payload filters as-is, `minScore` as
      the reserved `score` key `signalSeries` reads); `trend_filter: true` ANDs a
      `close gt SMA(200)` confirmation, `name` optional (default "Insider Cluster Buy starter
      (eval N)"); non-candidate and missing-holding-period promote 409 — candidate net > 0
      implies a positive-gap holding period exists, so the 409 only guards stale/legacy rows;
      the strategy is saved through `handleCreateStrategy`'s validate+insert path, so the
      Strategies tab sees an ordinary record; tests in `backend/test/signalPromotion.test.ts`)

## 7. Milestone F — Frontend: Signals tab

Fifth tab: `Charts / Strategies / Backtest / Optimize / Signals`. Flat components in
`frontend/src/components` (`signal-*.tsx`, ≤250 lines each). Use the dataviz skill for every
chart; tooltips in the structured style (bold label + bullets, no em-dashes). Run the
react-doctor skill at the end.

- [x] Coverage view: events per kind per year, ingestion status, "run ingestion" affordance.
      (this ticket also scaffolds the tab: `signals` added to `AppTab`/header/`App.tsx`,
      `signals-panel.tsx` is the Signal Lab shell with load/refresh/error/skeleton states,
      `lib/api-client-signals.ts` wraps GET `coverage`; `signal-coverage-view.tsx` renders the
      kind × year count matrix (compact cells, exact totals, horizontal scroll), the last-20
      ingestion list with status badges and inserted/skipped counts, and the "run ingestion"
      affordance as the CLI command + `SEC_USER_AGENT` note, since ingestion is CLI-only by
      design (no ingestion endpoint exists); react-doctor scope-changed: 100/100, no issues)
- [x] Evaluation form: event kind + payload filters, universe filters with live
      "N events, M tickers" preview, seed; visible holdout boundary + survivorship caveat.
      (`signal-evaluation-form.tsx` + field groups in `signal-evaluation-fields.tsx`;
      API calls in `lib/api-client-signals-evaluations.ts` — POST `preview`, POST/GET
      evaluations jobs — kept separate from `api-client-signals.ts` to avoid cross-ticket
      contention; form state → request body lives in `lib/signal-evaluation-query.ts`
      (payload filters are kind-specific: officers-only/min trade $ for insider buys/sells,
      min insiders/min combined $ for clusters; blank or unparseable inputs are dropped, end
      date is inclusive UTC and dropped when before start), tested in
      `signal-evaluation-query.test.ts`; the preview debounces 400ms with a stale-response
      guard and reports selected/tickers/candidates plus per-reason exclusion counts and the
      holdout clamp; the "Before you run" note states the sealed 2025-01-01 boundary and the
      survivorship caveat)
- [x] Run flow: async job with progress; history list from the registry (reuse Optimize tab's
      experiment-list patterns).
      (`signal-run-flow.tsx` mirrors the Optimize experiments list: shared grid template,
      status badges, 3s polling only while a job is queued/running; jobs come from GET
      `jobs` — the job store, since jobs carry status/error/selection stats and the
      registry only holds completed evaluations; a job created by the form is merged in
      immediately via the `createdJob` prop; completed rows link to their evaluation through
      the optional `onSelectEvaluation` callback, wired in `signals-panel.tsx` to the
      results view's `openEvaluationId`; react-doctor scope-changed: 100/100, no issues)
- [x] Results view: verdict card (baseline-gap t-stat, net-of-cost abnormal return, N,
      natural holding period), event-study chart (signal vs baseline, confidence band),
      horizon bar chart, score-bucket comparison.
      (`signal-results-view.tsx` self-fetches GET `evaluations/:id` via
      `lib/api-client-signals-registry.ts` (own file per the contention rule), so hosting it
      is one line; `signal-results-summary.tsx` holds the verdict card — verdict badge +
      threshold description, stat tiles for the three headline numbers + natural holding
      period, selection stats line, always-on survivorship caveat — and the holdout card when
      consumed; charts follow the dataviz skill: `signal-event-study-chart.tsx` draws signal
      vs matched-baseline lines with the 95% gap band rendered as baseline+gap bounds around
      the signal line, crosshair tooltip with gap/band/t-stat; `signal-horizon-chart.tsx` is
      grouped gross-vs-net bars per horizon with the headline horizon shaded and the round
      trip cost in the footer; `signal-score-buckets.tsx` is single-hue quantile bars plus
      the monotonicity read and a flag-split table; the green/blue pair reuses the existing
      `--viz-candidate`/`--viz-baseline` slots, revalidated with the skill's palette script
      in both modes (all checks pass); axis units auto-switch bp vs % by data scale; hosts
      `signal-promotion-actions.tsx` under the verdict card; rows with no stored detail
      degrade to headline-only)
- [x] Registry view: all evaluations, verdicts, total-draws counter, holdout status.
      (`signal-registry-view.tsx` self-fetches GET `evaluations` + `summary` in parallel;
      the total-draws counter is the lead card — big number plus "expect about N/20 lucky"
      copy; per-kind summary table (verdict counts, best/median t and net, holdouts) and the
      all-evaluations table (verdict badges, headline stats, holdout consumed/available/
      locked) live in `signal-registry-tables.tsx`; opening a row drives the panel's
      `openEvaluationId` into the results view with a back button, and the run flow's
      `onSelectEvaluation` reuses the same path; shared verdict/format helpers in
      `lib/signal-lab-utils.ts`; react-doctor scope-changed: 100/100, no issues)
- [x] Promotion actions on a `candidate`: "Run holdout check" (one-shot, confirmation states
      it is consumable) → "Create strategy" (pre-filled from evaluation) → link to Backtest.
      (`signal-promotion-actions.tsx` is a self-contained card (duck-typed
      `PromotableEvaluation` prop: id/event_kind/verdict/holdout_consumed_at, so the results
      and registry views can host it without importing their types): non-candidates get a
      one-line explanation; the holdout button goes through an inline confirm step stating
      the check is consumable exactly once, POSTs via `lib/api-client-signals-promotion.ts`
      (own file, no contention with the other signals api clients), and reports the queued
      job id (an `onHoldoutStarted` callback hands the job to the run-flow view); "Create
      strategy" prefills the backend's default name, offers the SMA(200) trend-filter
      checkbox, and on 201 exposes `onStrategyCreated` (record gets node ids via the now
      exported `withRecordNodeIds`) plus an "Open in Backtest" button behind
      `onOpenInBacktest`, matching App's existing `handleOpenInBacktest(strategyId)`;
      NOT yet mounted anywhere — wiring into the results/registry views is the
      integration step)
- [x] Strategy builder: signal operand pickers (kind/output/filters dropdowns), catalog-driven
      like the indicator picker.
      (frontend `SignalOperand`/`SignalEventKind`/`SignalOutput` added to
      `api-strategy-types.ts` mirroring the backend types; `lib/signal-catalog.ts` is the
      frontend catalog — kind labels/descriptions, the three outputs with help copy, and
      per-kind filter fields (numeric minimums plus boolean flags that filter as 0/1,
      `score` as the reserved key) — with `defaultSignalOperand` and
      `signalOperandSummary` (tested in `signal-catalog.test.ts`); the operand editor gains
      a fourth "Signal" source rendering `strategy-signal-operand.tsx`: kind/output
      dropdowns with structured HelpTips, window input only for count_in_window (default 20,
      max 250 matching the optimizer bounds), and an add/remove filter row per catalog
      field; `strategy-rules-summary.tsx` describes signal operands ("Days since Insider
      Cluster Buy (2 filters)"); backend validation, chart preview (`handleSignals` loads
      events), and backtests already accept these strategies unchanged)

## 8. Testing and reproducibility

- [x] Fixture world: ~20 synthetic tickers, ~3 years of candles, three planted event streams —
      real effect (+2% abnormal over 20 bars), pure noise, and lookahead-contaminated. Suite
      asserts verdicts: candidate / no_signal / flagged-by-timing-tests respectively.
      (world builder in `backend/test/signalFixtureWorld.ts`, suite in
      `backend/test/signalFixtureWorld.test.ts`: 20 tickers × ~3.3 years of daily bars, each
      price = market factor × a 42-bar sawtooth (+2% over 20 bars, full reversion over the
      next 20) × small deterministic noise, so the baseline's random-phase draws average to
      zero by periodicity; the three streams reuse the three event kinds —
      `insider_cluster_buy` available at each cycle boundary (522 events ⇒ `candidate`, gap
      ≈ +2% at bar 20, t ≥ 3, net > 1%), `insider_buy` at seeded random dates (⇒ `no_signal`,
      flat gap), and `insider_sell` with `event_ts` before the rise but `available_ts` only
      once the move completes, so honest anchoring enters at the exact top (⇒ `no_signal`
      with a −2% gap) while a "leaked" world with `available_ts = event_ts` fabricates the
      +2% and reads `candidate` — the timing convention itself is the flag; evaluations run
      with `maxHorizon = 40` so the study window stays inside one cycle of the periodic
      world)
- [x] Form 4 parser fixtures (Milestone B ticket) run offline; no network in any test.
      (verified: `form4Ingest.test.ts` points `cacheDir` at the checked-in fixtures and pins
      `nowMs` to 2024-04-15, so `quartersInRange` yields only 2024q1 and `ensureQuarterData`'s
      cache hit — all three required TSVs present — returns before `fetch` is reachable; the
      only `fetch` in test-reachable code is that SEC download; full backend suite (325 tests)
      passes in a no-network sandbox)
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

- **Holdout boundary**: proposal — 2025-01-01 onward (~18 months). *(Implemented as the
  proposal: `signalHoldoutStartMs` in `signalEval/eventSelection.ts`; one constant to change.)*
- **Universe filters**: proposal — min price $5, min median dollar volume $5M/day.
- **Cluster defaults**: N=2 insiders / W=10 days / V=$100k combined; bucketable at evaluation
  time, so defaults are not critical.
- **Backfill start**: 2006 (start of DERA coverage) vs 2010 (post-crisis regime only).
  Proposal: ingest from 2006, let evaluations choose ranges.
- **Sells**: ingested but expected near-noise; evaluated once for completeness, not iterated on.
