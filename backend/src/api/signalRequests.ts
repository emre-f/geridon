import { isEventKind } from "../types/events.ts";
import { defaultSignalCosts } from "../services/signalEval/evaluate.ts";
import type {
  EventSelectionOptions,
  UniverseFilters,
} from "../services/signalEval/eventSelection.ts";
import type { SignalJobRequest } from "../services/signalEval/evaluationJobStore.ts";
import type { PromotionOptions } from "../services/signalEval/promotion.ts";
import { parseTradeCosts } from "./shared.ts";

const maxBootstrapIterations = 2_000;
const defaultSignalSeed = 1;

type Parsed<T> = { value: T } | { error: string };

export function parseEvaluationRequest(raw: unknown): Parsed<SignalJobRequest> {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return { error: "Request body must be a JSON object." };
  }
  const body = raw as Record<string, unknown>;

  const query = parseEventQuery(body);
  if ("error" in query) {
    return query;
  }
  const settings = parseComputeSettings(body);
  if ("error" in settings) {
    return settings;
  }

  const seed = body.seed ?? defaultSignalSeed;
  if (typeof seed !== "number" || !Number.isInteger(seed) || seed < 0) {
    return { error: "seed must be a non-negative integer." };
  }

  return { value: { query: query.value, seed, ...settings.value } };
}

export function parseHoldoutRequest(
  evaluationId: number,
  raw: unknown,
): Parsed<SignalJobRequest> {
  if (raw != null && (typeof raw !== "object" || Array.isArray(raw))) {
    return { error: "Request body must be a JSON object." };
  }
  const settings = parseComputeSettings((raw ?? {}) as Record<string, unknown>);
  if ("error" in settings) {
    return settings;
  }
  return { value: { evaluation_id: evaluationId, ...settings.value } };
}

export function parsePromotionRequest(raw: unknown): Parsed<PromotionOptions> {
  if (raw == null) {
    return { value: {} };
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { error: "Request body must be a JSON object." };
  }
  const body = raw as Record<string, unknown>;
  const options: PromotionOptions = {};

  if (body.name != null) {
    if (typeof body.name !== "string" || body.name.trim().length === 0) {
      return { error: "name must be a non-empty string." };
    }
    options.name = body.name.trim();
  }

  if (body.trend_filter != null) {
    if (typeof body.trend_filter !== "boolean") {
      return { error: "trend_filter must be a boolean." };
    }
    options.trendFilter = body.trend_filter;
  }

  return { value: options };
}

export function parseEventQuery(body: Record<string, unknown>): Parsed<EventSelectionOptions> {
  if (typeof body.kind !== "string" || !isEventKind(body.kind)) {
    return { error: "kind must be a known event kind." };
  }
  const query: EventSelectionOptions = { kind: body.kind };

  if (body.min_score != null) {
    if (typeof body.min_score !== "number" || !Number.isFinite(body.min_score)) {
      return { error: "min_score must be a finite number." };
    }
    query.minScore = body.min_score;
  }

  if (body.payload_filters != null) {
    if (typeof body.payload_filters !== "object" || Array.isArray(body.payload_filters)) {
      return { error: "payload_filters must be an object of numeric minimums." };
    }
    const filters: Record<string, number> = {};
    for (const [field, threshold] of Object.entries(body.payload_filters)) {
      if (typeof threshold !== "number" || !Number.isFinite(threshold)) {
        return { error: `payload_filters.${field} must be a finite number.` };
      }
      filters[field] = threshold;
    }
    if (Object.keys(filters).length > 0) {
      query.payloadFilters = filters;
    }
  }

  const universe = parseUniverse(body.universe);
  if ("error" in universe) {
    return universe;
  }
  if (universe.value != null) {
    query.universe = universe.value;
  }

  for (const field of ["start_ms", "end_ms"] as const) {
    const value = body[field];
    if (value == null) {
      continue;
    }
    if (typeof value !== "number" || !Number.isInteger(value)) {
      return { error: `${field} must be an integer millisecond timestamp.` };
    }
    if (field === "start_ms") {
      query.startMs = value;
    } else {
      query.endMs = value;
    }
  }
  if (query.startMs != null && query.endMs != null && query.startMs > query.endMs) {
    return { error: "start_ms must not be after end_ms." };
  }

  return { value: query };
}

function parseUniverse(raw: unknown): Parsed<UniverseFilters | null> {
  if (raw == null) {
    return { value: null };
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { error: "universe must be an object." };
  }
  const body = raw as Record<string, unknown>;
  const universe: UniverseFilters = {};
  const fields = [
    ["min_price", "minPrice"],
    ["min_median_dollar_volume", "minMedianDollarVolume"],
  ] as const;
  for (const [field, key] of fields) {
    const value = body[field];
    if (value == null) {
      continue;
    }
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      return { error: `universe.${field} must be a non-negative number.` };
    }
    universe[key] = value;
  }
  return { value: Object.keys(universe).length > 0 ? universe : null };
}

function parseComputeSettings(
  body: Record<string, unknown>,
): Parsed<Pick<SignalJobRequest, "costs" | "notional_per_event" | "bootstrap_iterations">> {
  const settings: Pick<SignalJobRequest, "costs" | "notional_per_event" | "bootstrap_iterations"> = {
    costs: { ...defaultSignalCosts },
  };
  if (body.costs != null) {
    const costs = parseTradeCosts(body.costs);
    if ("error" in costs) {
      return { error: costs.error };
    }
    settings.costs = costs.costs;
  }

  if (body.notional_per_event != null) {
    const notional = body.notional_per_event;
    if (typeof notional !== "number" || !Number.isFinite(notional) || notional <= 0) {
      return { error: "notional_per_event must be a positive number." };
    }
    settings.notional_per_event = notional;
  }

  if (body.bootstrap_iterations != null) {
    const iterations = body.bootstrap_iterations;
    if (
      typeof iterations !== "number" ||
      !Number.isInteger(iterations) ||
      iterations < 1 ||
      iterations > maxBootstrapIterations
    ) {
      return {
        error: `bootstrap_iterations must be an integer between 1 and ${maxBootstrapIterations}.`,
      };
    }
    settings.bootstrap_iterations = iterations;
  }

  return { value: settings };
}
