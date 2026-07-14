import { createHash } from "node:crypto";

import { pruneDisabledConditions } from "../signals.ts";
import type { Strategy, StrategyCondition, TrialSizing } from "../../types.ts";

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

/**
 * Dedup hash for one candidate. Sizing joins the strategy tree in the hash so
 * two candidates that differ only in sampled buy/sell percent stay distinct;
 * without sizing this is exactly strategyHash.
 */
export function candidateHash(strategy: Strategy, sizing?: TrialSizing): string {
  const hash = createHash("sha256").update(canonicalStrategyJson(strategy));
  if (sizing && (sizing.buyPercent != null || sizing.sellPercent != null)) {
    hash.update(`|sizing:${sizing.buyPercent ?? ""},${sizing.sellPercent ?? ""}`);
  }
  return hash.digest("hex");
}
