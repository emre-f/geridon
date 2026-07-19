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

- [x] Fetch + cache earnings history for the candle universe. While choosing the provider,
      check whether it also carries **forward guidance and forward consensus history** — that
      decides which path the guidance subsection below takes.
- [x] Events: `earnings_beat` / `earnings_miss`, score = standardized surprise
      (actual − estimate, scaled by estimate dispersion or price); payload: EPS values,
      announce time-of-day, fiscal period.
- [x] Evaluate: beats vs misses separately; score buckets; check drift horizon (PEAD is a
      21–63 day effect, so the 63-day horizon is the interesting one).
      (evaluations #13–#15, seed 1, universe min $5 / $5M median dollar volume: all beats,
      all misses, beats with `min_score` 0.0025 — the round constant nearest the top-tercile
      boundary the score buckets exposed)
- [x] Record verdicts.

**Provider decision (2026-07-19)**: NASDAQ earnings calendar
(`api.nasdaq.com/api/calendar/earnings?date=`), keyless, one cached JSON per calendar day,
history back to ~April 2008. Checked first per the ticket: our Polygon key is NOT entitled to
the Benzinga earnings endpoints (`NOT_AUTHORIZED`), and Polygon's free financials are
XBRL filings with no consensus estimates. NASDAQ rows carry actual EPS, consensus, and
estimate count. Traps found: historical rows always report `time-not-supplied` (so every
event takes the plan's conservative after-close rule; the payload keeps `announce_time` in
case future rows have it), and the `marketCap` column is the *current* market cap even on
2010 dates — lookahead, never ingested. Surprise is scaled by prior close (the feed has no
per-analyst dispersion); events whose ticker has no candle history yet at the announcement
keep a null score so the events table doesn't bake in today's candle coverage. NASDAQ has
**no guidance or forward-consensus history**, so §1b takes the *extraction path*.

**Verdict (2026-07-19): `no_signal`, all three draws — but the interesting kind of nothing.**
Backfill 2008–2026 complete (~45k events; the study effectively starts 2016 where candle
coverage begins, holdout excluded). Pooled beats N=17,997 on 860 tickers: flat early, then
**−0.36% at 63d, t=−2.25** — the average beat is mildly *anti*-alpha at the drift horizon;
do not chase beats. Pooled misses N=5,440: −0.66% at 63d, t=−1.71, biggest misses most
negative (−0.39% at 21d) — directionally the classic downside PEAD, untradable long-only
except as future filter material. The beat score buckets were monotonic in surprise
(q1 −0.26% → q3 +0.50% at 21d, q3 peak +0.97% with a 63-bar natural hold), so one follow-up
was spent: beats with surprise ≥ 0.25% of prior close (N=5,609) — positive at every horizon,
textbook 63d PEAD shape, +0.27% net at 63d, but **t=1.02**: the shape survives, the
significance does not, consistent with post-2016 PEAD decay in liquid names. Keep the source
(cheap, permanent cache); revisit the big-beat slice only if §1b's guidance interaction
(beat+raise) sharpens it. Multiple-testing counter: +3.

### 1b. Guidance surprise (raise/cut of next-quarter projections)

**What / why**: management's projection for the *next* quarter (or full year), issued with the
earnings release. Arguably the more important half of an ER: the reported beat is about the
past quarter, while the guide moves the estimates the market prices going forward — "beat but
guided down" routinely trades like a miss. The losing side: investors anchored to the reported
number who underweight the revision.

**Data reality (the pipeline work)**: structured forward-guidance and forward-consensus
history is mostly paid data; guidance itself usually exists only as text in the press release
/ 8-K. Two paths, decided by the provider check in the first ticket above:

- *Quantitative path* (provider has guidance + forward consensus): surprise = guided value vs
  consensus for that future period, standardized like the EPS surprise. Cleanest, take it if
  available.
- *Extraction path* (default assumption): extend section 2's 8-K labeler to extract guided
  figures — metric, period, low/high/point — and compare against **prior guidance** for the
  same period (self-relative raise/cut needs no consensus data at all). Same
  `labelerVersion` discipline as section 2.

**`available_ts`**: same rule as the EPS events — guidance ships with the announcement (or its
own 8-K acceptance datetime on the extraction path).

- [ ] Events: `guidance_raise` / `guidance_cut`, score = revision magnitude (new vs prior
      guide midpoint, scaled by price); payload: metric, period, low/high/point values, and a
      `withdrawn` flag (withdrawal is its own severe row, not a synthetic number).
- [ ] Evaluate separately from beats/misses, plus the interaction buckets this source exists
      for: beat+raise / beat+cut / miss+raise / miss+cut — the hypothesis is that the guide
      dominates the beat.
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

