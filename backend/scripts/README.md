# Backfill scripts

Long-running candle backfill for the largest US stocks. Run it while your PC is
on; stop it any time with `Ctrl+C` (it finishes the ticker in flight, then exits
cleanly — press `Ctrl+C` twice to force-quit).

## What it does

`backfill.ts` walks a ticker universe file and, for each ticker, syncs via the
existing backend sync service (same code path as `POST /api/v1/candles/sync`):

- **1d candles from Yahoo** — back to `--daily-start` (default: 10 years ago;
  Yahoo can serve decades if you pass an earlier date).
- **1h candles from Yahoo** — the last **727 days**. Yahoo hard-rejects 1h
  requests starting more than 730 days back (HTTP 422), so this is the maximum.

It writes straight to the SQLite database (WAL mode, safe to run while the API
server is up). By default, tickers that already have candle rows are skipped
immediately. Pass `--refresh-existing` to fetch missing ranges for existing
tickers.

Only fully closed candles are requested (dailies through end of yesterday UTC,
hourlies with a one-hour safety lag), so partial bars never get frozen into
the coverage map.

After each pass the script sleeps (`--pass-interval`, default 60 minutes) and
runs again — leave it running and it keeps the tail fresh. Failures (rate
limits, unknown tickers) are retried 3 times with backoff, then logged and
skipped; the pass summary lists every failed ticker.

## Why Yahoo for both timeframes

Verified empirically (July 2026):

| provider        | 1d depth              | 1h depth              | speed |
|-----------------|-----------------------|-----------------------|-------|
| Yahoo           | decades (full history) | 730 days, 1 request   | no hard limit, be polite |
| Polygon (free)  | 2 years               | 2 years               | 5 requests/min, ~3 months of 1h bars per page |

Polygon's free tier clips **all** data to 2 years back (older ranges return
`403 NOT_AUTHORIZED`), so it has no depth advantage over Yahoo for 1h. Worse,
at 5 req/min with ~8 paginated requests per ticker, a 1000-ticker 1h backfill
would take **~27 hours** vs **~30–60 minutes** via Yahoo. Polygon only becomes
interesting on a paid plan (5+ years of intraday, vwap/transaction counts).

## How to run

Everything runs from `backend/`:

```bash
# 1. (Optional) Regenerate the universe: top 1000 US stocks by market cap,
#    pulled from the Nasdaq screener (falls back to the S&P 500 list).
#    A ~120-ticker starter list is already committed at scripts/universe.txt.
npm run universe                 # default: top 1000
npm run universe -- --count=500  # smaller universe

# 2. Smoke-test on a few tickers first:
npm run backfill -- --once --limit=5

# 3. Full run — leave it going, Ctrl+C to stop:
npm run backfill
```

### Options

```
--universe=<path>       Ticker list file (default: scripts/universe.txt)
--delay=<ms>            Pause between tickers that hit Yahoo (default: 1000)
--pass-interval=<min>   Sleep between full passes (default: 60)
--once                  Single pass, then exit
--skip-existing         Skip tickers that already have any candle rows (default)
--refresh-existing      Also fetch missing ranges for existing tickers
--daily-start=<date>    Earliest 1d date (default: 10 years back)
--limit=<n>             Only the first n tickers (testing)
```

### What to expect on the first full pass

Daily history is chunked into 5-year requests (3 per ticker for 10 years) and
the 727-day hourly window into 180-day requests (5 per ticker), so roughly
**8 Yahoo requests per ticker**. With the default 1s delay, 1000 tickers take
around 1.5–3 hours. If you see repeated `HTTP 429` / "Too Many
Requests" retries, bump `--delay` to 4000–5000. Tickers that IPO'd recently
just return empty chunks for the early years — harmless.

The universe file supports `#` comments, and symbols are normalized to
Yahoo's dash notation (`BRK.B`/`BRK/B` → `BRK-B`).


## Notes / known limitations

- `src/polygonClient.ts` does not follow Polygon's `next_url` pagination. On
  the free tier a single response only carries ~3 months of hourly bars, so a
  180-day chunk would be silently truncated. Irrelevant while backfilling via
  Yahoo, but fix it before doing any serious Polygon syncing.
- Candles are unique on `(ticker, multiplier, timespan, timestamp_ms)`
  regardless of source, with `INSERT OR IGNORE` — mixing Yahoo/Polygon later
  is safe; whichever wrote a timestamp first wins.
- Delisted or renamed tickers fail with a Yahoo "not found" error; they are
  reported at the end of the pass and never block the run.
