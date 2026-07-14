import { catalogByKind } from "../indicatorCatalog.ts";
import type {
  ComparisonOperator,
  IndicatorOperand,
  StrategyOperand,
  StrategyRule,
} from "../../types.ts";

const operatorLabels: Record<ComparisonOperator, string> = {
  gt: "is greater than",
  gte: "is at least",
  lt: "is less than",
  lte: "is at most",
  cross_above: "crosses above",
  cross_below: "crosses below",
};

function indicatorLabel(operand: IndicatorOperand): string {
  const definition = catalogByKind.get(operand.kind);
  if (!definition) {
    const parameters = Object.values(operand.parameters).join(",");
    return `${operand.kind}(${parameters}).${operand.output}`;
  }
  const parameters = definition.parameters
    .map((parameter) => operand.parameters[parameter.key])
    .filter((value) => value !== undefined)
    .join(", ");
  const base = parameters.length > 0 ? `${definition.label}(${parameters})` : definition.label;
  if (definition.values.length <= 1) {
    return base;
  }
  const output = definition.values.find((value) => value.key === operand.output);
  return output && output.label !== definition.label ? `${base} ${output.label}` : base;
}

function operandLabel(operand: StrategyOperand): string {
  if (operand.type === "price") {
    return operand.field.charAt(0).toUpperCase() + operand.field.slice(1);
  }
  if (operand.type === "value") {
    return String(operand.value);
  }
  return indicatorLabel(operand);
}

/**
 * Human-readable counterpart of describeRule, e.g. "SMA(20) crosses above
 * SMA(50)". Served as an optional `label` alongside `summary`; consumers must
 * fall back to `summary` when it is absent.
 */
export function describeRuleLabel(rule: StrategyRule): string {
  return `${operandLabel(rule.left)} ${operatorLabels[rule.operator]} ${operandLabel(rule.right)}`;
}
