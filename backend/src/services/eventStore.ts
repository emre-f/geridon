import type { Database } from "../db.ts";
import type { EventKind, EventRecord } from "../types/events.ts";

export interface EventInsertSummary {
  inserted: number;
  duplicates: number;
  unknown_ticker_rows: number;
  unknown_tickers: string[];
}

export interface EventQuery {
  kind?: EventKind;
  kinds?: readonly EventKind[];
  ticker?: string;
  startMs?: number;
  endMs?: number;
}

export interface EventCoverageRow {
  event_kind: EventKind;
  year: number;
  events: number;
}

function normalizeTicker(ticker: string): string {
  return ticker.toUpperCase().trim();
}

export function getKnownTickers(db: Database): Set<string> {
  const rows = db.prepare("SELECT DISTINCT ticker FROM candles").all();
  return new Set(rows.map((row) => normalizeTicker(String(row.ticker))));
}

export function insertEvents(
  db: Database,
  records: readonly EventRecord[],
  options: { knownTickers?: Set<string> } = {},
): EventInsertSummary {
  const violations = records.filter(
    (record) => record.available_ts_ms < record.event_ts_ms,
  );
  if (violations.length > 0) {
    const keys = violations.map((record) => record.dedupe_key).join(", ");
    throw new Error(
      `Point-in-time violation: available_ts_ms < event_ts_ms for ${violations.length} event(s): ${keys}`,
    );
  }

  const knownTickers = options.knownTickers ?? getKnownTickers(db);
  const insertRow = db.prepare(`
    INSERT OR IGNORE INTO events
      (source, ticker, event_kind, event_ts_ms, available_ts_ms, score, payload, dedupe_key)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const summary: EventInsertSummary = {
    inserted: 0,
    duplicates: 0,
    unknown_ticker_rows: 0,
    unknown_tickers: [],
  };
  const unknown = new Set<string>();

  db.exec("BEGIN");
  try {
    for (const record of records) {
      const ticker = normalizeTicker(record.ticker);
      if (!knownTickers.has(ticker)) {
        summary.unknown_ticker_rows += 1;
        unknown.add(ticker);
        continue;
      }
      const result = insertRow.run(
        record.source,
        ticker,
        record.event_kind,
        record.event_ts_ms,
        record.available_ts_ms,
        record.score,
        JSON.stringify(record.payload),
        record.dedupe_key,
      );
      if (Number(result.changes) > 0) {
        summary.inserted += 1;
      } else {
        summary.duplicates += 1;
      }
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  summary.unknown_tickers = [...unknown].sort();
  return summary;
}

export function getEvents(db: Database, query: EventQuery = {}): EventRecord[] {
  const conditions: string[] = [];
  const parameters: Array<string | number> = [];

  const kinds = query.kinds ?? (query.kind != null ? [query.kind] : null);
  if (kinds != null) {
    conditions.push(`event_kind IN (${kinds.map(() => "?").join(", ")})`);
    parameters.push(...kinds);
  }
  if (query.ticker != null) {
    conditions.push("ticker = ?");
    parameters.push(normalizeTicker(query.ticker));
  }
  if (query.startMs != null) {
    conditions.push("available_ts_ms >= ?");
    parameters.push(query.startMs);
  }
  if (query.endMs != null) {
    conditions.push("available_ts_ms <= ?");
    parameters.push(query.endMs);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = db
    .prepare(`
      SELECT id, source, ticker, event_kind, event_ts_ms, available_ts_ms,
             score, payload, dedupe_key, created_at
      FROM events
      ${where}
      ORDER BY available_ts_ms, id
    `)
    .all(...parameters);

  return rows.map((row) => ({
    id: Number(row.id),
    source: String(row.source) as EventRecord["source"],
    ticker: String(row.ticker),
    event_kind: String(row.event_kind) as EventKind,
    event_ts_ms: Number(row.event_ts_ms),
    available_ts_ms: Number(row.available_ts_ms),
    score: row.score == null ? null : Number(row.score),
    payload: JSON.parse(String(row.payload)),
    dedupe_key: String(row.dedupe_key),
    created_at: String(row.created_at),
  }));
}

export function getEventCoverage(db: Database): EventCoverageRow[] {
  const rows = db
    .prepare(`
      SELECT event_kind,
             CAST(strftime('%Y', available_ts_ms / 1000, 'unixepoch') AS INTEGER) AS year,
             COUNT(*) AS events
      FROM events
      GROUP BY event_kind, year
      ORDER BY event_kind, year
    `)
    .all();

  return rows.map((row) => ({
    event_kind: String(row.event_kind) as EventKind,
    year: Number(row.year),
    events: Number(row.events),
  }));
}
