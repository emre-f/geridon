import type { Database } from "../db.ts";
import { catalogByKind } from "../services/indicatorCatalog.ts";
import { compileSearchSpace } from "../services/optimization/searchSpace.ts";
import { describeRuleLabel } from "../services/optimization/ruleLabels.ts";
import {
  collectRules,
  describeRule,
  getAtPath,
  pathId,
} from "../services/optimization/strategyPaths.ts";
import type {
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

/**
 * Compiles the default search space for a saved strategy so the experiment
 * form can offer per-parameter and per-rule controls before anything is
 * created. Read-only; roles and overrides are applied at experiment creation.
 */
export function handleGetSearchSpacePreview(
  db: Database,
  strategyIdRaw: string | null,
): ApiResult {
  const strategyId = Number(strategyIdRaw);
  if (!Number.isInteger(strategyId) || strategyId <= 0) {
    return badRequest("strategy_id must be a positive integer.");
  }
  const row = db
    .prepare("SELECT definition FROM strategies WHERE id = ?")
    .get(strategyId) as { definition: string } | undefined;
  if (!row) {
    return { statusCode: 404, body: { detail: `Strategy ${strategyId} was not found.` } };
  }
  const strategy = JSON.parse(String(row.definition)) as Strategy;
  const { nodes } = compileSearchSpace({ strategy });

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
  };
  return { statusCode: 200, body };
}
