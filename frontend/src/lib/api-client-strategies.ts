import { fetchJson } from "@/lib/api-client";
import type {
  StrategyCondition,
  StrategyDraft,
  StrategyRecord,
  StrategySignal,
  StrategyValidationResult,
} from "@/lib/api-types";

function generateNodeId() {
  return `node-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// The backend stores conditions without ids, so attach fresh ones on load to
// give the rule builder stable React keys.
function withNodeIds(condition: StrategyCondition): StrategyCondition {
  if (condition.type === "group") {
    return {
      ...condition,
      id: generateNodeId(),
      conditions: condition.conditions.map(withNodeIds),
    };
  }
  return { ...condition, id: generateNodeId() };
}

export function withRecordNodeIds(record: StrategyRecord): StrategyRecord {
  return {
    ...record,
    entry: withNodeIds(record.entry),
    exit: withNodeIds(record.exit),
    ...(record.cash ? { cash: withNodeIds(record.cash) } : {}),
  };
}

export async function listStrategies() {
  const records = await fetchJson<StrategyRecord[]>("/api/v1/strategies");
  return records.map(withRecordNodeIds);
}

export async function createStrategy(draft: StrategyDraft) {
  const record = await fetchJson<StrategyRecord>("/api/v1/strategies", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(draft),
  });
  return withRecordNodeIds(record);
}

export async function updateStrategy(id: number, draft: StrategyDraft) {
  const record = await fetchJson<StrategyRecord>(`/api/v1/strategies/${id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(draft),
  });
  return withRecordNodeIds(record);
}

export function deleteStrategy(id: number) {
  return fetchJson<{ id: number; deleted: boolean }>(`/api/v1/strategies/${id}`, {
    method: "DELETE",
  });
}

export function validateStrategy(draft: StrategyDraft) {
  return fetchJson<StrategyValidationResult>("/api/v1/strategies/validate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(draft),
  });
}

export function generateSignals(options: {
  ticker: string;
  timeframe: string;
  startMs: number;
  endMs: number;
  strategy: StrategyDraft;
}) {
  return fetchJson<{ signals: StrategySignal[] }>("/api/v1/signals", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ticker: options.ticker,
      timeframe: options.timeframe,
      start_ms: options.startMs,
      end_ms: options.endMs,
      strategy: options.strategy,
    }),
  });
}
