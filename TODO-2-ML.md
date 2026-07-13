# TODO 2 — Strategy Optimization / ML

> Planning document only. Nothing in this file is implemented yet.
>
> Working UI name: **Optimize** (fourth tab). Page title: **Strategy Lab**.

## 0. What we are trying to build

Geridon should be able to search for stronger strategy variants without pretending that the best
historical result is automatically a good strategy.

The workflow should be available entirely through backend APIs and through a fourth frontend tab:

`Charts / Strategies / Backtest / Optimize`

An optimization experiment starts with a saved strategy, a deliberately bounded search space, a
validation plan, an objective, and a compute budget. It produces ranked candidate strategies with
out-of-sample evidence. A candidate is never silently applied: the user can inspect it, save it as a
new strategy, and run an ordinary backtest.

### Principles

These are cross-cutting design values, not tasks; the checkboxes throughout the file are where they
get enforced.

- Optimize for **out-of-sample robustness**, not the prettiest in-sample equity curve.
- Keep candidates compatible with the existing explainable strategy JSON/tree model.
- Put hard limits on trials, wall-clock time, rules, indicators, and tree depth.
- Make every run reproducible with immutable snapshots, data-range metadata, and a random seed.
- Always compare against the original strategy, Buy & Hold, and a simple random-search baseline.
- Penalize needless complexity, excessive turnover, large drawdowns, and too few trades.
- Keep a final holdout period hidden from the optimizer until the user explicitly evaluates the
  selected candidate once.
- Treat optimization results as research evidence, not financial advice or a promise of future
  returns.

## 1. Method choice

### Phase 1 methods — implement first

- [x] **Seeded random search** over mixed numeric and categorical values.
  - It is simple, parallelizable, hard to implement incorrectly, and a necessary benchmark for every
    more sophisticated optimizer.
  - Prefer log-like or curated distributions where sensible instead of testing every integer between
    an indicator catalog's broad minimum and maximum.
- [x] **Successive halving** for compute allocation.
  - Give many candidates a cheap first evaluation, then promote only the best fraction to more folds,
    symbols, or history.
  - Do not use a shorter time prefix as the only cheap stage; that can favor one market regime.
- [x] **Rule-subset selection** using the existing `enabled` flags.
  - The user chooses which existing rules are required, optional, or locked off.
  - Search optional-rule on/off values with a penalty per active rule/indicator.
  - Enforce at least one active entry rule and one active exit rule (and one cash rule for a required
    three-state strategy).
- [x] **Coarse-to-fine numeric tuning**.
  - Start with a small curated/coarse range around each selected parameter or threshold.
  - Refine around robust regions, not only around the single best point.
- [x] **Ablation report**.
  - Disable one rule at a time on the selected candidate and show the out-of-sample impact.
  - This is often more useful than adding another optimizer because it exposes rules that add
    complexity without adding value.

### Phase 2 methods — add after the baseline is correct

- [x] **Bayesian optimization using TPE** (Tree-structured Parzen Estimator), or an equivalent method
      that handles conditional, integer, continuous, and categorical parameters.
  - TPE is a better fit than Gaussian-process optimization for this conditional strategy space.
  - It must beat seeded random search under equal budgets on deterministic test fixtures before it is
    the default.
- [x] **Constrained evolutionary search** for adding/removing rules and changing tree structure.
  - Use typed mutations from a safe grammar; never generate arbitrary JSON.
  - Mutations may add a rule from a user-approved candidate library, remove/disable a rule, change an
    operator, adjust an `at_least` count, or replace an operand with a compatible operand.
  - Prefer small mutations and retain a complexity penalty so trees do not grow without bound.
  - Deduplicate candidates by a canonical strategy hash.
- [x] Optional Pareto ranking rather than collapsing every concern into one number: maximize robust
      return/Sharpe while minimizing drawdown, turnover, and strategy complexity.

### Methods deliberately deferred

These are decisions/rationale, not tasks.

- **RL / Q-learning: not an initial optimizer.**
  - Q-learning learns a state-to-action policy; it does not naturally tune the current rule tree.
  - Price/indicator state is continuous and non-stationary, so tabular Q-learning is a poor fit.
  - Deep RL needs much more data, careful reward design, repeated environments, and realistic costs;
    it is easy to create a policy that exploits simulator artifacts and is hard to explain in the
    current Strategies tab.
  - Revisit only as a separate research mode after fees, slippage, position/risk controls, walk-forward
    validation, and the constrained optimizer are solid. Its output should be labelled a learned
    policy, not presented as an ordinary rule strategy.
- **Supervised prediction models: later, as a separate feature pipeline.**
  - Predicting a future return/class from lagged features can be useful, but requires feature versioning,
    label-horizon definitions, probability calibration, retraining, and conversion of predictions into
    trades. It should not be smuggled into parameter optimization.
