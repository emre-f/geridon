# TODO 4 — Data Source Menu

> Planning document only. Hard dependency: **nothing here starts until TODO-3's events table,
> Form 4 ingestion, and evaluation engine are done.** After that, sources can land in any
> order, one at a time, whenever we feel like adding one.

## 0. How this file works

TODO-3 built the machine; this file is the fuel menu. Every source below follows the same
four-step recipe, so each one is a thin, mostly mechanical ticket — good candidates for
bulk-implementation agents once the first one or two have set the pattern:

1. **Fetch + cache**: download raw data into `backend/data/raw/<source>/`, never re-download
   what is cached, respect the provider's rate limits and terms.
2. **Normalize**: map rows into the TODO-3 `events` table — `source`, `ticker`, `event_kind`,
   `event_ts`, `available_ts`, `payload`, `score`, `dedupe_key`. The hard thinking per source
   is almost always `available_ts`: when could the public actually know?
3. **Evaluate**: run the existing pooled evaluation (event study vs matched baseline, score
   buckets, cost line, holdout untouched). No new evaluation code per source.
4. **Record the verdict** in the registry — including `no_signal`. A dead source is a finished
   ticket, not a failure; it is one fewer thing to wonder about, and the multiple-testing
   counter stays honest.

Per-source sections state: what it is, why it might work (the economic reason someone is on
the losing side), where the data lives, the `available_ts` rule, event kinds + scores, and
known traps. An agent implementing a source reads TODO-3 sections 1–2 first, then its section
here, and should need nothing else.

General rules for every source:

- Ingestion parameters (thresholds, windows) are constants, not tunables. Tuning ingestion is
  optimizing the data; if a knob matters, expose it as an evaluation-time payload filter.
- Idempotent, resumable CLI ingestion via `event_ingestions`, mirroring the Form 4 command.
- Offline parser fixtures; no network in tests.
- If a source's history is short, say so in the coverage view — a 2-year event study is a
  hint, not evidence.

## 1. Earnings events (PEAD)

**What / why**: earnings announcement dates plus the surprise (actual EPS vs consensus).
Post-earnings announcement drift — prices underreacting to surprises for weeks — is one of
the oldest documented anomalies. Decayed in large caps, more alive in small ones. The losing
side: investors anchored to pre-announcement views, and mandates that rebalance slowly.

