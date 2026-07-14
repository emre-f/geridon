import { canonicalRuleKey } from "./cheapRejection.ts";
import { describeRuleLabel } from "./ruleLabels.ts";
import { collectRules, describeRule, pathId } from "./strategyPaths.ts";
import { isInsertableGroup } from "./evolution.ts";
import type {
  IndicatorKind,
  RuleLibraryInsertionPoint,
  RuleLibraryTemplate,
  RuleLibraryTemplateKind,
  Strategy,
  StrategyCondition,
  StrategyOperand,
  StrategyRule,
} from "../../types.ts";

function indicator(
  kind: IndicatorKind,
  parameters: Record<string, number>,
  output: string,
): StrategyOperand {
  return { type: "indicator", kind, parameters, output };
}

const close: StrategyOperand = { type: "price", field: "close" };
const value = (raw: number): StrategyOperand => ({ type: "value", value: raw });

function rule(
  left: StrategyOperand,
  operator: StrategyRule["operator"],
  right: StrategyOperand,
): StrategyRule {
  return { type: "rule", left, operator, right };
}

function crossPair(
  template: RuleLibraryTemplateKind,
  left: StrategyOperand,
  right: StrategyOperand,
): Array<{ template: RuleLibraryTemplateKind; rule: StrategyRule }> {
  return [
    { template, rule: rule(left, "cross_above", right) },
    { template, rule: rule(left, "cross_below", right) },
  ];
}

/**
 * The curated seed library for Mode C: bounded, catalog-valid single rules
 * from a handful of templates, with a small threshold menu per oscillator.
 * The optimizer may only insert entries the user explicitly approved.
 */
function templateRules(): Array<{ template: RuleLibraryTemplateKind; rule: StrategyRule }> {
  return [
    ...crossPair("trend_cross", indicator("ema", { period: 12 }, "ema"), indicator("ema", { period: 26 }, "ema")),
    ...crossPair("trend_cross", indicator("sma", { period: 20 }, "sma"), indicator("sma", { period: 50 }, "sma")),
    ...crossPair("price_vs_ma", close, indicator("sma", { period: 50 }, "sma")),
    ...crossPair("price_vs_ma", close, indicator("ema", { period: 20 }, "ema")),
    { template: "oscillator_threshold", rule: rule(indicator("rsi", { period: 14 }, "rsi"), "lt", value(30)) },
    { template: "oscillator_threshold", rule: rule(indicator("rsi", { period: 14 }, "rsi"), "gt", value(70)) },
    ...crossPair("oscillator_threshold", indicator("rsi", { period: 14 }, "rsi"), value(50)),
    { template: "oscillator_threshold", rule: rule(indicator("cci", { period: 20 }, "cci"), "gt", value(100)) },
    { template: "oscillator_threshold", rule: rule(indicator("cci", { period: 20 }, "cci"), "lt", value(-100)) },
    { template: "oscillator_threshold", rule: rule(indicator("bbp", { period: 20, stdDev: 2 }, "bbp"), "lt", value(0)) },
    { template: "oscillator_threshold", rule: rule(indicator("bbp", { period: 20, stdDev: 2 }, "bbp"), "gt", value(1)) },
    { template: "oscillator_threshold", rule: rule(indicator("momentum", { period: 10 }, "momentum"), "gt", value(0)) },
    { template: "oscillator_threshold", rule: rule(indicator("momentum", { period: 10 }, "momentum"), "lt", value(0)) },
    { template: "band_touch", rule: rule(close, "cross_below", indicator("bollinger", { period: 20, stdDev: 2 }, "lower")) },
    { template: "band_touch", rule: rule(close, "cross_above", indicator("bollinger", { period: 20, stdDev: 2 }, "upper")) },
    { template: "volume_filter", rule: rule(indicator("rvol", { period: 20 }, "rvol"), "gt", value(1.5)) },
    { template: "volume_filter", rule: rule(indicator("rvol", { period: 20 }, "rvol"), "gt", value(2)) },
  ];
}

/** Seeded templates minus any rule the strategy already contains. */
export function buildRuleLibraryTemplates(strategy: Strategy): RuleLibraryTemplate[] {
  const existing = new Set(collectRules(strategy).map(({ rule: located }) => canonicalRuleKey(located)));
  return templateRules()
    .filter((entry) => !existing.has(canonicalRuleKey(entry.rule)))
    .map((entry) => ({
      template: entry.template,
      summary: describeRule(entry.rule),
      label: describeRuleLabel(entry.rule),
      rule: entry.rule,
    }));
}

/** Every enabled and/or group where the user may allow rule insertion. */
export function collectInsertionPoints(strategy: Strategy): RuleLibraryInsertionPoint[] {
  const points: RuleLibraryInsertionPoint[] = [];
  const visit = (condition: StrategyCondition, path: string[]) => {
    if (condition.type === "rule") {
      return;
    }
    const id = pathId(path);
    if (isInsertableGroup(strategy, id)) {
      points.push({
        id,
        side: path[0] as "entry" | "exit" | "cash",
        operator: condition.operator as "and" | "or",
        size: condition.conditions.length,
      });
    }
    condition.conditions.forEach((child, index) =>
      visit(child, [...path, "conditions", String(index)]),
    );
  };
  for (const side of ["entry", "exit", "cash"] as const) {
    if (strategy[side]) {
      visit(strategy[side]!, [side]);
    }
  }
  return points;
}
