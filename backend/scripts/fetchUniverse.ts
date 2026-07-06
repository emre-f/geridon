import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { backendRoot } from "../src/config.ts";
import { isExcludedTicker, isNonChartableSecurityName, normalizeTicker } from "./tickerExclusions.ts";

interface Options {
  count: number;
  outPath: string;
}

function parseOptions(args: string[]): Options {
  const options: Options = {
    count: 1000,
    outPath: resolve(backendRoot, "scripts/universe.txt"),
  };

  for (const arg of args) {
    if (arg.startsWith("--count=")) {
      options.count = Number(arg.slice("--count=".length));
    } else if (arg.startsWith("--out=")) {
      options.outPath = resolve(backendRoot, arg.slice("--out=".length));
    } else {
      console.error(`Unknown option: ${arg}`);
      console.error("Usage: npm run universe [-- --count=1000 --out=scripts/universe.txt]");
      process.exit(1);
    }
  }

  if (!Number.isFinite(options.count) || options.count < 1) {
    throw new Error("--count must be a positive number.");
  }
  return options;
}

interface NasdaqRow {
  symbol?: string;
  name?: string;
  marketCap?: string;
}

interface NasdaqPayload {
  data?: {
    rows?: NasdaqRow[];
  };
}

async function fetchFromNasdaqScreener(count: number): Promise<string[]> {
  const url =
    "https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=25&download=true";
  const response = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
      accept: "application/json",
    },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    throw new Error(`Nasdaq screener request failed with HTTP ${response.status}.`);
  }

  const payload = (await response.json()) as NasdaqPayload;
  const rows = payload.data?.rows ?? [];
  if (rows.length === 0) {
    throw new Error("Nasdaq screener returned no rows.");
  }

  const ranked = rows
    .map((row) => ({
      symbol: normalizeTicker(row.symbol ?? ""),
      name: row.name ?? "",
      marketCap: Number((row.marketCap ?? "").replace(/[$,]/g, "")),
    }))
    .filter(
      (row) =>
        row.symbol.length > 0 &&
        // Skip indices/warrants/units style symbols.
        !row.symbol.includes("^") &&
        !isExcludedTicker(row.symbol) &&
        !isNonChartableSecurityName(row.name) &&
        Number.isFinite(row.marketCap) &&
        row.marketCap > 0,
    )
    .sort((a, b) => b.marketCap - a.marketCap);

  const seen = new Set<string>();
  const symbols: string[] = [];
  for (const row of ranked) {
    if (!seen.has(row.symbol)) {
      seen.add(row.symbol);
      symbols.push(row.symbol);
    }
    if (symbols.length >= count) {
      break;
    }
  }
  return symbols;
}

async function fetchSp500Fallback(): Promise<string[]> {
  const url =
    "https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv";
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) {
    throw new Error(`S&P 500 constituents request failed with HTTP ${response.status}.`);
  }

  const csv = await response.text();
  const lines = csv.split(/\r?\n/);
  const header = lines[0]?.split(",") ?? [];
  const symbolIndex = header.findIndex((column) => column.trim().toLowerCase() === "symbol");
  if (symbolIndex === -1) {
    throw new Error("Could not find Symbol column in constituents CSV.");
  }

  const symbols: string[] = [];
  for (const line of lines.slice(1)) {
    const symbol = normalizeTicker(line.split(",")[symbolIndex] ?? "");
    if (symbol && !isExcludedTicker(symbol)) {
      symbols.push(symbol);
    }
  }
  if (symbols.length === 0) {
    throw new Error("Constituents CSV contained no symbols.");
  }
  return symbols;
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));

  let symbols: string[];
  let source: string;
  try {
    symbols = await fetchFromNasdaqScreener(options.count);
    source = "Nasdaq screener (sorted by market cap)";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Nasdaq screener failed (${message}); falling back to S&P 500 list.`);
    symbols = await fetchSp500Fallback();
    source = "S&P 500 constituents (datasets/s-and-p-500-companies)";
  }

  const header = [
    `# ${symbols.length} tickers from ${source}`,
    `# Generated ${new Date().toISOString()} by npm run universe`,
    "# One ticker per line; lines starting with # are ignored.",
    "# ETFs worth tracking alongside single names:",
    "SPY",
    "QQQ",
    "",
  ];
  writeFileSync(options.outPath, header.join("\n") + symbols.join("\n") + "\n");
  console.log(`Wrote ${symbols.length + 2} tickers to ${options.outPath} (${source}).`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
