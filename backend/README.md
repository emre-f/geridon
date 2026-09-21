# Geridon Backend

Node/TypeScript backend for storing stock candles in SQLite, syncing aggregate bars from Polygon/Yahoo Finance, and serving candles to a frontend.

## Setup

Requires Node 22.5 or later.

```bash
cd backend
npm install
cp .env.example .env
```

The app automatically loads `backend/.env` when it starts. All values are optional for the basic flow:

| variable | needed for |
| --- | --- |
| `SEC_USER_AGENT` | SEC ingests (`form4`, `13f`, `8k`). SEC requires a contact, e.g. `"geridon/0.1 you@example.com"` |
| `POLYGON_API_KEY` | syncing from Polygon only. Yahoo needs no key |
| `GERIDON_DATABASE_URL` | custom database path (default `backend/data/geridon.sqlite3`) |
| `PORT` | API port (default `8000`) |

## Commands

| command | what it does |
| --- | --- |
| `npm run dev` | start the API with reload on file changes |
| `npm start` | start the API without reload |
| `npm test` | run the test suite |
| `npm run backfill` | fill candles for the whole ticker universe via Yahoo. Add `-- --once` for a single pass |
| `npm run universe` | regenerate `scripts/universe.txt` (top 1000 US stocks by market cap) |
| `npm run sync -- <ticker> <start> <end>` | sync candles for one ticker. Options: `--source=polygon\|yahoo`, `--timeframe=1h` |
| `npm run ingest -- <source>` | load event data for the Signals tab (see below) |
| `npm run label -- 8k ...` | label 8-K filings with a language model (optional, see below) |
| `npm run calibrate -- 8k ...` | grade a labeler against the gold set (optional, see below) |
| `npm run bench` | optimization benchmark. Results in [bench/RESULTS.md](bench/RESULTS.md) |

Run `npm run ingest` with no arguments to print the full usage text.

## Ingesting event data for Signals

Each source accepts `--from=<year>` and `--to=<year|now>`. Runs are safe to repeat.

| command | events | needs |
| --- | --- | --- |
| `npm run ingest -- form4` | insider buys, sells, and cluster buys (from 2006) | `SEC_USER_AGENT` |
| `npm run ingest -- earnings` | earnings dates and surprises (from 2008) | nothing |
| `npm run ingest -- short-interest` | FINRA short interest (from 2018) | nothing |
| `npm run ingest -- congress` | Senate eFD trade disclosures (from 2012) | nothing |
| `npm run ingest -- 13f` | new institutional stakes (from 2013) | `SEC_USER_AGENT` |
| `npm run ingest -- 8k` | raw 8-K filings (from 2016). Option: `--tickers=AAPL,MSFT` | `SEC_USER_AGENT` |
| `npm run ingest -- 8k-events` | events from labeled 8-K filings | labels from `npm run label` |
| `npm run ingest -- 8k-guidance` | guidance raises and cuts from labeled 8-K filings | labels from `npm run label` |

Please respect the terms and rate limits of each data source.

**A fresh clone has no candle data** — the SQLite database (`backend/data/`) is gitignored and created empty. Backfill it first:

```bash
npm run backfill -- --once   # ~120 large caps from scripts/universe.txt, 1d + 1h via Yahoo
```

See [scripts/README.md](scripts/README.md) for the full top-1000 universe and continuous mode.

## Run

```bash
npm run dev
```

The default database path is `backend/data/geridon.sqlite3`.

This backend targets Node 22 and uses Node's built-in TypeScript stripping and SQLite module, so no runtime npm dependencies are required.

## Test

```bash
npm test
```

## API

Sync hourly Polygon candles into SQLite:

```bash
curl -X POST http://127.0.0.1:8000/api/v1/candles/sync \
  -H "content-type: application/json" \
  -d '{"source":"polygon","ticker":"AAPL","start":"2024-01-01","end":"2024-03-01","timeframe":"1h"}'
```

Sync Yahoo Finance candles into the same candle shape:

```bash
curl -X POST http://127.0.0.1:8000/api/v1/candles/sync \
  -H "content-type: application/json" \
  -d '{"source":"yahoo","ticker":"SPY","start":"2024-01-01","end":"2024-03-01","timeframe":"1h"}'
```

Yahoo sync supports `1h` and `1d`. Use `1d` for long "get everything" backfills and `1h` for recent intraday history:

```bash
npm run sync -- SPY 1993-01-01 2026-06-28 --source=yahoo --timeframe=1d
npm run sync -- SPY 2026-04-29 2026-06-28 --source=yahoo --timeframe=1h
```

## Backfilling data

`npm run backfill` fills the database for a whole ticker universe via Yahoo (1d back 10 years by default, 1h back 730 days — Yahoo's hard cap for hourly). Yahoo beats Polygon's free tier for both timeframes: same 2-year intraday depth, no 5-requests/minute limit. Details in [scripts/README.md](scripts/README.md).

Read stored candles:

```bash
curl "http://127.0.0.1:8000/api/v1/candles/AAPL?start=2024-01-01&end=2024-03-01&timeframe=1h"
```

Aggregate stored hourly candles on the fly:

```bash
curl "http://127.0.0.1:8000/api/v1/candles/AAPL?start=2024-01-01&end=2024-03-01&timeframe=4h"
curl "http://127.0.0.1:8000/api/v1/candles/AAPL?start=2024-01-01&end=2024-03-01&timeframe=1d"
```

## 8-K event labeling & grading

The pipeline reads SEC Form 8-K filings and asks a language model to emit one
structured label per material event (guidance, buyback, exec departure), scored
so we know how far to trust it before it runs over thousands of filings.

**How a model is called.** Labeling is one model call per filing: the filing
text goes in, one JSON object matching a fixed schema comes back. The model is
pluggable through the `--model` flag, and the backend picks the transport from
the model name:

- **OpenAI (`gpt-*`)** runs through the **Codex CLI** (`codex exec`), sandboxed
  read-only in a scratch directory with `--output-schema` enforcing the shape.
  This is the default (`gpt-5.6-sol`) and needs the `codex` CLI on your PATH.
- **Claude (`sonnet-5`, `opus-4.8`, `fable-5`)** runs through the **Claude Code
  CLI** (`claude -p`), using your logged-in CLI session. It needs the `claude`
  CLI on your PATH; pass `--model=sonnet-5`. The same prompt and schema are
  used, so a Claude label is directly comparable to a gpt one.

This step is optional. Everything outside the 8-K event kinds works without a
language model.

Every label is stored beside its filing under a version key of
`model-effort-hash(prompt)`, so different models, efforts, or prompt wordings
never overwrite each other and no evaluation can mix them by accident.

```bash
npm run label -- 8k --calibration                      # label the 100-filing calibration set
npm run label -- 8k --calibration --model=sonnet-5     # same set, a different grader
npm run label -- 8k --all                              # bulk run (only after calibration passes)
```

**Grading against a gold set.** A labeler earns the right to run in bulk by
clearing an accuracy bar on a frozen, hand-checked sample:

```bash
npm run calibrate -- 8k sample     # freeze the 100-filing sample (once)
npm run calibrate -- 8k draft      # write text cards for a human to review into a gold file
npm run calibrate -- 8k score      # score a labeler version's labels against the gold file
```

**Comparing two labelers.** With two models labeled over the same sample, diff
them directly — no gold file needed — to see where they agree and which filings
are worth a human's attention:

```bash
npm run label -- 8k compare --a=gpt-5.6-sol --b=sonnet-5
```

## Data Safety

- `candles` has a unique index on `(ticker, multiplier, timespan, timestamp_ms)`.
- `fetch_ranges` records successfully synced source ranges per provider.
- Sync requests fetch only gaps not already covered by successful fetch ranges.
- If a range overlaps anyway, inserts are idempotent and existing candles are skipped.
- Yahoo rows store `vwap` and `transactions` as `null` because that endpoint does not provide them.