- **Exhaustive grid search: diagnostic use only.** Its cost grows combinatorially and it spends
  equal compute on unpromising regions.
- **Genetic programming with unrestricted trees: do not implement.** It creates an enormous search
  space and is an overfitting machine under a small compute budget.

## 2. Define the exploration space

Use three explicit search modes so “tune my strategy” and “invent a strategy” are never confused.

Implementation note: the backend has no `mode` field. A mode is a UI framing over the same config —
Mode A is `parameterOverrides` only, Mode B adds `ruleRoles`, Mode C adds `method: "evolution"` with a
rule library. The Optimize tab (Milestone 4) is where the A/B/C choice becomes an explicit control.

### Mode A — Tune parameters (default, smallest space)

- [x] Start from a saved strategy snapshot and keep its tree structure fixed.
- [ ] Let the user lock or tune each numeric value:
  - indicator parameters such as MACD `fast`, `slow`, and `signal` or Momentum `period`;
  - constant thresholds used by rules;
  - backtest sizing values when the position mode supports them.
  (indicator parameters and rule thresholds are done via `parameterOverrides` and controllable from
  the Optimize form's "Parameters & rules" section; backtest sizing values are not searchable yet)
- [x] Support integer, decimal, categorical, linear, and curated candidate ranges.
- [x] Validate every sample against catalog constraints, including `MACD fast < slow`.
- [x] Make range defaults conservative and centered near the current value; do not automatically use
      the indicator catalog's entire `1..500` validation range.

### Mode B — Select/prune rules (recommended second step)

- [x] Include Mode A plus required/optional/off controls for every existing rule or group.
      (roles apply per rule via `ruleRoles`; a group is controlled through its rules; the Optimize
      form's "Parameters & rules" section exposes the per-rule role control)
- [ ] Allow selected operators or group `at_least` counts to be searched only when the user opts in.
      (evolution search mutates operators and `at_least` counts, but there is no per-rule opt-in
      control for Mode B yet)
- [x] Preserve type-compatible operands and valid group shapes. (Mode A/B toggles cannot change
      operands; evolution mutations are typed and every candidate passes `validateCandidate`)
- [x] Add a complexity cost for active rules, unique indicator configurations, and tree depth.
- [x] Report inclusion frequency among the top robust candidates; a rule appearing in only one lucky
      candidate is weak evidence. (computed over the top ≤10 eligible candidates whenever rule
      structure is searched — optional-rule toggles or evolution — persisted as `summary.inclusion`
      and shown as the "Rule inclusion" bars in the result card)

### Mode C — Explore bounded new rules (advanced)

- [ ] The user supplies or approves a finite candidate-rule library rather than allowing every possible
      indicator/operator/value combination.
- [ ] Seed the library with templates such as:
  - indicator crosses another compatible indicator/output;
  - oscillator crosses or compares with one of a small set of thresholds;
  - price crosses a moving average/band;
  - relative volume or volatility acts as a confirmation/filter.
- [ ] Let the optimizer enable, disable, or insert candidates only at user-approved locations/groups.
- [ ] Require explicit caps, initially suggested as:
  - at most 2 newly added rules per entry/exit/cash side;
  - at most 6 active rules per side;
  - at most 4 unique indicator configurations per side;
  - tree depth at most 3;
  - a small threshold menu or bounded threshold range per oscillator.
- [ ] Reject duplicate, contradictory, always-true/always-false, invalid, or signal-starved candidates
      before spending a full backtest on them.
- [ ] Keep `and`/`or`/`not` tree rewrites out of the first structural-search release; begin with optional
      rules inside existing groups and user-approved insertion points.

### Search-budget presets

- [x] Offer **Quick**, **Standard**, and **Thorough** presets, plus Advanced custom limits. (a Budget
      select on the experiment form applies preset trials/runtime/folds calibrated from
      `backend/bench/RESULTS.md`; editing any budget field flips the select to Custom, and the live
      preflight estimate re-checks the choice on the actual data)
- [ ] A budget must include `max_trials`, `max_runtime`, worker count, promotion rate, and deterministic
      seed. The first defaults should be calibrated with benchmarks rather than guessed here.
      (`max_trials`, `max_runtime_ms`, `halving.promotionRate`, and `seed` exist in the config and the
      trial/runtime/fold defaults now come from bench-calibrated presets; worker count is still
      hard-coded to one thread)
- [x] Show an estimate in “backtest evaluations” and an approximate runtime based on a small preflight
      benchmark on the selected data. (`POST /api/v1/optimization-experiments/preflight` validates the
      draft config exactly like creation, counts planned fold backtests through the halving schedule,
      times the baseline on the selected candles, and warns when the estimate exceeds the runtime cap;
      the form calls it debounced on every config change)
- [ ] Allow pause/cancel; retain completed trials and checkpoints. Never leave a request running without
      a visible experiment record. (cancel/resume works, cancelled and interrupted experiments keep
      their scored trials — trials now stream to the database mid-run — and every run has an
      experiment record; there are no mid-run checkpoints — resume restarts deterministically from
      the snapshot)

## 3. Validation and scoring — required before optimization

Parameter search without time-series validation will mostly automate overfitting, so this work comes
before a clever optimizer.

### How the usual ML-course concepts map to this project

There is no widely used method simply called “K-learning.” Depending on what was meant:

- **K-fold cross-validation:** yes, but use chronological time-series folds rather than ordinary random
  or shuffled k-fold. Each fold trains/searches on the past and validates on a later period.
- **K-means:** potentially useful later for clustering market regimes (for example trend/volatility
  regimes) and checking whether a strategy only works in one cluster. Do not use clusters computed from
  future data to label the past.
- **K-nearest neighbours (k-NN):** possible later as one supervised model for predicting a future-return
  label, but it belongs to the separate prediction-model track rather than rule-parameter optimization.
- **Q-learning:** this is reinforcement learning and is deliberately deferred for the reasons in Section 1.

For an optimization experiment, the data roles should be:

1. **Training/search window:** generate or fit candidate strategies using only information available up
   to that point. For the initial rule optimizer, “training” mostly means searching parameters rather
   than fitting model weights.
2. **Validation window(s):** rank candidates on later, unseen periods. Repeated walk-forward folds tell us
   whether the result survives different regimes instead of one lucky split.
3. **Test window / sealed holdout:** open once after choosing a candidate. It must never influence search,
   range changes, scoring weights, or the choice among candidates; otherwise it has become another
   validation set and a new test set is needed.

- [x] Make the UI label these roles explicitly as **Search/Train**, **Validation**, and **Sealed Test**,
      with date ranges and a timeline preview. (the preflight response carries per-fold train/validation
      boundaries and the sealed window as timestamps; `OptimizeTimelinePreview` renders them as one row
      per fold with a legend using those three role names, date-range tooltips, and a dashed sealed-test
      region)
- [x] Provide expanding/anchored walk-forward folds first; add rolling fixed-length training windows as
      an option.
- [x] Never use ordinary shuffled k-fold, random train/test splitting, or random candle sampling.
      (only chronological anchored/rolling folds exist in `folds.ts`)
- [ ] Fit any learned preprocessing (scalers, imputers, feature selection, regime clustering) on the
      training portion only and apply that frozen transformation to later validation/test data.
- [x] Warm indicators using only candles at or before the evaluated timestamp. It is valid for the first
      validation indicator value to use earlier training candles; it is not valid to use a future candle.
      (`evaluateFold` slices from the fold's train start and simulates from `simulationStartIndex`;
      covered by a leakage test)
- [x] Add purging/embargo when observations or supervised-learning labels overlap a fold boundary. Size it
      from the actual label/trade horizon, not automatically from the indicator warm-up period.
      (optional `folds.embargoCandles` leaves a user-sized gap between each training window and its
      validation window; gap candles warm indicators but are neither training evidence nor scored,
      and the API rejects embargoes that starve validation windows)
- [x] Show fold-by-fold learning/robustness evidence so users can recognize high variance and overfitting;
      do not expose only one aggregate score. (per-fold results are persisted and returned by the trial
      API; the Section 7.1 fold robustness chart shows per-fold objectives for the selected trial vs
      baseline vs buy & hold, and the penalty breakdown exposes the instability component)
- [ ] If we later train a predictive model, include the standard concerns explicitly: feature/label
      definitions, scaling, class imbalance, calibration, training-only feature selection, model version,
      and a naive baseline.

- [x] Add transaction-cost assumptions to the simulator: commission/fees and configurable slippage.
      (fixed per-trade + percent-of-value commission and adverse slippage in basis points; accepted by
      the backtest and experiment APIs, stored with each run/experiment, default zero)
- [ ] Decide whether dividends/splits/adjusted-price behavior is sufficient for the selected data source
      and record that decision in each experiment.
- [x] Build chronological train/validation/holdout splits; never randomly shuffle candles.
      (optional `holdout: { fraction }` on the experiment config seals the last N% of each
      symbol's candles; the optimizer worker never receives them and folds are built over the
      search portion only — see `holdout.ts` and `optimization-holdout.test.ts`)
- [x] Add anchored and rolling walk-forward validation.
- [x] Evaluate across multiple symbols and market regimes when the user selects them; aggregate per-fold
      and per-symbol scores instead of concatenating unrelated equity curves. (each symbol/fold gets its
      own backtest and scoring takes medians across all fold evaluations)
- [x] Keep one final holdout sealed during search and show a warning after it has been opened.
      (the holdout evaluation is persisted with an audit timestamp; the result card shows a
      permanent "holdout was opened for trial N" warning and the section itself flips to the
      opened state)
- [ ] Calculate additional research metrics:
  - downside deviation / Sortino ratio;
  - Calmar ratio or return-to-drawdown;
  - exposure and time in market;
  - turnover and average holding period;
  - per-fold/per-symbol dispersion;
  - worst-fold return and drawdown;
  - stability of nearby parameter values;
  - active rule and unique-indicator count.
  (all computed except the parameter-stability metric, which belongs with Milestone 5's sensitivity
  work; Sortino, Calmar, exposure, turnover, and average holding period live in `BacktestMetrics`,
  and per-fold exposure/turnover are recorded on new trial fold results)
- [x] Define a versioned default robust score. Proposed shape (exact weights need fixture-based tuning):

  `median validation score - drawdown penalty - instability penalty - turnover penalty - complexity penalty`

  (implemented exactly this shape, now `scoringVersion = "2"` in `scoring.ts` with fixture-tuned
  weights)

- [x] Calibrate the scoring penalty weights on deterministic fixtures. The instability penalty
      (`0.5 × IQR of fold objectives`) especially can push every candidate negative when folds span
      different regimes, and the drawdown weight (0.02/pct) costs 0.6 for a 30% drawdown — verify on
      fixtures with known good/bad strategies that good ones stay positive. Bump `scoringVersion`
      when weights change so old experiments remain interpretable.
      (the predicted failure was real: an all-folds-positive but regime-dispersed strategy scored
      negative, so v2 halves the instability weight to 0.25; `optimization-scoring-calibration.test.ts`
      pins this with a three-regime candle fixture — known good/bad/one-regime-lucky strategies —
      plus hand-built fold sharpes covering dispersion, 30% drawdowns, and ranking order. The
      drawdown/turnover/complexity weights survived calibration unchanged)

- [x] Apply hard eligibility constraints before ranking, for example minimum trades, maximum drawdown,
      positive results in a minimum fraction of folds, and complete data coverage. (first three done;
      data coverage is not checked)
- [x] Rank with median/robust aggregates rather than choosing the candidate with the single highest fold.
- [x] After search, compare the chosen candidate once on the sealed holdout against the untouched baseline
      and benchmarks. Do not feed that result back into the same experiment. (one POST evaluates
      candidate, baseline, and buy & hold on the sealed window with warmup from the search
      portion; the result is stored separately from the summary and a second candidate gets a
      409 — tests assert the summary and trials are untouched)
- [x] Document survivorship bias: testing only today's ticker universe over historical periods can
      overstate results. (a permanent "research evidence, not a forecast" note at the bottom of the
      experiment result card states it where results are read)

## 4. Backend domain model and persistence

- [x] Add shared types for:
  - `OptimizationExperimentConfig` and immutable strategy/data snapshots;
  - parameter, categorical, rule-toggle, and bounded-rule search-space nodes;
  - walk-forward split definitions;
  - objective, penalties, and eligibility constraints;
  - experiment status and progress;
  - candidate/trial parameters, canonical strategy, fold results, score, and rejection reason;
  - promotion/checkpoint state and final holdout evaluation.
  (all exist except checkpoint and holdout types, which belong to features that don't exist yet)
- [x] Add SQLite tables (exact normalization can be decided during implementation):
  - `optimization_experiments` for configuration, snapshots, seed, method, status, and progress;
  - `optimization_trials` for candidate hash, sampled values, score, status, timings, and summaries;
  - per-fold/per-symbol metrics live as JSON on each trial row instead of a third table;
  - optional `optimization_artifacts` for checkpoints and reports (not needed yet).
- [x] Store a strategy snapshot, indicator-catalog/search-space version, data boundaries/coverage, scoring
      version, and simulator assumptions so old experiments remain interpretable. (the snapshot now
      also records `catalog_version` and `search_space_version` — bump `indicatorCatalogVersion` when
      an indicator's computation/parameters change and `searchSpaceVersion` when compilation changes;
      older experiments simply lack the fields)
- [x] Add indexes for experiment/rank/status and enforce uniqueness for a candidate hash within an
      experiment.
- [x] Define safe restart semantics: queued work resumes; an interrupted running trial is returned to the
      queue or marked interrupted; completed trial results are never recomputed unnecessarily.
- [x] Deleting an experiment must not delete strategies that were saved from its candidates.

## 5. Backend optimization engine

- [x] Extract a non-persisting backtest/evaluation path so hundreds of internal candidate evaluations do
      not create ordinary `backtest_runs` rows.
- [x] Compile the experiment search space from the strategy snapshot and indicator catalog.
- [x] Canonicalize strategies and compute stable hashes for deduplication/cache keys.
- [x] Generate valid seeded samples for Phase 1 random search.
- [x] Implement cheap candidate rejection and record the reason rather than silently dropping it.
- [x] Implement chronological folds and multi-symbol aggregation.
- [ ] Implement scoring, constraints, successive-halving promotion, checkpointing, and cancellation.
      (all done except checkpointing: an interrupted run restarts deterministically from its snapshot)
- [x] Run CPU-heavy trials in a bounded worker-thread pool so HTTP requests and the UI remain responsive.
      (one worker thread per experiment, experiments run sequentially)
- [ ] Default worker count conservatively and allow the user to lower it; optimization must not consume
      every core by default. (currently exactly one worker thread, so the conservative default holds by
      construction, but there is no user-facing setting)
- [x] Cache immutable candle arrays and indicator series by ticker/timeframe/range/spec within sensible
      memory bounds. Reuse identical indicator calculations across candidates. (a per-run LRU in
      `indicatorCache.ts` keyed by symbol/candle-slice/indicator-spec shares indicator series across
      all candidates, folds, ablation, and refinement; bounded by total cached values and freed with
      the worker. Candle arrays are loaded once per run; there is no cross-run cache)
- [x] Stream or page trial writes; do not retain every equity curve for every losing trial. (each
      finished trial is upserted to SQLite the moment the worker reports it, so a crash or restart
      keeps completed work; the final pass fills in leaderboard ranks. No equity curves are persisted
      for any trial)
- [ ] Persist full detail only for promoted/top candidates and recompute a selected candidate on demand
      from its immutable snapshot when appropriate. (currently the strategy JSON and fold results are
      stored for every non-rejected trial)
- [x] Benchmark and profile signal evaluation before adding dependencies or a second language/runtime.
      (`npm run bench` measures 56–149 fold backtests/second single-threaded on representative 1d/1h
      workloads — a maximum 500-trial experiment finishes in minutes, far inside the runtime cap, so
      plain TypeScript stays; numbers and the decision are recorded in `backend/bench/RESULTS.md`)
- [x] Implement TPE and constrained evolutionary search only after the Phase 1 engine and fixtures pass.

## 6. Backend API

The frontend must be a client of the same API; no optimization logic should exist only in React.

- [x] `POST /api/v1/optimization-experiments` — validate config, snapshot inputs, create an experiment,
      and queue it.
- [x] `GET /api/v1/optimization-experiments` — list experiments with filters/pagination.
- [x] `GET /api/v1/optimization-experiments/:id` — configuration, progress, baseline, and summary.
- [x] `POST /api/v1/optimization-experiments/:id/cancel` — cooperative cancellation.
- [x] `POST /api/v1/optimization-experiments/:id/resume` — resume a paused/interrupted experiment within
      its original immutable configuration.
- [x] `DELETE /api/v1/optimization-experiments/:id` — delete an experiment without touching strategies
      saved from its candidates. (added during implementation; was not in the original plan)
- [x] `GET /api/v1/optimization-experiments/search-space?strategy_id=N` — the default-compiled search
      space for a saved strategy (rules with ids/summaries, parameter nodes with conservative ranges
      and catalog hard bounds), so the experiment form can offer per-parameter and per-rule controls
      before anything is created. `rule_roles` and `parameter_overrides` are now validated with
      structured errors instead of being cast unchecked. (added during implementation)
- [x] `GET /api/v1/optimization-experiments/:id/trials` — paginated/sortable leaderboard.
- [x] `GET /api/v1/optimization-experiments/:id/trials/:trialId` — candidate strategy and fold details.
- [x] `POST /api/v1/optimization-experiments/:id/trials/:trialId/holdout` — one explicit sealed-holdout
      evaluation with an audit timestamp. (idempotent for the opened trial, 409 for any other
      trial afterwards, 400 on experiments created without a holdout, 409 when stored candles
      drifted from the snapshot; persists nothing except the experiment's `holdout` JSON)
- [x] `GET /api/v1/optimization-experiments/:id/trials/:trialId/equity` — on-demand recompute of a
      candidate's (and the baseline's) per-fold validation equity curves from the immutable snapshot;
      persists nothing. (serves the Section 7.1 equity chart; 409 when stored candles have drifted
      from the snapshot, since the curves could no longer be recomputed faithfully)
- [x] `POST /api/v1/optimization-experiments/:id/trials/:trialId/strategies` — clone a candidate into the
      normal Strategies collection; never overwrite the source strategy.
- [x] Decide between short polling and server-sent events for progress. Start with polling unless profiling
      shows it is inadequate. (decision: short polling of the experiment record's progress JSON)
- [x] Return structured validation errors for invalid ranges, impossible rule combinations, insufficient
      candles, and budgets above configured safety limits.
- [x] Add API tests for lifecycle transitions, cancellation/resume, pagination, reproducibility, invalid
      configurations, and saving a candidate.

## 7. Frontend — fourth tab

- [x] Extend `AppTab` and the header with `optimize`; keep completed/running experiment state across tab
      switches as Backtest does for loaded runs.
- [x] Build an Optimize landing page with experiment history and a **New experiment** action. (the
      experiment history list with cancel/resume/delete and progress polling is done; the "new
      experiment" action is a single flat form rather than the guided multi-step wizard below)
- [ ] Build a guided experiment form:
  1. choose a saved baseline strategy;
  2. choose Mode A, B, or advanced C;
  3. choose symbols, timeframe, date range, folds, and sealed holdout;
  4. mark parameters and rules as fixed/tunable/optional and set bounded ranges;
  5. choose objective, penalties, and hard constraints;
  6. choose compute preset, inspect the preflight cost estimate, and start.
  (steps 1, 3, 4, and 6 exist on the flat form — step 4 via the collapsible "Parameters & rules"
  section, which loads the compiled search space, offers tune/lock with catalog-bounded ranges and
  required/optional/off per rule, pre-validates impossible configurations, and only sends
  deviations from the defaults; step 6 via the Budget presets and the live preflight estimate with
  the data-role timeline; still open: the explicit A/B/C mode framing and objective/penalty/
  constraint controls)
- [x] Visualize the search-space size/risk before starting, including which choices multiply the space.
      (the preflight section shows total combinations and dimension count derived from the edited
      ranges/roles, names the biggest multipliers with their cardinalities, and warns when the trial
      budget undersamples the space; derivations unit-tested in `optimize-preflight-utils.test.ts`)
- [ ] Build an experiment progress view with status, elapsed time, completed/promoted/rejected trial counts,
      current stage, remaining budget, stop/resume controls, and baseline score.
- [x] Build a leaderboard showing robust validation score, return, drawdown, trade count, turnover,
      complexity, worst fold, and improvement over baseline. (first shipped as an expand-a-row
      dropdown in the history list; Section 7.1 replaces that with the experiment result card)
- [ ] Add filters for eligible/ineligible/promoted candidates and a Pareto view when supported.
      (eligible/ineligible/promoted leaderboard filters are done; the Pareto view is not)
- [x] Add **Save as strategy** and **Open in Backtest** actions. Saving always creates a named copy with
      experiment/trial provenance. (both live on each leaderboard row; Open in Backtest saves the
      candidate first, then switches tabs with it preselected in the run form)
- [x] Make warnings visible when the sample is small, costs are zero, too few trades occurred, results are
      unstable, or the sealed holdout has already been inspected. (amber warning list on the result
      card covers zero costs, short validation folds, too few trades on the top candidate, fold
      instability, and an opened sealed holdout)

### 7.1 Experiment result view — selection + charts (replaces the expand-row dropdown)

Design intent (informational, not a data dump):

- Selecting an experiment row shows a result card **below** the Strategy Lab card, exactly like
  opening a run in Backtest — no chevron/dropdown toggle.
- Progressive disclosure: stat tiles first, then charts, then the leaderboard table, then a
  candidate detail section for one selected trial. Every chart answers one question; never render
  raw JSON.
- Almost all data already exists: each trial row carries the score with its penalty breakdown,
  sampled values, complexity, and metrics; the experiment summary carries baseline and buy-&-hold
  fold results, ablation entries, Pareto fronts, and the compiled search space. `max_trials` is
  capped at 500 and the trials endpoint accepts `limit=500`, so one request fetches every trial
  for charting. Only the equity chart needs new backend work.
- Sealed-holdout presentation stays with Milestone 5's holdout workflow; this view is about
  search + validation evidence.

Tasks, in order:

- [x] Replace the expand-row leaderboard with row selection: clicking a finished/cancelled/interrupted
      experiment row selects it (highlight the row), render an `OptimizeExperimentResultCard` below
      the Strategy Lab card, and let a close button deselect. Keep the selection across tab switches
      like Backtest's active run. Move `OptimizeTrialsLeaderboard` into the card unchanged for now.
      (selection lives in `use-optimize-experiments` and clears on delete or resume; verified in the
      browser — select, close, and tab-switch persistence all work)
- [x] Add a `use-optimize-experiment-detail` hook: load the experiment record plus all trials in one
      `limit=500` request, derive chart series (trial-index order) and leaderboard order (rank) from
      the same response, and track the selected trial. Unit-test the pure derivation helpers.
      (derivations live in `lib/optimize-detail-utils.ts` with node:test coverage via `npm test`;
      the hook replaced `use-optimize-trials`, the leaderboard consumes it and filters client-side)
- [x] Build the result-card header and stat tiles: strategy / ticker / timeframe / date range /
      method / seed summary, plus tiles for baseline score, best score, Δ vs baseline, buy & hold
      median objective, scored/pruned/rejected counts, and elapsed time. Use the dataviz skill for
      the tiles and every chart below. (all chart series colors are `--viz-*` tokens in `index.css`,
      validated for both themes with the dataviz palette validator)
- [x] **Optimization trace chart** — “what did we try and did it improve”: score vs trial index for
      every scored trial (colored eligible vs not, pruned marked), a best-so-far step line, and a
      horizontal baseline-score reference line. Tooltip shows the trial's sampled values.
      (sampled-value ids are compressed to labels like “entry r1 fast” via `nodeLabel`)
- [x] **Score decomposition chart** — “why is the score small or negative”: for the baseline and the
      top ~8 eligible trials, show the median objective with the drawdown / instability / turnover /
      complexity penalties subtracted from it, so the net score is legible at a glance.
- [x] **Fold robustness chart** — “does it survive regimes”: per-fold objective for the selected
      trial vs baseline vs buy & hold, grouped per fold (and per symbol when several). Render the
      baseline alone while no trial is selected. (baseline + buy & hold always render; clicking a
      scored/pruned leaderboard row lazily fetches that trial's fold results and adds its bars)
- [x] Trial selection + candidate detail section: clicking a leaderboard row selects the trial and
      shows a readable diff vs the baseline (changed parameters from `values` + the search-space
      nodes, toggled rules), its penalty breakdown, ineligibility reasons when present, and the
      existing save/backtest actions. (`OptimizeCandidateDetail` renders below the leaderboard;
      `candidateDiff` in `optimize-candidate-utils.ts` derives the rows and is unit-tested)
- [x] **Parameter sensitivity small multiples** — “robust region or lucky spike”: for each numeric
      search node, a scatter of score vs sampled value across all scored trials, with the baseline's
      current value marked. (This pulls the cheap part of Milestone 5's sensitivity work forward;
      the fuller neighborhood/stability tooling stays in Milestone 5.) (numeric and curated-choice
      nodes each get a small scatter with a shared score scale and a dashed line at the baseline
      value; panels whose trials all sampled one value are dropped)
- [x] **Ablation chart**: horizontal bars of score delta per disabled rule from `summary.ablation`,
      including skipped entries with their reason — this data is computed today and shown nowhere.
      (diverging bars sorted by delta with tooltips; skipped rules listed with their skip reason)
- [x] Backend: `GET /api/v1/optimization-experiments/:id/trials/:trialId/equity` — recompute the
      candidate and baseline from the immutable snapshot on demand and return per-fold validation
      equity curves without persisting anything. Add API tests (unknown/rejected trial, determinism
      across two calls). (also returns 409 when stored candles no longer match the snapshot;
      `optimization-equity.test.ts` covers all of it plus persistence-free recompute)
- [x] **Equity chart** in the candidate detail section: candidate vs baseline validation equity from
      the endpoint above, clearly labelled as validation-fold performance, loaded lazily on trial
      selection. (per-fold % return segments with fold boundaries and a crosshair tooltip;
      responses cached per trial in `use-trial-equity`)
- [x] Finish: frontend tests for selection behavior and chart-data derivation, then run react-doctor
      over the new components. (both selection reducers were extracted into
      `optimize-detail-state.ts` / `optimize-experiments-state.ts` and unit-tested — trial/experiment
      select-toggle, clear-on-delete/resume, detail caching — alongside tests for the sensitivity and
      warning derivations; react-doctor scores the changed components 100/100)

## 8. Testing and reproducibility

- [x] Unit-test search-space compilation, conditional constraints, canonical hashes, sampling, pruning,
      fold boundaries, embargoes, scores, penalties, and promotion decisions. (all covered, including
      embargo gaps, starved-validation errors, and warmup-only embargo candles)
- [x] Use synthetic candle fixtures where the expected useful/irrelevant rules are known.
- [x] Prove identical config + data snapshot + seed produces the same candidate sequence and ranking,
      independent of worker completion order. (tested at optimizer and experiment level; completion
      order is trivially fixed while there is one worker per experiment)
- [x] Prove no candle after a fold boundary influences that fold's indicator values, signals, or score.
- [x] Compare cached and uncached evaluations byte-for-byte at the response boundary. (cached,
      cache-disabled, and eviction-heavy `runOptimization` results compare byte-for-byte in
      `optimization-cache.test.ts`, plus fold-level identity with asserted hit/miss counts)
- [x] Add integration tests for a tiny completed experiment and cancel/resume behavior.
- [ ] Add frontend tests for configuration validation, progress states, leaderboard sorting, candidate diff,
      and explicit holdout confirmation. (leaderboard sorting/filtering, candidate diff, selection
      behavior, chart/warning derivations, and the holdout open lifecycle + comparison-row
      derivations are covered, and the search-space editor's override/role building and
      configuration pre-validation are unit-tested; progress states remain)
- [x] Create benchmark fixtures and record evaluations/second and peak memory for representative 1d and 1h
      workloads. (`backend/bench/optimizationBench.ts` runs seeded 1d and 1h random-walk workloads with
      a MACD+RSI strategy; results — 149 and 56 fold backtests/second, peak RSS under 200 MB — are
      recorded in `backend/bench/RESULTS.md`)

## 9. Suggested implementation order

- [x] **Milestone 1 — Research-safe backtests:** costs, additional metrics, chronological folds, robust
      scoring, data snapshots, and tests. (the parameter-stability metric is deferred to Milestone 5's
      sensitivity tooling; everything else is done)
- [x] **Milestone 2 — Backend experiment skeleton:** types, tables, CRUD/lifecycle API, worker pool,
      checkpoints, cancellation, and a no-op/deterministic trial fixture. (checkpoints became
      deterministic restart-from-snapshot rather than mid-run checkpoints)
- [x] **Milestone 3 — Useful optimizer MVP:** Mode A seeded random search, rule toggles for Mode B,
      constraints, successive halving, caching, and baseline comparisons.
- [ ] **Milestone 4 — Optimize tab MVP:** experiment setup/history/progress, leaderboard, candidate detail,
      save-as-strategy, and open-in-backtest. (setup/history/progress with cancel/resume/delete, the
      leaderboard with filters, save-as-strategy, open-in-backtest, and the whole Section 7.1 result
      view — selection, charts, sensitivity small multiples, ablation, rule inclusion, warnings,
      candidate detail with the on-demand equity endpoint, and the finish pass — are done; still
      open: the guided setup wizard)
- [ ] **Milestone 5 — Robustness tools:** sensitivity maps, inclusion frequency, ablation, Pareto view, and
      explicit sealed-holdout workflow. (the score-vs-parameter scatter and the ablation chart ship
      early with Section 7.1; the sealed-holdout workflow — config, sealing, one-time endpoint,
      result-card section with confirmation, and warnings — is done; the deeper
      neighborhood/stability tooling and the Pareto view stay here)
- [ ] **Milestone 6 — Smarter search:** TPE benchmarked against random search, then bounded evolutionary
      Mode C.
- [ ] **Milestone 7 — Separate ML research track (optional):** supervised prediction and only later an RL
      environment if the simpler, explainable system has demonstrated its limits.

## 10. MVP completion criteria

- [x] From either the backend API or Optimize tab, a user can tune a saved strategy's selected numeric
      parameters and optional existing rules under a finite compute budget. (works via the backend API
      and the Optimize tab's new-experiment form, which searches all tunable parameters by default;
      per-parameter tune/lock ranges and per-rule required/optional/off roles are editable in the
      form's "Parameters & rules" section)
- [x] The experiment is reproducible, cancellable/resumable, does not block normal API requests, and
      survives a backend restart without losing completed trials. (finished trials now stream to
      SQLite mid-run, so a restart leaves an interrupted experiment with its completed trials intact
      and listable; resuming still recomputes deterministically from the snapshot)
- [x] Candidate ranking uses walk-forward validation, realistic configured costs, hard eligibility
      constraints, and a complexity-aware robust score. (costs default to zero until the user
      configures them; the Optimize tab should warn on zero-cost experiments per Section 7)
- [x] The UI clearly distinguishes training/validation from the one-time sealed holdout. (the
      leaderboard, charts, and equity are labelled validation evidence; the sealed-holdout section
      is separate, locked until explicitly opened once, and permanently flagged afterwards; the
      setup form's preflight timeline labels Search/Train, Validation, and Sealed Test with date
      ranges before the experiment starts)
- [x] The user can understand the diff and evidence, save a candidate as a new normal strategy, and backtest
      it without mutating the baseline. (selecting a leaderboard row shows the candidate detail with
      the diff vs baseline, penalty breakdown, ineligibility reasons, fold comparison, and validation
      equity, plus save/backtest actions that never touch the baseline)
- [ ] Under an equal evaluation budget, every smarter search method is reported against seeded random
      search; no method is called better based on one strategy or ticker. (a TPE-vs-random equal-budget
      fixture test exists; broader multi-strategy/multi-ticker benchmarks do not)

## 11. Decisions to discuss before implementation

- [ ] Confirm the tab label: **Optimize** (recommended) vs. **Research** or **Strategy Lab**.
- [ ] Confirm the first MVP scope: Mode A plus existing-rule toggles from Mode B (recommended), with new-rule
      generation deferred.
- [ ] Choose the default robust objective and hard constraints; total return alone should not be offered as
      the recommended objective. (the code currently defaults to Sharpe with the scoring-v2 penalty
      weights and constraints — treat that as the proposal to confirm or revise)
- [ ] Choose the default validation design and minimum history for 1d versus intraday experiments.
- [ ] Decide whether an experiment initially targets one symbol or requires a small symbol basket by
      default.
- [ ] Decide which transaction-cost/slippage model is sufficient for the MVP. (the code now implements
      fixed-per-trade + percent-of-value commission and adverse slippage in basis points — treat that
      as the proposal to confirm or revise)
- [ ] Calibrate Quick/Standard/Thorough budgets on the actual machine and representative stored data.
- [ ] Decide whether Phase 2 TPE should remain dependency-light in TypeScript or use a separately managed
      Python worker only if the measured benefit justifies the operational cost.
