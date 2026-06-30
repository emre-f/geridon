# Geridon Backend

Node/TypeScript backend for storing stock candles in SQLite, syncing aggregate bars from Polygon/Yahoo Finance, and serving candles to a frontend.

## Setup

```bash
cd backend
cp .env.example .env
```

Set `POLYGON_API_KEY` in your environment or `.env` loader of choice if you sync from Polygon.
The app automatically loads `backend/.env` when it starts.

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

## Current Yahoo Backfill

The local SQLite database was backfilled from Yahoo Finance for `SPY` plus Mag7:

```text
SPY, AAPL, MSFT, NVDA, AMZN, GOOGL, META, TSLA
```

Daily candles were fetched as far back as Yahoo had usable history for each symbol, ending at the latest completed market session available during the run, `2026-06-26`.

| Ticker | Daily range | Daily candles |
| --- | --- | ---: |
| SPY | 1993-01-29 to 2026-06-26 | 8409 |
| AAPL | 1993-01-04 to 2026-06-26 | 8428 |
| MSFT | 1993-01-04 to 2026-06-26 | 8428 |
| NVDA | 1999-01-22 to 2026-06-26 | 6899 |
| AMZN | 1997-05-15 to 2026-06-26 | 7324 |
| GOOGL | 2004-08-19 to 2026-06-26 | 5498 |
| META | 2012-05-18 to 2026-06-26 | 3546 |
| TSLA | 2010-06-29 to 2026-06-26 | 4023 |

Hourly Yahoo candles were fetched for the recent intraday window:

```text
2026-04-29 13:30:00 UTC to 2026-06-26 20:00:00 UTC
```

Each of the eight symbols has `288` hourly candles in that range.

Yahoo daily history is much deeper than Yahoo hourly history. Daily candles can go back decades, while Yahoo's `1h` interval usually returns only a recent rolling intraday window. Use Polygon if deeper documented hourly history is required.

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
