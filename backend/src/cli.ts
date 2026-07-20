import { getSettings } from "./config.ts";
import { createDb, openDatabase, type Database } from "./db.ts";
import { parseDatetimeMs } from "./datetime.ts";
import { PolygonClient } from "./polygonClient.ts";
import { syncPolygonCandles, syncYahooCandles } from "./services/candles.ts";
import { runIngestCongress } from "./services/congress/congressIngestCommand.ts";
import { runIngestEarnings } from "./services/earnings/earningsIngestCommand.ts";
import { getEventCoverage } from "./services/eventStore.ts";
import { runIngestShortInterest } from "./services/finra/shortInterestIngestCommand.ts";
import { runFetchEightK } from "./services/sec/eightKFetchCommand.ts";
import { runLabelEightKCommand } from "./services/sec/eightKLabelCommand.ts";
import { deriveInsiderClusterBuys } from "./services/sec/form4Clusters.ts";
import { runIngestThirteenF } from "./services/sec13f/thirteenFIngestCommand.ts";
import { ingestForm4, type Form4QuarterSummary } from "./services/sec/form4Ingest.ts";
import { emptySkipCounts, type Form4SkipCounts } from "./services/sec/form4Normalize.ts";
import { parseTimeframe } from "./timeframes.ts";
import type { EventKind } from "./types/events.ts";
import { YahooFinanceClient } from "./yahooClient.ts";

const firstDeraYear = 2006;
const form4Kinds: EventKind[] = ["insider_buy", "insider_sell", "insider_cluster_buy"];

function usage(): never {
  throw new Error(
    [
      "Usage:",
      "  npm run sync -- <ticker> <start> <end> [--source=polygon|yahoo] [--timeframe=1h] [--adjusted=true|false]",
      "  npm run ingest -- form4 [--from=2006] [--to=now]",
      "  npm run ingest -- earnings [--from=2008] [--to=now]",
      "  npm run ingest -- short-interest [--from=2018] [--to=now]",
      "  npm run ingest -- congress [--from=2012] [--to=now]",
      "  npm run ingest -- 13f [--from=2013] [--to=now]",
      "  npm run ingest -- 8k [--from=2016] [--to=now] [--tickers=AAPL,MSFT]",
      "  npm run label -- 8k <--limit=100|--all> [--items=2.02,5.02|all] [--model=gpt-5.5] [--concurrency=4]",
    ].join("\n"),
  );
}

function optionValue(args: string[], prefix: string, fallback: string): string {
  const option = args.find((arg) => arg.startsWith(prefix));
  return option ? option.slice(prefix.length) : fallback;
}

async function runSync(args: string[]): Promise<void> {
  const [ticker, start, end, ...rest] = args;
  if (!ticker || !start || !end) {
    usage();
  }

  const settings = getSettings();
  const source = optionValue(rest, "--source=", "polygon");
  if (source !== "polygon" && source !== "yahoo") {
    throw new Error("source must be polygon or yahoo.");
  }
  if (source === "polygon" && !settings.polygonApiKey) {
    throw new Error("POLYGON_API_KEY is not configured.");
  }

  const db = openDatabase(settings.databaseUrl);
  createDb(db);

  const syncOptions = {
    db,
    ticker: ticker.toUpperCase(),
    timeframe: parseTimeframe(optionValue(rest, "--timeframe=", "1h")),
    startMs: parseDatetimeMs(start),
    endMs: parseDatetimeMs(end),
    adjusted: optionValue(rest, "--adjusted=", "true") !== "false",
  };

  const result =
    source === "polygon"
      ? await syncPolygonCandles({
          ...syncOptions,
          polygonClient: new PolygonClient(settings.polygonApiKey!, settings.polygonBaseUrl),
        })
      : await syncYahooCandles({
          ...syncOptions,
          yahooClient: new YahooFinanceClient(settings.yahooBaseUrl),
        });

  console.log(result);
}

function parseYear(raw: string, nowYear: number): number {
  if (raw === "now") {
    return nowYear;
  }
  const year = Number(raw);
  if (!Number.isInteger(year) || year < firstDeraYear || year > nowYear) {
    throw new Error(`Invalid year "${raw}" (expected ${firstDeraYear}..${nowYear} or "now").`);
  }
  return year;
}

