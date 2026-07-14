import { numericNode } from "./searchSpaceNodes.ts";
import type {
  BacktestPositionMode,
  CategoricalSearchNode,
  NumericSearchNode,
  ParameterOverride,
  TrialSizing,
  TrialValues,
} from "../../types.ts";

/** Node ids for the opt-in backtest-sizing dimensions. */
export const sizingNodeIds = {
  buyPercent: "sizing.buyPercent",
  sellPercent: "sizing.sellPercent",
} as const;

export const sizingHardBounds = { min: 1, max: 100 };
const sizingDefaultStep = 5;

export interface SizingSpaceInputs {
  positionMode?: BacktestPositionMode;
  buyPercent?: number;
  sellPercent?: number;
  parameterOverrides?: Record<string, ParameterOverride>;
}

function clampedSizingNode(
  node: NumericSearchNode | CategoricalSearchNode,
): NumericSearchNode | CategoricalSearchNode | null {
  if (node.kind === "categorical") {
    const choices = [
      ...new Set(
        node.choices.filter(
          (choice) => choice >= sizingHardBounds.min && choice <= sizingHardBounds.max,
        ),
      ),
    ];
    return choices.length > 0 ? { ...node, choices } : null;
  }
  const min = Math.max(sizingHardBounds.min, node.min);
  const max = Math.min(sizingHardBounds.max, node.max);
  if (min >= max) {
    return null;
  }
  return { ...node, min, max, scale: "linear" };
}

/**
 * Buy/sell percent as opt-in search dimensions: a node exists only when the
 * position mode supports partial sizing (long_only) and the user sent an
 * unlocked override for it. Sampled values stay inside the simulator's hard
 * 1..100 bounds no matter what range the override asks for.
 */
export function sizingSearchNodes(
  inputs: SizingSpaceInputs,
): Array<NumericSearchNode | CategoricalSearchNode> {
  if (inputs.positionMode !== "long_only") {
    return [];
  }
  const overrides = inputs.parameterOverrides ?? {};
  const dimensions = [
    { id: sizingNodeIds.buyPercent, current: inputs.buyPercent ?? 100 },
    { id: sizingNodeIds.sellPercent, current: inputs.sellPercent ?? 100 },
  ];
  const nodes: Array<NumericSearchNode | CategoricalSearchNode> = [];
  for (const { id, current } of dimensions) {
    const override = overrides[id];
    if (!override || override.locked) {
      continue;
    }
    const node = numericNode(
      id.split("."),
      current,
      sizingHardBounds.min,
      sizingHardBounds.max,
      sizingDefaultStep,
      override,
    );
    const clamped = clampedSizingNode(node);
    if (clamped) {
      nodes.push(clamped);
    }
  }
  return nodes;
}

/** The sizing a candidate's sampled values ask for; undefined when sizing was not searched. */
export function sizingFromValues(values: TrialValues): TrialSizing | undefined {
  const buyPercent = values[sizingNodeIds.buyPercent];
  const sellPercent = values[sizingNodeIds.sellPercent];
  const sizing: TrialSizing = {
    ...(typeof buyPercent === "number" ? { buyPercent } : {}),
    ...(typeof sellPercent === "number" ? { sellPercent } : {}),
  };
  return Object.keys(sizing).length > 0 ? sizing : undefined;
}