- [x] Pick 2–3 item types with obvious priors (proposal: guidance updates, buyback
      announcements, unplanned executive departures) and fetch only those 8-K items.
      (**Items chosen (2026-07-20): 2.02 and 5.02.** Item 2.02 (results of operations) is
      where guidance ships — the EX-99 press release attached to it is the text §1b's
      extraction path will read; item 5.02 covers officer/director departures (the labeler
      must still separate unplanned departures from routine appointment/comp rows filed under
      the same item). **Buybacks are deferred**: they have no dedicated item code — they ride
      the 7.01/8.01 catch-alls, which are mostly noise at fetch time; if appetite survives,
      the route is EDGAR full-text search (`efts.sec.gov`, coverage 2001+), a separate
      discovery mechanism. `backend/src/services/sec/eightK*.ts`: discovery via the
      `data.sec.gov/submissions/CIK….json` API (ticker→CIK from `company_tickers.json`;
      pagination files fetched only when the window reaches past the recent block), which
      lists every filing's item codes and acceptance datetime — the future `available_ts` —
      without touching the filing itself. Per matched filing the fetcher pulls the SGML
      `-index-headers.html` manifest, the primary 8-K document, and EX-99* `.htm`/`.txt`
      exhibits (XBRL/images never); cache under `backend/data/raw/sec8k/`
      (`listings/<TICKER>.json`, `filings/<cik>/<accession>/`), `documents.json` written last
      marks a filing complete, 404s leave `.missing` markers so re-runs never re-request.
      Throttled under SEC's 10 req/s with `SEC_USER_AGENT`; share classes on one CIK dedupe
      by accession. No events are inserted at this stage — the labeling bullets own that — so
      idempotency is file-cache-level, not `event_ingestions`. CLI
      `npm run ingest -- 8k [--from=2016] [--to=now] [--tickers=…]`; default from 2016
      (candle coverage; the item numbering exists since Aug 2004). Offline fixtures in
      `backend/test/eightKFetch.test.ts`.)
- [ ] Labeling pipeline: filing text → structured label via a cheap model (this is bulk
      mechanical work — gpt-5.5 via codex per the model-routing rules), JSON schema output:
      kind, direction, severity 1–5, one-line rationale kept in payload for spot-checking.
- [ ] Calibration set: ~100 hand-checked filings; labeler must clear a stated accuracy bar
      before bulk labeling spends money.
- [ ] Events: `filing_guidance_up` / `filing_guidance_down` / `filing_buyback` /
      `filing_exec_departure`, score = severity. For guidance items, the labeler also extracts
      the guided figures (metric, period, low/high/point) — section 1b's extraction path
      consumes them, so the schema is shared, not duplicated.
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

- [x] Fetch + normalize PTRs; events `congress_buy` / `congress_sell`, score = log midpoint
      of the amount range; payload: member, chamber, reported trade date, disclosure lag.
      (`backend/src/services/congress/`: source is the **official Senate eFD portal** — the
      free scraped aggregations this section assumed (Senate/House Stock Watcher S3 buckets)
      are dead (AccessDenied), and House PTRs are published only as PDFs, which the
      zero-dependency backend cannot parse, so v1 is **Senate-only** with `chamber` in the
      payload for a later House source. eFD sits behind Akamai (Node fetch passes, curl does
      not); the client does the session handshake + prohibition-agreement step, paginates the
      PTR search per year, and fetches electronic filings' HTML tables; paper filings
      (all of 2012–13, ~26% overall) are counted, never parsed. Cache under
      `backend/data/raw/congress/senate/{year}/`, year-unit resumable via `event_ingestions`
      (source `senate_efd`); `available_ts` = filing date end-of-day UTC like Form 4; dedupe
      key is transaction identity so the 206 amendments land as duplicates; payload also
      carries `disclosure_lag_days` + `prompt_disclosure` (lag ≤ 14d constant) so lag buckets
      are evaluation-time payload filters. `npm run ingest -- congress`; offline fixtures in
      `backend/test/congressPtrIngest.test.ts`. Backfill 2012–2025: 2,298 filings, 5,039
      events on the candle universe (buys+sells roughly balanced, sane per-year counts
      2015+; 8 point-in-time violations skipped).)
- [x] Evaluate, including a lag-bucket split (does anything survive the 45-day staleness?).
      (evaluations #9–#12, seed 1, universe min $5 / $5M median dollar volume: all buys, all
      sells, prompt-only (`prompt_disclosure: 1`), stale-only (`disclosure_lag_days: 30`))
- [x] Record verdict either way.

**Verdict (2026-07-19): `no_signal`, all four draws.** Senate PTRs 2015–2024 (ex-holdout),
pooled event study vs matched baseline: `congress_buy` N=1,946 on 369 tickers, t=0.16, net
+11.5bp; `congress_sell` N=2,211, t=0.54, net −5.9bp (gaps negative at every horizon but
nowhere near significant); prompt buys (lag ≤ 14d) N=572, t=1.21, fading negative after day
1; stale buys (lag ≥ 30d) N=490, t=1.42, a +56bp blip at 21d that collapses to −204bp by
63d — noise, not survival of staleness. No score bucket is monotonic. The popular thesis
fails a fair point-in-time test on this universe; keep the source ingested as a cheap
negative control, do not build strategies on it. Caveats: Senate-only (House needs a PDF
path), electronic coverage starts 2014, candle coverage 2016-07, and ~3.5k transaction rows
fall outside the 950-ticker universe.

