import type { SearchSpacePreview } from "@/lib/api-optimization-experiment-types";
import { nodeLabel } from "./optimize-chart-utils.ts";
import { sizingNodes, underOffRule, type SearchSpaceEdits } from "./optimize-search-space-utils.ts";

const comparisonOperatorCount = 6;

export type BudgetPreset = "quick" | "standard" | "thorough";
export type BudgetPresetChoice = BudgetPreset | "custom";

export interface BudgetPresetValues {
  maxTrials: number;
  maxRuntimeMinutes: number;
  foldCount: number;
}

/**
 * Calibrated against backend/bench/RESULTS.md (56-149 fold backtests/second):
 * quick finishes in seconds on daily data, thorough stays inside its cap even
 * on intraday history. The preflight estimate re-checks on the actual data.
 */
export const budgetPresets: Record<BudgetPreset, BudgetPresetValues> = {
  quick: { maxTrials: 25, maxRuntimeMinutes: 1, foldCount: 3 },
  standard: { maxTrials: 100, maxRuntimeMinutes: 3, foldCount: 4 },
  thorough: { maxTrials: 300, maxRuntimeMinutes: 15, foldCount: 6 },
};

export const budgetPresetLabels: Record<BudgetPresetChoice, string> = {
  quick: "Quick",
  standard: "Standard",
  thorough: "Thorough",
  custom: "Custom",
};

/** Logical cores the browser reports; the local backend runs on the same machine. */
export function machineCoreCount(): number {
  const cores = typeof navigator !== "undefined" ? navigator.hardwareConcurrency : undefined;
  return Number.isFinite(cores) && (cores as number) > 0 ? Math.floor(cores as number) : 4;
}

/** Conservative multi-core default: use most cores but leave headroom (mirrors the backend). */
export function defaultWorkerCount(): number {
  return Math.max(1, machineCoreCount() - 2);
}

export interface SpaceDimension {
  id: string;
  label: string;
  cardinality: number;
}

export interface SearchSpaceSize {
  dimensions: SpaceDimension[];
  log10Total: number;
}

export function numericCardinality(min: number, max: number, step: number): number {
  if (!(max > min) || step <= 0) {
    return 1;
  }
  return Math.floor(Math.round(((max - min) / step) * 1e9) / 1e9) + 1;
}

function ruleShortLabel(ruleId: string): string {
  const segments = ruleId.split(".");
  const side = segments[0] ?? ruleId;
  const numbers = segments
    .filter((segment) => /^\d+$/.test(segment))
    .map((segment) => String(Number(segment) + 1))
    .join(".");
  return numbers ? `${side} r${numbers}` : side;
}

/**
 * The combinations the optimizer could sample given the user's locks, ranges,
 * and rule roles, with dimensions sorted so the biggest multipliers lead.
 */
export function searchSpaceSize(
  preview: SearchSpacePreview,
  edits: SearchSpaceEdits,
): SearchSpaceSize {
  const dimensions: SpaceDimension[] = [];
  for (const node of preview.nodes) {
    if (node.kind === "toggle" || node.kind === "operator" || underOffRule(node.id, edits)) {
      continue;
    }
    if (node.kind === "categorical") {
      dimensions.push({ id: node.id, label: nodeLabel(node), cardinality: node.choices.length });
      continue;
    }
    const edit = edits.parameters[node.id];
    if (edit?.locked) {
      continue;
    }
    dimensions.push({
      id: node.id,
      label: nodeLabel(node),
      cardinality: numericCardinality(edit?.min ?? node.min, edit?.max ?? node.max, node.step),
    });
  }
  for (const rule of preview.rules) {
    if (edits.roles[rule.id] === "optional") {
      dimensions.push({
        id: rule.id,
        label: `${ruleShortLabel(rule.id)} on/off`,
        cardinality: 2,
      });
    }
    if (edits.operators[rule.id] && edits.roles[rule.id] !== "off") {
      dimensions.push({
        id: `${rule.id}.operator`,
        label: `${ruleShortLabel(rule.id)} operator`,
        cardinality: comparisonOperatorCount,
      });
    }
  }
  for (const group of preview.at_least_groups ?? []) {
    if (edits.atLeast[group.id]) {
      dimensions.push({
        id: `${group.id}.count`,
        label: `${ruleShortLabel(group.id)} at-least count`,
        cardinality: group.size,
      });
    }
  }
  for (const node of sizingNodes(preview)) {
    const edit = edits.sizing[node.id];
    if (edit?.tuned) {
      dimensions.push({
        id: node.id,
        label: nodeLabel(node),
        cardinality: numericCardinality(edit.min, edit.max, node.step),
      });
    }
  }
  dimensions.sort((left, right) => right.cardinality - left.cardinality);
  const log10Total = dimensions.reduce(
    (sum, dimension) => sum + Math.log10(dimension.cardinality),
    0,
  );
  return { dimensions, log10Total };
}

const superscripts = "⁰¹²³⁴⁵⁶⁷⁸⁹";

export function formatCombinations(log10Total: number): string {
  if (log10Total <= 0) {
    return "1";
  }
  if (log10Total < 6) {
    return Math.round(10 ** log10Total).toLocaleString();
  }
  const exponent = Math.floor(log10Total);
  const mantissa = 10 ** (log10Total - exponent);
  const exponentText = String(exponent)
    .split("")
    .map((digit) => superscripts[Number(digit)])
    .join("");
  return `${mantissa.toFixed(1)}×10${exponentText}`;
}

export function formatRuntime(ms: number): string {
  if (ms < 1_000) {
    return "under 1s";
  }
  if (ms < 90_000) {
    return `${Math.round(ms / 1_000)}s`;
  }
  return `${(ms / 60_000).toFixed(1)}min`;
}

/** Null when the budget covers the space reasonably; otherwise a warning. */
export function spaceCoverageWarning(size: SearchSpaceSize, maxTrials: number): string | null {
  if (size.dimensions.length === 0 || size.log10Total <= Math.log10(Math.max(maxTrials, 1)) + 2) {
    return null;
  }
  return (
    `${maxTrials} trials sample a small fraction of ~${formatCombinations(size.log10Total)} ` +
    "combinations. Lock parameters or narrow ranges for denser coverage, or rely on " +
    "refinement to zoom into robust regions."
  );
}
