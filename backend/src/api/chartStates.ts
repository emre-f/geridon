import type { Database } from "../db.ts";
import { badRequest, normalizeTicker, validateTicker } from "./shared.ts";

const maxChartStateBytes = 32_768;

export function handleListChartStates(db: Database) {
  const rows = db.prepare("SELECT ticker, state FROM chart_states").all();
  const body: Record<string, unknown> = {};

  for (const row of rows) {
    try {
      body[String(row.ticker)] = JSON.parse(String(row.state));
    } catch {
      // Skip rows that no longer parse instead of failing the whole listing.
    }
  }

  return { statusCode: 200, body };
}

export function handlePutChartState(db: Database, tickerPath: string, body: unknown) {
  const ticker = normalizeTicker(tickerPath);
  const tickerError = validateTicker(ticker);
  if (tickerError) {
    return badRequest(tickerError);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return badRequest("Chart state must be a JSON object.");
  }

  const serialized = JSON.stringify(body);
  if (serialized.length > maxChartStateBytes) {
    return badRequest(`Chart state must be ${maxChartStateBytes} bytes or fewer.`);
  }

  db.prepare(
    `
    INSERT INTO chart_states (ticker, state) VALUES (?, ?)
    ON CONFLICT(ticker) DO UPDATE SET state = excluded.state, updated_at = CURRENT_TIMESTAMP
  `,
  ).run(ticker, serialized);
  return { statusCode: 200, body: { ticker, saved: true } };
}

export function handleDeleteChartState(db: Database, tickerPath: string) {
  const ticker = normalizeTicker(tickerPath);
  const tickerError = validateTicker(ticker);
  if (tickerError) {
    return badRequest(tickerError);
  }

  const changes = Number(db.prepare("DELETE FROM chart_states WHERE ticker = ?").run(ticker).changes);
  return { statusCode: 200, body: { ticker, deleted: changes > 0 } };
}
