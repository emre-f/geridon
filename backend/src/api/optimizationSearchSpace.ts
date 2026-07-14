import type { Database } from "../db.ts";
import { catalogByKind } from "../services/indicatorCatalog.ts";
import {
  compileSearchSpace,
  sizingHardBounds,
  sizingNodeIds,
  sizingSearchNodes,
} from "../services/optimization/searchSpace.ts";
import { describeRuleLabel } from "../services/optimization/ruleLabels.ts";
import {
  collectAtLeastGroups,
  collectRules,
  describeRule,
  getAtPath,
  pathId,
} from "../services/optimization/strategyPaths.ts";
import type {
  BacktestPositionMode,
  IndicatorOperand,
  SearchSpaceNode,
  SearchSpacePreview,
  Strategy,
} from "../types.ts";
import { badRequest, type ApiResult } from "./shared.ts";

function hardBounds(strategy: Strategy, node: SearchSpaceNode) {
  const parametersIndex = node.path.indexOf("parameters");
  if (parametersIndex === -1) {
    return { hard_min: null, hard_max: null };
  }
  const operand = getAtPath(strategy, node.path.slice(0, parametersIndex)) as
    | IndicatorOperand
    | undefined;
  const definition =
    operand && catalogByKind.get(operand.kind)?.parameters.find((p) => p.key === node.path.at(-1));
  return definition
    ? { hard_min: definition.min, hard_max: definition.max }
    : { hard_min: null, hard_max: null };
}

const positionModes: BacktestPositionMode[] = ["long_only", "always_in", "three_state"];

function parseSizingContext(
  searchParams: URLSearchParams,
): { positionMode: BacktestPositionMode; buyPercent: number; sellPercent: number } | string {
  const positionMode = (searchParams.get("position_mode") ?? "long_only") as BacktestPositionMode;
  if (!positionModes.includes(positionMode)) {
    return "position_mode must be long_only, always_in, or three_state.";
  }
  const percents = { buyPercent: 100, sellPercent: 100 };
  for (const [key, param] of [
    ["buyPercent", "buy_percent"],
    ["sellPercent", "sell_percent"],
  ] as const) {
    const raw = searchParams.get(param);
    if (raw == null) {
      continue;
    }
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0 || value > 100) {
      return `${param} must be greater than 0 and at most 100.`;
    }
    percents[key] = value;
  }
  return { positionMode, ...percents };
}

/**
 * Compiles the default search space for a saved strategy so the experiment
 * form can offer per-parameter and per-rule controls before anything is
 * created. Read-only; roles and overrides are applied at experiment creation.
 */
export function handleGetSearchSpacePreview(
  db: Database,
  searchParams: URLSearchParams,
): ApiResult {
  const strategyId = Number(searchParams.get("strategy_id"));
  if (!Number.isInteger(strategyId) || strategyId <= 0) {
    return badRequest("strategy_id must be a positive integer.");
  }
  const sizingContext = parseSizingContext(searchParams);
  if (typeof sizingContext === "string") {
    return badRequest(sizingContext);
  }
  const row = db
    .prepare("SELECT definition FROM strategies WHERE id = ?")
    .get(strategyId) as { definition: string } | undefined;
  if (!row) {
    return { statusCode: 404, body: { detail: `Strategy ${strategyId} was not found.` } };
  }
  const strategy = JSON.parse(String(row.definition)) as Strategy;
  const { nodes } = compileSearchSpace({ strategy });
  const sizingNodes = sizingSearchNodes({
    ...sizingContext,
    parameterOverrides: {
      [sizingNodeIds.buyPercent]: {},
      [sizingNodeIds.sellPercent]: {},
    },
  });

  const body: SearchSpacePreview = {
    strategy_id: strategyId,
    rules: collectRules(strategy).map(({ path, rule }) => ({
      id: pathId(path),
      side: path[0] as "entry" | "exit" | "cash",
      summary: describeRule(rule),
      label: describeRuleLabel(rule),
      enabled: rule.enabled !== false,
    })),
    nodes: nodes.map((node) => ({ ...node, ...hardBounds(strategy, node) })),
    sizing_nodes: sizingNodes.map((node) => ({
      ...node,
      hard_min: sizingHardBounds.min,
      hard_max: sizingHardBounds.max,
    })),
    at_least_groups: collectAtLeastGroups(strategy)
      .filter(({ group }) => group.enabled !== false && group.conditions.length >= 2)
      .map(({ path, group }) => ({
        id: pathId(path),
        size: group.conditions.length,
        count: group.count ?? group.conditions.length,
      })),
  };
  return { statusCode: 200, body };
}
