import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { backendRoot, getSettings } from "../src/config.ts";
import { createDb, openDatabase } from "../src/db.ts";
import { syncYahooCandles, type SyncResult } from "../src/services/candles.ts";
import { parseTimeframe } from "../src/timeframes.ts";
import { YahooFinanceClient } from "../src/yahooClient.ts";
import { isExcludedTicker, normalizeTicker } from "./tickerExclusions.ts";

const hourMs = 60 * 60 * 1000;
const dayMs = 24 * hourMs;

// Yahoo rejects 1h requests whose start is more than 730 days back (HTTP 422).
const maxHourlyLookbackDays = 727;
const defaultDailyLookbackDays = 10 * 365 + 3;
const defaultDelayMs = 1000;

interface Options {
  universePath: string;
  delayMs: number;
  passIntervalMs: number;
  once: boolean;
  skipExisting: boolean;
  dailyStartMs: number;
  limit: number | null;
}

function usage(exitCode = 1): never {
  console.error(
    [
      "Usage: npm run backfill [-- options]",
      "",
      "Options:",
      "  --universe=<path>       Ticker list file (default: scripts/universe.txt)",
      "  --delay=<ms>            Pause between tickers that hit Yahoo (default: 1000)",
      "  --pass-interval=<min>   Sleep between full passes (default: 60)",
      "  --once                  Run a single pass and exit",
      "  --skip-existing         Skip tickers that already have any candle rows (default)",
      "  --refresh-existing      Also fetch missing ranges for existing tickers",
      "  --daily-start=<date>    Earliest date for 1d history (default: 10 years back)",
      "  --limit=<n>             Only process the first n tickers (for testing)",
    ].join("\n"),
  );
  process.exit(exitCode);
}

function parseOptions(args: string[]): Options {
  const options: Options = {
    universePath: resolve(backendRoot, "scripts/universe.txt"),
    delayMs: defaultDelayMs,
    passIntervalMs: 60 * 60 * 1000,
    once: process.env.npm_config_once === "true",
    skipExisting: process.env.npm_config_refresh_existing !== "true",
    dailyStartMs: Date.now() - defaultDailyLookbackDays * dayMs,
    limit: null,
  };

  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      usage(0);
    } else if (arg === "--once") {
      options.once = true;
    } else if (arg === "--skip-existing") {
      options.skipExisting = true;
    } else if (arg === "--refresh-existing") {
      options.skipExisting = false;
    } else if (arg.startsWith("--universe=")) {
      options.universePath = resolve(backendRoot, arg.slice("--universe=".length));
    } else if (arg.startsWith("--delay=")) {
      options.delayMs = Number(arg.slice("--delay=".length));
    } else if (arg.startsWith("--pass-interval=")) {
      options.passIntervalMs = Number(arg.slice("--pass-interval=".length)) * 60 * 1000;
    } else if (arg.startsWith("--daily-start=")) {
      options.dailyStartMs = Date.parse(`${arg.slice("--daily-start=".length)}T00:00:00Z`);
    } else if (arg.startsWith("--limit=")) {
      options.limit = Number(arg.slice("--limit=".length));
    } else {
      console.error(`Unknown option: ${arg}\n`);
      usage();
    }
  }

  if (
    !Number.isFinite(options.delayMs) ||
    !Number.isFinite(options.passIntervalMs) ||
    !Number.isFinite(options.dailyStartMs) ||
    (options.limit !== null && !Number.isFinite(options.limit))
  ) {
    usage();
  }

  return options;
}

function loadUniverse(path: string, limit: number | null): string[] {
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  const tickers: string[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    const raw = line.split("#")[0].trim();
    if (!raw) {
      continue;
    }
    const ticker = normalizeTicker(raw);
    if (isExcludedTicker(ticker)) {
      continue;
    }
    if (!seen.has(ticker)) {
      seen.add(ticker);
      tickers.push(ticker);
    }
  }

  return limit === null ? tickers : tickers.slice(0, limit);
}

let stopRequested = false;

function installSignalHandlers(): void {
  const onSignal = (signal: string) => {
    if (stopRequested) {
      console.log(`\nSecond ${signal} received, exiting immediately.`);
      process.exit(130);
    }
    stopRequested = true;
    console.log(`\n${signal} received - finishing the current ticker, then exiting.`);
    console.log("Press Ctrl+C again to exit immediately.");
  };
  process.on("SIGINT", () => onSignal("SIGINT"));
  process.on("SIGTERM", () => onSignal("SIGTERM"));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => {
    const timer = setInterval(() => {
      if (stopRequested) {
        clearInterval(timer);
        clearTimeout(timeout);
        resolvePromise();
      }
    }, 250);
    const timeout = setTimeout(() => {
      clearInterval(timer);
      resolvePromise();
    }, ms);
  });
}

const retryDelaysMs = [5_000, 20_000, 60_000];

