import { median } from "./scoring.ts";
import type { OptimizationTrial } from "../../types.ts";

interface ParetoPoint {
  trialIndex: number;
  objective: number;
  drawdown: number;
  turnover: number;
  complexity: number;
}

function toPoint(trial: OptimizationTrial): ParetoPoint {
  return {
    trialIndex: trial.index,
    objective: trial.score?.medianObjective ?? -Infinity,
    drawdown: median(trial.foldResults.map((fold) => Math.abs(fold.max_drawdown_pct))),
    turnover: median(
      trial.foldResults.map((fold) =>
        fold.candle_count > 0 ? (fold.trade_count / fold.candle_count) * 100 : 0,
      ),
    ),
    complexity:
      trial.complexity.activeRules +
      trial.complexity.uniqueIndicators +
      Math.max(0, trial.complexity.maxDepth - 1),
  };
}

function dominates(a: ParetoPoint, b: ParetoPoint): boolean {
  const atLeastAsGood =
    a.objective >= b.objective &&
    a.drawdown <= b.drawdown &&
    a.turnover <= b.turnover &&
    a.complexity <= b.complexity;
  const strictlyBetter =
    a.objective > b.objective ||
    a.drawdown < b.drawdown ||
    a.turnover < b.turnover ||
    a.complexity < b.complexity;
  return atLeastAsGood && strictlyBetter;
}

/**
 * Non-dominated sorting over (maximize median objective, minimize drawdown,
 * turnover, and complexity). Returns trial indexes grouped by front.
 */
export function computeParetoFronts(trials: OptimizationTrial[]): number[][] {
  let remaining = trials
    .filter((trial) => trial.status === "scored" && trial.score != null)
    .map(toPoint);
  const fronts: number[][] = [];

  while (remaining.length > 0) {
    const front = remaining.filter(
      (point) => !remaining.some((other) => other !== point && dominates(other, point)),
    );
    if (front.length === 0) {
      fronts.push(remaining.map((point) => point.trialIndex));
      break;
    }
    fronts.push(front.map((point) => point.trialIndex));
    const inFront = new Set(front);
    remaining = remaining.filter((point) => !inFront.has(point));
  }

  return fronts;
}
