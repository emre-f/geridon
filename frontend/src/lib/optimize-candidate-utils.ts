import type { TrialEquityResponse } from "@/lib/api-optimization-experiment-types";
import type {
  AblationEntry,
  SearchSpaceNode,
  TrialValues,
} from "@/lib/api-optimization-types";
import { formatSampledValue, nodeLabel } from "./optimize-chart-utils.ts";

export interface CandidateDiffRow {
  id: string;
  label: string;
  kind: SearchSpaceNode["kind"];
  from: string;
  to: string;
}

export function candidateDiff(space: SearchSpaceNode[], values: TrialValues): CandidateDiffRow[] {
  const rows: CandidateDiffRow[] = [];
  for (const node of space) {
    const sampled = values[node.id];
    if (sampled == null || sampled === node.current) {
      continue;
    }
    rows.push({
      id: node.id,
      label: nodeLabel(node),
      kind: node.kind,
      from: formatSampledValue(node.current),
      to: formatSampledValue(sampled),
    });
  }
  return rows;
}

// Ablation rule ids are dotted strategy paths like "entry.conditions.0";
// compress them the same way nodeLabel does ("entry r1").
export function ruleLabel(ruleId: string): string {
  const segments = ruleId.split(".");
  const side = segments[0] ?? ruleId;
  const ruleNumbers = segments
    .filter((segment) => /^\d+$/.test(segment))
    .map((segment) => String(Number(segment) + 1))
    .join(".");
  return ruleNumbers ? `${side} r${ruleNumbers}` : side;
}

export interface AblationRow {
  ruleId: string;
  label: string;
  summary: string;
  delta: number;
  ablatedScore: number;
}

export function ablationRows(entries: AblationEntry[]): {
  bars: AblationRow[];
  skipped: AblationEntry[];
} {
  const bars: AblationRow[] = [];
  const skipped: AblationEntry[] = [];
  for (const entry of entries) {
    if (entry.skipped || entry.scoreDelta == null || entry.score == null) {
      skipped.push(entry);
      continue;
    }
    bars.push({
      ruleId: entry.ruleId,
      label: ruleLabel(entry.ruleId),
      summary: entry.summary,
      delta: entry.scoreDelta,
      ablatedScore: entry.score.score,
    });
  }
  bars.sort((a, b) => b.delta - a.delta);
  return { bars, skipped };
}

export interface EquitySeriesPoint {
  timestamp_ms: number;
  returnPct: number;
}

export interface EquityFoldSegment {
  foldIndex: number;
  candidate: EquitySeriesPoint[];
  baseline: EquitySeriesPoint[];
}

export interface EquityChartData {
  symbol: string;
  folds: EquityFoldSegment[];
}

export function linePath(
  points: EquitySeriesPoint[],
  xAt: (timestamp: number) => number,
  yAt: (value: number) => number,
): string {
  return points
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"}${xAt(point.timestamp_ms)},${yAt(point.returnPct)}`,
    )
    .join("");
}

export interface EquityHoverPoint {
  foldIndex: number;
  timestamp_ms: number;
  candidate: number | null;
  baseline: number | null;
}

export function nearestEquityPoint(
  folds: EquityFoldSegment[],
  timestamp: number,
): EquityHoverPoint | null {
  let best: EquityHoverPoint | null = null;
  let bestDistance = Infinity;
  for (const fold of folds) {
    const reference = fold.candidate.length > 0 ? fold.candidate : fold.baseline;
    for (let index = 0; index < reference.length; index += 1) {
      const distance = Math.abs(reference[index].timestamp_ms - timestamp);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = {
          foldIndex: fold.foldIndex,
          timestamp_ms: reference[index].timestamp_ms,
          candidate: fold.candidate[index]?.returnPct ?? null,
          baseline: fold.baseline[index]?.returnPct ?? null,
        };
      }
    }
  }
  return best;
}

/**
 * Each fold's backtest restarts at the initial capital, so curves are
 * expressed as percent return within their own validation window.
 */
export function equityChartData(response: TrialEquityResponse): EquityChartData[] {
  const toPoints = (points: Array<{ timestamp_ms: number; equity: number }>) =>
    points.map((point) => ({
      timestamp_ms: point.timestamp_ms,
      returnPct: (point.equity / response.initial_capital - 1) * 100,
    }));

  const bySymbol = new Map<string, Map<number, EquityFoldSegment>>();
  const segmentFor = (symbol: string, foldIndex: number) => {
    let folds = bySymbol.get(symbol);
    if (!folds) {
      folds = new Map();
      bySymbol.set(symbol, folds);
    }
    let segment = folds.get(foldIndex);
    if (!segment) {
      segment = { foldIndex, candidate: [], baseline: [] };
      folds.set(foldIndex, segment);
    }
    return segment;
  };

  for (const curve of response.candidate) {
    segmentFor(curve.symbol, curve.foldIndex).candidate = toPoints(curve.points);
  }
  for (const curve of response.baseline) {
    segmentFor(curve.symbol, curve.foldIndex).baseline = toPoints(curve.points);
  }

  return [...bySymbol.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([symbol, folds]) => ({
      symbol,
      folds: [...folds.values()].sort((left, right) => left.foldIndex - right.foldIndex),
    }));
}
