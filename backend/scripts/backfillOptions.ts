import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { backendRoot } from "../src/config.ts";
import { isExcludedTicker, normalizeTicker } from "./tickerExclusions.ts";

export const hourMs = 60 * 60 * 1000;
export const dayMs = 24 * hourMs;

// Yahoo rejects 1h requests whose start is more than 730 days back (HTTP 422).
export const maxHourlyLookbackDays = 727;

const defaultDailyLookbackDays = 10 * 365 + 3;
const defaultDelayMs = 1000;

export interface Options {
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

export function parseOptions(args: string[]): Options {
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

export function loadUniverse(path: string, limit: number | null): string[] {
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
