import type { SnapshotRule } from "@/lib/api-strategy-types";

export type RuleLibraryTemplateKind =
  | "trend_cross"
  | "price_vs_ma"
  | "oscillator_threshold"
  | "band_touch"
  | "volume_filter";

export interface RuleLibraryTemplate {
  template: RuleLibraryTemplateKind;
  summary: string;
  /** Human-readable form of summary; fall back to summary when absent. */
  label?: string;
  rule: SnapshotRule;
}

/** An enabled and/or group the user may approve for rule insertion. */
export interface RuleLibraryInsertionPoint {
  id: string;
  side: "entry" | "exit" | "cash";
  operator: "and" | "or";
  size: number;
}

export interface RuleLibraryCaps {
  maxNewRulesPerSide: number;
  maxActiveRulesPerSide: number;
  maxUniqueIndicatorsPerSide: number;
  maxTreeDepth: number;
}

export interface RuleLibraryLimits extends RuleLibraryCaps {
  maxRuleLibrary: number;
}

/** Seeded candidate-rule library for Mode C, served to the experiment form. */
export interface RuleLibraryResponse {
  strategy_id: number;
  templates: RuleLibraryTemplate[];
  insertion_points: RuleLibraryInsertionPoint[];
  /** Suggested caps; the form starts here and may only lower within limits. */
  cap_defaults: RuleLibraryCaps;
  /** Hard ceilings the API accepts for user-supplied evolution settings. */
  limits: RuleLibraryLimits;
}

/** The Mode C settings sent with an evolution experiment. */
export interface EvolutionSearchSettings extends Partial<RuleLibraryCaps> {
  ruleLibrary?: SnapshotRule[];
  insertionPoints?: string[];
}
