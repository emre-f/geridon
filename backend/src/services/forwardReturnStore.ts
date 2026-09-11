import type { Database } from "../db.ts";
import {
  computeForwardReturns,
  labelVersion,
  type CloseBar,
  type ForwardReturnRow,
} from "./forwardReturns.ts";

function normalizeTicker(ticker: string): string {
  return ticker.toUpperCase().trim();
}

export function storeForwardReturns(
  db: Database,
  ticker: string,
  rows: ForwardReturnRow[],
): number {
  const normalized = normalizeTicker(ticker);
  const deleteRows = db.prepare("DELETE FROM forward_returns WHERE ticker = ?");
  const insertRow = db.prepare(`
    INSERT INTO forward_returns (
      ticker, label_version, timestamp_ms, horizon, raw, market_adjusted, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `);

  db.exec("BEGIN");
  try {
    deleteRows.run(normalized);
    for (const row of rows) {
      insertRow.run(
        normalized,
        labelVersion,
        row.timestamp_ms,
        row.horizon,
        row.raw,
        row.market_adjusted,
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return rows.length;
}

export function computeAndStoreForwardReturns(
  db: Database,
  options: {
    ticker: string;
    bars: CloseBar[];
    marketBars?: CloseBar[];
    horizons?: readonly number[];
  },
): number {
  const rows = computeForwardReturns({
    bars: options.bars,
    marketBars: options.marketBars,
    horizons: options.horizons,
  });
  return storeForwardReturns(db, options.ticker, rows);
}

export function getForwardReturns(
  db: Database,
  options: {
    ticker: string;
    startMs?: number;
    endMs?: number;
    horizons?: readonly number[];
  },
): ForwardReturnRow[] {
  const conditions = ["ticker = ?", "label_version = ?"];
  const parameters: Array<string | number> = [normalizeTicker(options.ticker), labelVersion];

  if (options.startMs != null) {
    conditions.push("timestamp_ms >= ?");
    parameters.push(options.startMs);
  }
  if (options.endMs != null) {
    conditions.push("timestamp_ms <= ?");
    parameters.push(options.endMs);
  }
  if (options.horizons != null) {
    conditions.push(`horizon IN (${options.horizons.map(() => "?").join(", ")})`);
    parameters.push(...options.horizons);
  }

  const rows = db
    .prepare(`
      SELECT timestamp_ms, horizon, raw, market_adjusted
      FROM forward_returns
      WHERE ${conditions.join(" AND ")}
      ORDER BY timestamp_ms, horizon
    `)
    .all(...parameters);

  return rows.map((row) => ({
    timestamp_ms: Number(row.timestamp_ms),
    horizon: Number(row.horizon),
    raw: row.raw == null ? null : Number(row.raw),
    market_adjusted: row.market_adjusted == null ? null : Number(row.market_adjusted),
  }));
}

export interface ForwardReturnCoverage {
  rows: number;
  first_timestamp_ms: number;
  last_timestamp_ms: number;
}

export function getForwardReturnCoverage(
  db: Database,
  ticker: string,
): ForwardReturnCoverage | null {
  const row = db
    .prepare(`
      SELECT COUNT(*) AS rows, MIN(timestamp_ms) AS first_ms, MAX(timestamp_ms) AS last_ms
      FROM forward_returns
      WHERE ticker = ? AND label_version = ?
    `)
    .get(normalizeTicker(ticker), labelVersion);

  if (row == null || Number(row.rows) === 0) {
    return null;
  }
  return {
    rows: Number(row.rows),
    first_timestamp_ms: Number(row.first_ms),
    last_timestamp_ms: Number(row.last_ms),
  };
}