async function runIngestForm4(args: string[]): Promise<void> {
  const settings = getSettings();
  if (!settings.secUserAgent) {
    throw new Error(
      "SEC_USER_AGENT is not configured. SEC requires a declared contact on every request; " +
        'set it in backend/.env, e.g. SEC_USER_AGENT="geridon/0.1 you@example.com".',
    );
  }

  const nowYear = new Date().getUTCFullYear();
  const fromYear = parseYear(optionValue(args, "--from=", String(firstDeraYear)), nowYear);
  const toYear = parseYear(optionValue(args, "--to=", "now"), nowYear);
  if (fromYear > toYear) {
    throw new Error("--from must not be after --to.");
  }

  const db = openDatabase(settings.databaseUrl);
  createDb(db);

  const summaries = await ingestForm4({
    db,
    fromYear,
    toYear,
    userAgent: settings.secUserAgent,
    onProgress: (message) => console.log(message),
  });

  if (summaries.some((summary) => summary.status === "completed")) {
    const clusters = deriveInsiderClusterBuys(db);
    console.log(
      `clusters: ${clusters.clusters_inserted} insider_cluster_buy events rebuilt ` +
        `from ${clusters.buys_considered} buys`,
    );
  } else {
    console.log("clusters: no new quarters ingested, derivation skipped");
  }

  printIngestReport(db, summaries);
}

function printIngestReport(db: Database, summaries: Form4QuarterSummary[]): void {
  const completed = summaries.filter((summary) => summary.status === "completed");
  const alreadyIngested = summaries.filter((s) => s.status === "already_ingested").length;
  const unpublished = summaries.filter((s) => s.status === "unpublished").length;

  let inserted = 0;
  let duplicates = 0;
  let unknownRows = 0;
  const unknownTickers = new Set<string>();
  const skips = emptySkipCounts();
  for (const summary of completed) {
    inserted += summary.inserted;
    duplicates += summary.duplicates;
    unknownRows += summary.unknown_ticker_rows;
    for (const ticker of summary.unknown_tickers) {
      unknownTickers.add(ticker);
    }
    for (const reason of Object.keys(skips) as Array<keyof Form4SkipCounts>) {
      skips[reason] += summary.skips[reason];
    }
  }

  console.log(
    `\nQuarters: ${completed.length} ingested, ${alreadyIngested} already ingested, ` +
      `${unpublished} unpublished`,
  );
  console.log(`Events: ${inserted} inserted, ${duplicates} duplicates`);
  const skipParts = Object.entries(skips).map(([reason, count]) => `${reason}=${count}`);
  console.log(
    `Skipped rows: unknown_ticker=${unknownRows} (${unknownTickers.size} distinct tickers), ` +
      skipParts.join(", "),
  );

  const byYear = new Map<number, Partial<Record<EventKind, number>>>();
  for (const row of getEventCoverage(db)) {
    const kinds = byYear.get(row.year) ?? {};
    kinds[row.event_kind] = row.events;
    byYear.set(row.year, kinds);
  }
  console.log("\nEvents per year:");
  for (const [year, kinds] of [...byYear.entries()].sort((left, right) => left[0] - right[0])) {
    const parts = form4Kinds.map((kind) => `${kind}=${kinds[kind] ?? 0}`);
    console.log(`  ${year}  ${parts.join("  ")}`);
  }
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "sync") {
    return runSync(rest);
  }
  if (command === "ingest" && rest[0] === "form4") {
    return runIngestForm4(rest.slice(1));
  }
  if (command === "ingest" && rest[0] === "earnings") {
    return runIngestEarnings(rest.slice(1));
  }
  if (command === "ingest" && rest[0] === "short-interest") {
    return runIngestShortInterest(rest.slice(1));
  }
  if (command === "ingest" && rest[0] === "congress") {
    return runIngestCongress(rest.slice(1));
  }
  if (command === "ingest" && rest[0] === "13f") {
    return runIngestThirteenF(rest.slice(1));
  }
  if (command === "ingest" && rest[0] === "8k") {
    return runFetchEightK(rest.slice(1));
  }
  if (command === "label" && rest[0] === "8k") {
    return runLabelEightKCommand(rest.slice(1));
  }
  usage();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