**Data**: earnings calendar + actual/estimate EPS. Polygon has earnings endpoints on paid
tiers (check the current plan's access first — we already have a key); free fallbacks exist
but are lower quality. History depth matters more than freshness here.

**`available_ts`**: the announcement datetime. Critical trap: announcements are before-open
or after-close; an after-close announcement is actionable at the next open, a before-open one
that same open. If the source only gives a date with no time, assume after-close of that date
(conservative).

- [ ] Fetch + cache earnings history for the candle universe.
- [ ] Events: `earnings_beat` / `earnings_miss`, score = standardized surprise
      (actual − estimate, scaled by estimate dispersion or price); payload: EPS values,
      announce time-of-day, fiscal period.
- [ ] Evaluate: beats vs misses separately; score buckets; check drift horizon (PEAD is a
      21–63 day effect, so the 63-day horizon is the interesting one).
- [ ] Record verdicts.

## 2. LLM-labeled filings and press releases (8-K)

**What / why**: 8-K filings are mandated real-time disclosure of material events — guidance
changes, executive departures, buybacks, restructurings — as unstructured text. The edge
candidate is not the filing's existence (everyone sees it) but *cheap accurate labeling at
scale*, which LLMs only recently made possible for individuals. The losing side: readers who
are slower or coarser at triage.

**Data**: EDGAR full-text 8-K filings (free; same etiquette as Form 4). Volume is large —
this is the one source where ingestion itself costs real compute/API money, so it starts
with a narrow slice.

**`available_ts`**: EDGAR acceptance datetime, exactly like Form 4.

**Design constraint**: the labeler is versioned like an indicator (`labelerVersion`: model +
prompt hash). Relabeling with a new prompt/model creates new event rows under the new
version; evaluations pin a version. Never mix labeler versions in one evaluation.

- [ ] Pick 2–3 item types with obvious priors (proposal: guidance updates, buyback
      announcements, unplanned executive departures) and fetch only those 8-K items.
- [ ] Labeling pipeline: filing text → structured label via a cheap model (this is bulk
      mechanical work — gpt-5.5 via codex per the model-routing rules), JSON schema output:
      kind, direction, severity 1–5, one-line rationale kept in payload for spot-checking.
- [ ] Calibration set: ~100 hand-checked filings; labeler must clear a stated accuracy bar
      before bulk labeling spends money.
- [ ] Events: `filing_guidance_up` / `filing_guidance_down` / `filing_buyback` /
      `filing_exec_departure`, score = severity.
- [ ] Evaluate per kind; direction buckets; record verdicts.
- [ ] Only after a validated signal: extend backfill breadth/history.

## 3. Congressional trading disclosures

**What / why**: STOCK Act periodic transaction reports from members of Congress. Popular
thesis (informed committee members), weak-to-mixed academic evidence — treat as a cheap
test of a popular claim. The honest expectation is `no_signal`; proving that is still value.

**Data**: House/Senate financial disclosure portals publish PTRs; several free scraped
aggregations exist. Amounts are ranges, not exact values.

**`available_ts`**: the **disclosure filing date**, never the trade date — the gap is up to
45 days and is exactly where fake alpha hides. This source is the best stress test of the
point-in-time firewall.

- [ ] Fetch + normalize PTRs; events `congress_buy` / `congress_sell`, score = log midpoint
      of the amount range; payload: member, chamber, reported trade date, disclosure lag.
- [ ] Evaluate, including a lag-bucket split (does anything survive the 45-day staleness?).
- [ ] Record verdict either way.

## 4. Short interest

**What / why**: exchange-reported short interest per ticker, published twice a month with a
lag. Documented effects: high short interest predicts underperformance (limits to arbitrage);
sharp changes carry information. Long-only harness note: the tradable side for us is mostly
avoidance/filtering, so the likely consumer is a `SignalOperand` *filter* in strategies
rather than a trigger.

**Data**: FINRA publishes consolidated short interest files (free). Bi-monthly cycle.

**`available_ts`**: FINRA's publication date for the cycle, not the settlement date it
describes (the lag is ~1–2 weeks; using settlement date is lookahead).

- [ ] Fetch + cache cycles; events `short_interest_report` with score = days-to-cover, and
      derived `short_interest_spike` (change vs prior cycle above a constant threshold).
- [ ] Evaluate spikes as events; evaluate levels as a filter (does high short interest
      predict weaker post-event returns for *other* signals? — this is a payload filter on
      existing evaluations, not new machinery).
- [ ] Record verdicts.

## 5. 13F institutional holdings

**What / why**: quarterly long-position snapshots of large managers, filed up to 45 days
after quarter end. Well picked-over; plausible remnants are crowding measures and new-stake
initiations by high-conviction managers. Expectation: weak. Ranked last for a reason —
implement only if the appetite survives sources 1–4.

**Data**: EDGAR 13F filings; DERA also publishes structured quarterly datasets.

**`available_ts`**: EDGAR acceptance datetime of the filing (holdings are already ~45 days
stale at that moment — the staleness is the point of the test).

- [ ] Ingest a curated manager list (constant, not tunable) rather than all filers.
- [ ] Events: `inst_new_stake` / `inst_exit`, score = position size vs portfolio.
- [ ] Evaluate; record verdicts.

## 6. Explicitly out of scope

Stated so future sessions do not relitigate:

- **Paid alternative data** (options flow, credit card panels, satellite): cost does not fit
  a research rig that has not yet validated a free source end-to-end.
- **Social sentiment scraping** (X/Reddit): ToS friction, extreme survivorship in historical
  archives, and the documented effects are mostly intraday — wrong timescale for daily bars.
- **Live/streaming ingestion** of any source: research first. A source earns a freshness
  upgrade (e.g. EDGAR daily-index polling for Form 4/8-K) only after its signal is validated
  *and* a strategy consuming it is actually being traded.
- **News APIs with licensing walls**: 8-K/press-release text from EDGAR covers the tradable
  core without a subscription.

## 7. Completion criteria (per source, same for all)

- [ ] Backfill completes idempotently; coverage view shows sane per-year counts.
- [ ] Parser fixtures pass offline.
- [ ] At least one pooled evaluation per event kind exists in the registry with a verdict.
- [ ] A one-paragraph summary of the verdict is appended to this file under the source's
      section (what was tested, N, headline number, keep/drop) — this file doubles as the
      research log's table of contents.
