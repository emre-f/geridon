import { validateCandidate } from "./searchSpace.ts";
import { evaluateOnFolds, type EvaluationSettings } from "./evaluate.ts";
import { scoreTrial } from "./scoring.ts";
import {
  cloneStrategy,
  collectRules,
  computeComplexity,
  describeRule,
  pathId,
  setAtPath,
} from "./strategyPaths.ts";
import type {
  AblationEntry,
  FoldSpec,
  OptimizationDataset,
  ScoringConfig,
  Strategy,
  TrialScore,
} from "../../types.ts";

export interface AblationContext {
  datasets: OptimizationDataset[];
  foldsBySymbol: Map<string, FoldSpec[]>;
  settings: EvaluationSettings;
  scoring: ScoringConfig;
}

export function runAblation(
  candidate: Strategy,
  candidateScore: TrialScore,
  context: AblationContext,
): AblationEntry[] {
  const entries: AblationEntry[] = [];

  for (const { path, rule } of collectRules(candidate)) {
    if (rule.enabled === false) {
      continue;
    }
    const ruleId = pathId(path);
    const summary = `${path[0]}: ${describeRule(rule)}`;

    const ablated = cloneStrategy(candidate);
    setAtPath(ablated, [...path, "enabled"], false);
    const validationError = validateCandidate(ablated, context.settings.positionMode);
    if (validationError) {
      entries.push({
        ruleId,
        summary,
        skipped: true,
        skipReason: validationError,
        score: null,
        scoreDelta: null,
      });
      continue;
    }

    const foldResults = evaluateOnFolds(
      ablated,
      context.datasets,
      context.foldsBySymbol,
      context.settings,
    );
    const score = scoreTrial(foldResults, computeComplexity(ablated), context.scoring);
    entries.push({
      ruleId,
      summary,
      skipped: false,
      score,
      scoreDelta: score.score - candidateScore.score,
    });
  }

  return entries;
}
