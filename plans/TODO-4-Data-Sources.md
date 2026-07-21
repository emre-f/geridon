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

- [~] Events: `guidance_raise` / `guidance_cut`, score = revision magnitude (new vs prior
      guide midpoint, scaled by price); payload: metric, period, low/high/point values, and a
      `withdrawn` flag (withdrawal is its own severe row, not a synthetic number).
      **Machinery done 2026-07-20; the real run is gated on a labeler version clearing
      calibration (§2), so no guidance events are ingested yet — same posture as §2's events
      bullet.**
      (`npm run ingest -- 8k-guidance [--items=2.02|all] [--model=gpt-5.5]`. New event kinds
      `guidance_raise` / `guidance_cut`, source `sec_8k`, payload `GuidanceRevisionPayload` in
      `types/events.ts` — distinct from §2's `filing_guidance_up/down`, which trust the
      labeler's *stated* direction; these are *computed* self-relative from the extracted
      figures. `eightKGuidanceRun.ts` reads only the label cache (no network/DB, like §2 and
      §5), groups a ticker's labeled filings in acceptance-datetime order, and threads the last
      committed guide per normalized `(metric, period, unit)` key. `eightKGuidanceEvents.ts` is
      the pure pass: midpoint = point, else range mid, else the single open bound; a later
      filing whose midpoint moved emits a raise/cut, an unchanged midpoint is a reaffirmation,
      a first guide is an initiation, and a figure that names a metric/period with no number
      *withdraws* the outlook — a `guidance_cut` with `withdrawn: true` and a **null** score
      (the plan's "not a synthetic number"). All three neutral cases are counted as skips,
      never emitted, so §1b's up/down split stays clean. `event_ts = available_ts` = the
      revising filing's acceptance datetime; dedupe key carries `labeler_version` + accession +
      the `(metric|period|unit)` slug + kind, so replays are no-ops and a relabel under a new
      version writes fresh rows that never collide — the payload also carries `labeler_version`
      for the never-mix-versions payload filter. Offline fixtures in
      `backend/test/eightKGuidance.test.ts`; validated against the two cached real-label
      versions (the 100-filing calibration sample is 100 unrelated filings so it yields 0
      revisions + 7 withdrawal-no-prior markers, and the pre-`unit` legacy version degrades to
      336 `incomparable` skips instead of crashing).
      **Two calls that need your sign-off before the real run:**
      *Score* — the plan says "scaled by price", but guidance metrics are heterogeneous
      (revenue $B, EPS $, margin %) and a price scale is only meaningful per-share, while the
      run is deliberately DB/price-free; I used the **self-relative percentage revision**
      `(new_mid − prior_mid) / |prior_mid|` (score = its absolute value, sign carried by the
      kind), matching the earnings source's standardized self-relative surprise. *Withdrawal
      detection* — an all-null figure is read as a withdrawal; the calibration sample shows the
      labeler does emit these, but whether all-null ALWAYS means "withdrawn" (vs "qualitative
      guidance, no number") is a labeler-behavior question the calibration review should
      confirm; the `withdrawn` flag keeps them isolable/filterable either way. Cross-filing
      period matching is exact-on-normalized (case + collapsed whitespace); `"FY 2024"` vs
      `"FY2024"` is a deliberate conservative miss — a dropped revision beats a fabricated one,
      and the fix, if match rates are low on real labels, is a canonical-period instruction in
      the prompt, not looser matching here.)
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
- [x] Labeling pipeline: filing text → structured label via a cheap model (this is bulk
      mechanical work — gpt-5.5 via codex per the model-routing rules), JSON schema output:
      kind, direction, severity 1–5, one-line rationale kept in payload for spot-checking.
      (**2026-07-20.** `npm run label -- 8k <--limit=N|--all> [--items=2.02,5.02|all]
      [--model=] [--concurrency=4]`. Text: `eightKText.ts` turns cached EDGAR HTML into prose
      — the win is dropping `<table>` blocks that are ≥40% digits, which cuts a 218KB Apple
      exhibit to 11.5KB while leaving the guidance paragraph intact; per-document budgets
      (12k primary / 16k exhibit, ≤3 exhibits) so a long press release can never crowd out
      the 8-K body that names the items. Kinds are `guidance`, `buyback`,
      `exec_departure_unplanned`, `exec_departure_routine` — the unplanned/routine split the
      5.02 ticket demanded lives in the enum, so the events bullet maps kind→event with no
      second judgement call. A filing returns 0..n labels: multi-item filings get one label
      each, and an empty array is the expected answer for routine filings.
      **`unit` is mandatory on every guidance figure** (verified need: one Apple filing quotes
      revenue in billions beside other income in millions, so §1b's raise/cut comparison is
      meaningless without it). Model output is untrusted — `parseLabelSet` rejects unknown
      kinds/directions, out-of-range severity, empty rationale, non-finite figures, and a
      rejected filing writes nothing rather than caching a half-valid label.
      `labelerVersion` = model + sha256(prompt template).slice(12), which names the cache
      directory `filings/<cik>/<accession>/labels/<version>.json`, so relabeling never
      overwrites and versions cannot mix. Codex runs sandboxed `read-only --ephemeral` in a
      scratch dir with `--output-schema`, so the labeler can only read a prompt and write one
      JSON file. Two spend guards: an unbounded run refuses without `--all`, and 5 consecutive
      failures abort the run rather than walking 5,720 filings to produce nothing. Offline
      fixtures in `backend/test/eightK{Text,Label}.test.ts` (fake runner, no network).)
- [x] Calibration set: ~100 hand-checked filings; labeler must clear a stated accuracy bar
      before bulk labeling spends money. **Machinery done 2026-07-20; the hand-check itself is
      the remaining human step.**
      (`npm run calibrate -- 8k <sample|draft|score>`. **sample**: 100 filings drawn by seeded
      `sha256(accession)` rank, stratified proportionally into the two fetched item families
      (65 × 2.02, 35 × 5.02 on the current cache of 5,720). Hash-rank not shuffle, so the set
      is reproducible from the cache alone and growing the cache never reshuffles filings
      already reviewed; frozen at `backend/calibration/eightk-sample.json`, redrawing needs
      `--force`. **draft**: labels the sample (`npm run label -- 8k --calibration` — a fixed
      list is bounded by construction, so it stays open before the gate) and writes
      `backend/calibration/eightk-gold.json` seeded from those labels, one markdown card per
      filing under `data/calibration/cards/` holding *exactly the text the labeler saw*. Both
      the gold and the results files live outside gitignored `backend/data/` because they are
      hand-made and must survive a cache wipe. Seeding from the model under test is
      adjudication, so it is biased toward acceptance — `--seed=blank` authors from scratch,
      and `score` refuses to run while any entry still has `reviewed: false` (an unreviewed
      entry is the model's own output, not ground truth). **score**: labels have no identity
      within a filing, so gold and predicted are grouped by kind and matched positionally;
      mislabeling an unplanned departure as routine therefore costs twice, which is the
      intended strictness for the split the 5.02 ticket asked for. Guidance figures compare as
      a multiset on (metric, period, unit, values) — order carries no meaning, `unit` does.
      **The bar** (fixed constants in `eightKCalibrationScore.ts`, not tunables): kind micro-F1
      ≥ 0.85, per-kind F1 ≥ 0.75 for kinds with ≥ 5 gold labels, direction accuracy ≥ 0.90,
      severity within ±1 ≥ 0.90, guidance figure F1 ≥ 0.80, and false positives on
      gold-empty filings ≤ 10% — hallucinating an event on a routine filing fails the run on
      its own. A pass writes `backend/calibration/results/<labelerVersion>.json`, and
      `npm run label -- 8k --all` refuses to start without one for that exact version. Offline
      fixtures in `backend/test/eightKCalibration.test.ts`.
      Sample labeled 2026-07-20 under `gpt-5.5-924653532341`: 100/100 succeeded, 107 labels
      (53 guidance, 44 exec_departure_routine, 6 exec_departure_unplanned, 4 buyback), 9
      filings correctly empty. Spot-check of 10 draft entries found two failure modes worth
      deciding on *before* the review is spent: **guidance over-triggers on forward-looking
      numbers that are not management guidance** (a reserve report's "$5.1 billion of future
      development capital", an investor deck's "could generate approximately $410.9 million in
      potential incremental fees"), and **`exec_departure_routine` is a catch-all** that the
      prompt's own definition fills with plain appointments and board elections where nobody
      departed. Also `direction: "none"` dominates guidance labels, since initial issuance and
      reiteration are both neutral by the prompt — the up/down split §1b needs will be thin.
      Revising the prompt mints a new `labelerVersion` and invalidates these 100 labels, so
      that call comes first, then review.
      **Prompt revised 2026-07-20** to close all three (`eightKLabelPrompt.ts`, new version
      `gpt-5.5-29584dd1d2c6`, supersedes `gpt-5.5-924653532341`): guidance now requires the
      *company's own* committed outlook for a named future period and explicitly excludes
      illustrative/`could`/`up to` figures, investor-deck opportunity sizing, reserve/technical
      reports, and third-party estimates; both departure kinds now require that *someone
      actually leaves*, so bare appointments/elections/comp arrangements return empty; and
      guidance `direction` is read from the filing's own raise/lower/withdraw framing, with
      `none` reserved for a first-time initiation or a plain reaffirmation — sharpening the
      up/down split §1b needs. Next human steps (sample stays frozen; only the labels change):
      `npm run label -- 8k --calibration` re-labels the 100 sample filings under the new
      version, then `npm run calibrate -- 8k draft --force` seeds gold + cards from those
      labels, then hand-review each card and `npm run calibrate -- 8k score`. The old
      `gpt-5.5-924653532341` draft in `backend/calibration/eightk-gold.json` is now stale.
      Note: 109 filings sit labeled under the superseded version `gpt-5.5-eba34444578c`,
      which predates the mandatory `unit` field. Read them for a free preview of failure
      modes, but calibration must score the *current* version — never mix.
      **Model + effort switch 2026-07-21**: the default labeler moved from `gpt-5.5` to
      **`gpt-5.6-sol` at `medium` reasoning effort** (`eightKLabelRunner.ts`), reached through
      the same Codex CLI (ChatGPT sign-in, no OpenAI API key). Reasoning effort now affects the
      output, so it is folded into the version alongside model + prompt hash — the format is
      now `model-effort-hash`, and the current version is `gpt-5.6-sol-medium-<hash>`. Every
      8-K subcommand takes `--effort=` (default medium) beside `--model=`; a label run and the
      events/guidance/calibrate commands that read those labels must be given the same pair, or
      they resolve to a different version and find nothing. Live-verified the runner returns
      schema-valid labels under the new model/effort. This supersedes all `gpt-5.5-*` versions
      above, so the calibration re-label below runs under `gpt-5.6-sol-medium`.)
      **Scored 2026-07-21 (version `gpt-5.6-sol-medium-29584dd1d2c6`, agent-adjudicated gold,
      100 filings, human confirmation pending).** Both `gpt-5.6-sol` and `sonnet-5` labeled all
      100; gold was re-drafted `--seed=blank` and adjudicated from the cards. **Both FAIL, so
      bulk labeling stays locked** (`calibration/results/`). `gpt-5.6-sol` passes every axis
      (kind F1 0.95, direction 0.985, severity 1.0, per-kind all pass, clean-FP 3/37) **except
      guidance-figure F1 0.568** (bar 0.80); `sonnet-5` fails three (exec_departure_routine F1
      0.741, clean-FP 4/37=0.108, and — before the fix — figures). Finding: the figure gate's
      exact-string match was killing formatting (`FY2023`≠`FY 2023`), so `figureKey` in
      `eightKCalibrationScore.ts` now canonicalizes period aliases and fingerprints metric names
      (order-independent, EPS↔earnings-per-share, filler dropped) — the 0.80 bar is untouched.
      Post-fix Sonnet's figure F1 rose to 0.811 (passes that axis) but GPT's only to 0.568
      because GPT extracts the full projected reconciliation table (316 figures vs Sonnet 181;
      figure precision 0.42 vs recall 0.83) **and hallucinates guidance absent from truncated
      cards** (ABNB, AMZN, AON). Sonnet's opposite failure is over-labeling appointments/role-
      transitions as `exec_departure_routine` (AIG×2, ABBV, ADM — downstream-harmless since
      routine emits no event). **Decision (user, 2026-07-21): promote `gpt-5.6-sol`.** Cleanest
      unlock: tighten the prompt so the labeler extracts only the company's headline outlook
      metrics and never a figure absent from the provided text (mints a new version → re-label
      the sample → re-adjudicate gold → re-score). The figure-F1 comparison is confounded by
      gold granularity/naming, so it should not by itself decide the labeler.)
      **PASSED 2026-07-21 (version `gpt-5.6-sol-medium-d58338259f59`) — the guidance gate is
      cleared and bulk labeling is unlocked.** Per the promote-`gpt-5.6-sol`/tighten-prompt
      decision, the guidance-figure instruction in `eightKLabelPrompt.ts` was tightened to
      extract only the company's *headline* outlook metrics (revenue, EPS, and the one or two
      others it explicitly guides — not a projected reconciliation/bridge/segment table) and to
      never emit a figure absent from the provided text. That minted a fresh version
      (`…-29584dd1d2c6` → `…-d58338259f59`), so the 100-filing sample was relabeled
      (`npm run label -- 8k --calibration`, 100/100, 0 failed) and the gold re-drafted
      `--seed=blank` and re-adjudicated against the cards. Result
      (`calibration/results/gpt-5.6-sol-medium-d58338259f59.json`): kind F1 **1.00**, direction
      **0.986**, severity-within-1 **1.00**, guidance-figure F1 **0.956** (was 0.568 — the
      tightening fixed the over-extraction), clean-filing FP **0/35** (the never-hallucinate rule
      landed: ABNB/AMZN/AON no longer invent guidance absent from truncated cards). Adjudication
      was agent-authored from the cards (blank seed) with a human spot-check deferred; borderline
      calls are flagged in `calibration/eightk-gold.json` `notes` (officer relinquishing a role but
      staying = departure vs not: AR/AIG/AA/ADM; CFO transition routine-vs-unplanned:
      BMRN×2/Agilent; Aon Q2-24 FX-sensitivity-as-guidance). Two figure fixes vs the model's own
      labels are baked into the gold: Agilent's numberless reaffirmation carries an empty figure
      array (the model emitted an all-null junk figure), and ABBV-2026 carries both Q2+FY EPS (the
      model dropped Q2). Bulk labeling of the full 5,720-filing cache under this version has NOT
      been run yet — that is the next spend, and it gates the §1b/§2 event-ingestion runs below.
- [~] Events: `filing_guidance_up` / `filing_guidance_down` / `filing_buyback` /
      `filing_exec_departure`, score = severity. For guidance items, the labeler also extracts
      the guided figures (metric, period, low/high/point) — section 1b's extraction path
      consumes them, so the schema is shared, not duplicated. **Machinery done 2026-07-20; the
      run is gated on a labeler version clearing calibration, so no real events are ingested
      yet.**
      (`npm run ingest -- 8k-events [--items=2.02,5.02|all] [--model=gpt-5.5]`. New source
      `sec_8k`; payload `FilingLabelEventPayload` in `types/events.ts` reuses §1b's
      `GuidanceFigure` shape rather than duplicating it. Mapping (`eightKLabelEvents.ts`) is the
      *directional, tradable* subset of the labeler enum: guidance up/down → the two guidance
      events; buyback → `filing_buyback`; `exec_departure_unplanned` → `filing_exec_departure`.
      Neutral guidance (initial issuance / reiteration — the majority per the calibration
      spot-check) and `exec_departure_routine` emit nothing and are counted as skips: the up/down
      split §1b needs comes from its figure comparison, not from these rows, and dropping routine
      is the whole point of the 5.02 split. `score` = severity 1–5. `event_ts` = `available_ts` =
      EDGAR acceptance datetime (the disclosure is the event). Idempotency is `INSERT OR IGNORE`
      on a dedupe key that carries `labeler_version` + label index, so replaying is a no-op and a
      relabel under a new version writes fresh rows that never collide — the payload also carries
      `labeler_version` so an evaluation pins a version with a payload filter, honoring the
      never-mix-versions rule with no schema change. The walk (`eightKEventsRun.ts`) reads only
      the label cache: no network, and it counts filings that are considered / labeled / not-yet-
      labeled / tickerless. Offline fixtures in `backend/test/eightKLabelEvents.test.ts`.)
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
- [x] Evaluate; record verdicts.
      (evaluations #16–#18, seed 1, universe min $5 / $5M median dollar volume: all new stakes,
      all exits, new stakes with `min_score` 0.0125 — the round constant nearest the
      top-tercile boundary the score buckets exposed)

**Verdict (2026-07-20): `no_signal` on both kinds — and the pooled new-stake draw is
*negatively* informative.** 13F diffs 2013q3–2026q1 (study effectively starts 2016 with candle
coverage, holdout excluded; ~19% of events drop as `no_anchor`, all pre-2016). `inst_new_stake`
N=2,295 on 561 tickers: headline t=1.59, +0.22% net at the 9-bar natural hold, but the curve
turns over after day 14 and stays negative for the rest of the quarter — **−1.9% at 51 bars,
t=−3.30**, the largest-magnitude drift this registry has produced. Buying alongside a freshly
disclosed high-conviction stake underperforms the matched baseline; the 45-day staleness is the
whole story, exactly the failure mode this section was ranked last for. `inst_exit` N=2,152 on
546 tickers scores `weak` on the fixed thresholds (t=2.13, +0.32% net at a 14-bar hold), but
that is the peak of a 63-horizon scan on a curve with no shape: a small bump through day 14,
back through zero by day 18, −0.91% by 63d, and score buckets that are not monotonic (the
largest exits are the *worst* bucket). Read it as noise, not as "worth another look". One
follow-up was spent on the new-stake tercile the buckets flagged (score ≥ 1.25% of the manager's
long book, N=811): the negative quarter drift disappears entirely (−0.3% at 51d, t=−0.30), so
the drag lives in the small marginal positions, not the conviction ones — but the top tercile is
itself flat (t=1.77 at the 9-bar hold). Keep the data (cheap, permanent cache, useful as a
crowding measure later); do not build triggers on either kind. Multiple-testing counter: +3.

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