## 4. Short interest

**What / why**: exchange-reported short interest per ticker, published twice a month with a
lag. Documented effects: high short interest predicts underperformance (limits to arbitrage);
sharp changes carry information. Long-only harness note: the tradable side for us is mostly
avoidance/filtering, so the likely consumer is a `SignalOperand` *filter* in strategies
rather than a trigger.

**Data**: FINRA publishes consolidated short interest files (free). Bi-monthly cycle.

**`available_ts`**: FINRA's publication date for the cycle, not the settlement date it
describes (the lag is ~1–2 weeks; using settlement date is lookahead).

- [x] Fetch + cache cycles; events `short_interest_report` with score = days-to-cover, and
      derived `short_interest_spike` (change vs prior cycle above a constant threshold).
- [x] Evaluate spikes as events; evaluate levels as a filter (does high short interest
      predict weaker post-event returns for *other* signals? — this is a payload filter on
      existing evaluations, not new machinery).
- [x] Record verdicts.

**Verdict (2026-07-19)**: `no_signal` across the board; keep the data, drop it as a trigger.
Ingested 204 cycles (2018-01 through 2026-06, first published consolidated file is Dec 2017;
`available_ts` = settlement + 8 weekdays EOD, one weekday above FINRA's stated 7-business-day
dissemination lag to absorb holidays without a calendar table) for 176,307 events in the
952-ticker universe. Spike constants: change ≥ 50% vs prior cycle, prior position > 0,
days-to-cover ≥ 2 (FINRA floors DTC at 1). Registry ids 6–8, all with the standard $5 /
$5M universe, seed 1: spikes N=1,479 (t=0.80, +0.05% net at 8d) — no_signal; pooled reports
N=130,613 (t=-3.50 at 63d, -0.40% net; DTC terciles get slightly worse with level:
-0.06%/-0.07%/-0.10% at 21d, not monotonic-flagged) — no_signal long, mild confirmation of
the underperformance literature; DTC ≥ 10 filter N=6,134 (t=1.86, +0.08% at 7d) — no_signal.
The cross-signal interaction test ("do high-SI names drag other signals?") is not expressible
as a payload filter on another kind's events — it needs a cross-source join; if ever wanted,
the practical route is the `SignalOperand` last-score filter in strategies, which works today
with these kinds. Multiple-testing counter: +3.

## 5. 13F institutional holdings

**What / why**: quarterly long-position snapshots of large managers, filed up to 45 days
after quarter end. Well picked-over; plausible remnants are crowding measures and new-stake
initiations by high-conviction managers. Expectation: weak. Ranked last for a reason —
implement only if the appetite survives sources 1–4.

**Data**: EDGAR 13F filings; DERA also publishes structured quarterly datasets.

**`available_ts`**: EDGAR acceptance datetime of the filing (holdings are already ~45 days
stale at that moment — the staleness is the point of the test).

- [x] Ingest a curated manager list (constant, not tunable) rather than all filers.
      (`backend/src/services/sec13f/`: 17 CIKs verified against EDGAR on 2026-07-20 —
      concentrated fundamental managers with long histories (Berkshire, Baupost, Pershing
      Square, both Appaloosa entities, Third Point, Greenlight, Lone Pine, Viking, Tiger
      Global, ValueAct, Icahn, Duquesne, Coatue, Scion, both Elliott entities). Discovery via
      `data.sec.gov` submissions JSON incl. older pages; infotable XML resolved from each
      accession's `index.json` (largest non-primary `.xml`, case-insensitive — one 2026
      Viking filing ships `*.XML`). Quarter-unit resumable via `event_ingestions` (source
      `sec_13f`), quarters close at period end + 90 days; cache under
      `backend/data/raw/sec13f/{manifests,infotables,ftd}/`. `npm run ingest -- 13f`.)
- [x] Events: `inst_new_stake` / `inst_exit`, score = position size vs portfolio.
      (Consecutive-quarter holdings diff per manager; first XML-diffable quarter is 2013q3.
      Score = position value / filing's long-equity book (put/call and PRN rows excluded, so
      units cancel across EDGAR's 2023-01-03 thousands→dollars switch, normalized in payload
      anyway). `available_ts` = EDGAR acceptance datetime; `event_ts` = period end EOD.
      Amendments are counted, never diffed (they blend information timing); entity
      migrations and filing gaps produce no events (diff requires exactly-adjacent periods).
      CUSIP→ticker via SEC fails-to-deliver files (one per quarter, latest-file-wins on the
      8-char issue; pre-2017-07 files live under the legacy FOIA URL). Backfill 2013q3–2026q1:
      6,420 events (3,278 new stakes, 3,142 exits) on the candle universe, sane per-year
      counts with the 2020 turnover spike visible; only 17 unmapped-CUSIP rows total.
      Offline fixtures in `backend/test/thirteenF{Ingest,Parse}.test.ts`.)
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
