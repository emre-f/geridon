import { createHash } from "node:crypto";

import { pruneDisabledConditions } from "../signals.ts";
import type { Strategy, StrategyCondition } from "../../types.ts";

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value != null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortKeys(child)]),
    );
  }
  return value;
}

function canonicalSide(condition: StrategyCondition | undefined): unknown {
  if (!condition) {
    return null;
  }
  return sortKeys(pruneDisabledConditions(condition));
}

export function canonicalStrategyJson(strategy: Strategy): string {
  return JSON.stringify({
    entry: canonicalSide(strategy.entry),
    exit: canonicalSide(strategy.exit),
    cash: canonicalSide(strategy.cash),
  });
}

export function strategyHash(strategy: Strategy): string {
  return createHash("sha256").update(canonicalStrategyJson(strategy)).digest("hex");
}
