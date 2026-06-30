import { getSettings } from "./config.ts";
import { createDb, openDatabase } from "./db.ts";
import { parseDatetimeMs } from "./datetime.ts";
import { PolygonClient } from "./polygonClient.ts";
import { syncPolygonCandles, syncYahooCandles } from "./services/candles.ts";
import { parseTimeframe } from "./timeframes.ts";
import { YahooFinanceClient } from "./yahooClient.ts";

function usage(): never {
  throw new Error(
    "Usage: npm run sync -- <ticker> <start> <end> [--source=polygon|yahoo] [--timeframe=1h] [--adjusted=true|false]",
  );
}

function optionValue(args: string[], prefix: string, fallback: string): string {
  const option = args.find((arg) => arg.startsWith(prefix));
  return option ? option.slice(prefix.length) : fallback;
}

async function main(): Promise<void> {
  const [command, ticker, start, end, ...rest] = process.argv.slice(2);
  if (command !== "sync" || !ticker || !start || !end) {
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

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
