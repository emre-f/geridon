import type { Database } from "../db.ts";
import { validateStrategy } from "../services/strategies.ts";
import type { Strategy, StrategyRecord, StrategyValidationResponse } from "../types.ts";
import { badRequest, parsePositiveId, type ApiResult } from "./shared.ts";

function strategyRowToResponse(row: Record<string, unknown>): StrategyRecord {
  const definition = JSON.parse(String(row.definition)) as Strategy;
  return {
    id: Number(row.id),
    name: String(row.name),
    entry: definition.entry,
    exit: definition.exit,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export function handleListStrategies(db: Database) {
  const rows = db.prepare("SELECT * FROM strategies ORDER BY name ASC, id ASC").all();
  return { statusCode: 200, body: rows.map(strategyRowToResponse) };
}

export function handleValidateStrategy(body: unknown): ApiResult<StrategyValidationResponse> {
  const { strategy, errors } = validateStrategy(body);
  return { statusCode: 200, body: { valid: errors.length === 0, errors, strategy } };
}

export function handleCreateStrategy(db: Database, body: unknown) {
  const { strategy, errors } = validateStrategy(body);
  if (!strategy) {
    return {
      statusCode: 400,
      body: { detail: errors[0]?.message ?? "Invalid strategy.", errors },
    };
  }

  const result = db
    .prepare("INSERT INTO strategies (name, definition) VALUES (?, ?)")
    .run(strategy.name, JSON.stringify(strategy));
  const row = db
    .prepare("SELECT * FROM strategies WHERE id = ?")
    .get(Number(result.lastInsertRowid))!;
  return { statusCode: 201, body: strategyRowToResponse(row) };
}

export function handleUpdateStrategy(db: Database, idPath: string, body: unknown) {
  const id = parsePositiveId(idPath);
  if (id == null) {
    return badRequest("Strategy id must be a positive integer.");
  }
  if (!db.prepare("SELECT 1 FROM strategies WHERE id = ?").get(id)) {
    return { statusCode: 404, body: { detail: `Strategy ${id} was not found.` } };
  }

  const { strategy, errors } = validateStrategy(body);
  if (!strategy) {
    return {
      statusCode: 400,
      body: { detail: errors[0]?.message ?? "Invalid strategy.", errors },
    };
  }

  db.prepare(
    "UPDATE strategies SET name = ?, definition = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
  ).run(strategy.name, JSON.stringify(strategy), id);
  const row = db.prepare("SELECT * FROM strategies WHERE id = ?").get(id)!;
  return { statusCode: 200, body: strategyRowToResponse(row) };
}

export function handleDeleteStrategy(db: Database, idPath: string) {
  const id = parsePositiveId(idPath);
  if (id == null) {
    return badRequest("Strategy id must be a positive integer.");
  }

  const changes = Number(db.prepare("DELETE FROM strategies WHERE id = ?").run(id).changes);
  if (changes === 0) {
    return { statusCode: 404, body: { detail: `Strategy ${id} was not found.` } };
  }
  return { statusCode: 200, body: { id, deleted: true } };
}
