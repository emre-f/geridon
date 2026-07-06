# Geridon Backend

Node/TypeScript backend for storing stock candles in SQLite, syncing aggregate bars from Polygon/Yahoo Finance, and serving candles to a frontend.

## Setup

```bash
cd backend
cp .env.example .env
```

Set `POLYGON_API_KEY` in your environment or `.env` loader of choice if you sync from Polygon.
The app automatically loads `backend/.env` when it starts.

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

## Data Safety

- `candles` has a unique index on `(ticker, multiplier, timespan, timestamp_ms)`.
- `fetch_ranges` records successfully synced source ranges per provider.
- Sync requests fetch only gaps not already covered by successful fetch ranges.
- If a range overlaps anyway, inserts are idempotent and existing candles are skipped.
- Yahoo rows store `vwap` and `transactions` as `null` because that endpoint does not provide them.