async function syncWithRetry(
  label: string,
  run: () => Promise<SyncResult>,
): Promise<SyncResult | null> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Hard client errors (unknown ticker, bad range) won't succeed on retry.
      const permanent = /HTTP 4\d\d/.test(message) && !message.includes("HTTP 429");
      if (permanent || attempt >= retryDelaysMs.length || stopRequested) {
        console.log(`    ${label}: FAILED after ${attempt + 1} attempts: ${message}`);
        return null;
      }
      const backoff = retryDelaysMs[attempt];
      console.log(`    ${label}: ${message} - retrying in ${backoff / 1000}s`);
      await sleep(backoff);
    }
  }
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const settings = getSettings();
  const db = openDatabase(settings.databaseUrl);
  db.exec("PRAGMA busy_timeout = 10000");
  createDb(db);

  const yahooClient = new YahooFinanceClient(settings.yahooBaseUrl);
  const daily = parseTimeframe("1d");
  const hourly = parseTimeframe("1h");
  const findExistingTicker = db.prepare(
    "SELECT 1 FROM candles WHERE ticker = ? LIMIT 1",
  );

  installSignalHandlers();

  const tickers = loadUniverse(options.universePath, options.limit);
  console.log(`Loaded ${tickers.length} tickers from ${options.universePath}`);
  console.log(`Daily history from ${new Date(options.dailyStartMs).toISOString().slice(0, 10)}, hourly from the last ${maxHourlyLookbackDays} days.`);
  if (options.skipExisting) {
    console.log("Existing ticker mode: skip immediately.");
  } else {
    console.log("Existing ticker mode: fetch missing ranges.");
  }
  console.log("Press Ctrl+C to stop after the current ticker.\n");

  for (let pass = 1; !stopRequested; pass += 1) {
    const passStarted = Date.now();
    const failures: string[] = [];
    let inserted = 0;
    let requestsMade = 0;
    let skippedExisting = 0;

    console.log(`=== Pass ${pass} started at ${new Date().toISOString()} ===`);

    for (let index = 0; index < tickers.length && !stopRequested; index += 1) {
      const ticker = tickers[index];
      const prefix = `[${index + 1}/${tickers.length}] ${ticker}`;

      if (options.skipExisting && findExistingTicker.get(ticker) !== undefined) {
        skippedExisting += 1;
        console.log(`${prefix}: skipped existing`);
        continue;
      }

      const now = Date.now();
      // Only sync fully closed candles so partial bars never get baked into
      // coverage: dailies through end of yesterday (UTC), hourlies through the
      // last hour that is guaranteed complete.
      const dailyEndMs = now - (now % dayMs) - 1;
      const hourlyEndMs = now - (now % hourMs) - hourMs - 1;
      const hourlyStartMs = now - maxHourlyLookbackDays * dayMs;

      const dailyResult = await syncWithRetry(`${prefix} 1d`, () =>
        syncYahooCandles({
          db,
          yahooClient,
          ticker,
          timeframe: daily,
          startMs: options.dailyStartMs,
          endMs: dailyEndMs,
          adjusted: true,
        }),
      );
      if (stopRequested) {
        break;
      }
      const hourlyResult = await syncWithRetry(`${prefix} 1h`, () =>
        syncYahooCandles({
          db,
          yahooClient,
          ticker,
          timeframe: hourly,
          startMs: hourlyStartMs,
          endMs: hourlyEndMs,
          adjusted: true,
        }),
      );

      if (dailyResult === null || hourlyResult === null) {
        failures.push(ticker);
      }

      const fetched =
        (dailyResult?.fetched_ranges ?? 0) + (hourlyResult?.fetched_ranges ?? 0);
      const insertedNow =
        (dailyResult?.candles_inserted ?? 0) + (hourlyResult?.candles_inserted ?? 0);
      inserted += insertedNow;
      requestsMade += fetched;

      if (fetched > 0) {
        console.log(
          `${prefix}: +${insertedNow} candles ` +
            `(1d: ${dailyResult?.candles_inserted ?? "err"}, 1h: ${hourlyResult?.candles_inserted ?? "err"}, ${fetched} requests)`,
        );
        // Only throttle when we actually hit Yahoo; fully covered tickers are free.
        if (!stopRequested) {
          await sleep(options.delayMs);
        }
      }
    }

    const seconds = Math.round((Date.now() - passStarted) / 1000);
    console.log(
      `=== Pass ${pass} done in ${seconds}s: ${inserted} candles inserted, ${requestsMade} Yahoo requests, ${skippedExisting} existing skipped, ${failures.length} failures ===`,
    );
    if (failures.length > 0) {
      console.log(`Failed tickers: ${failures.join(", ")}`);
    }

    if (options.once || stopRequested) {
      break;
    }
    console.log(`Sleeping ${Math.round(options.passIntervalMs / 60000)} minutes until the next pass...\n`);
    await sleep(options.passIntervalMs);
  }

  db.close();
  console.log("Backfill stopped. Bye.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
