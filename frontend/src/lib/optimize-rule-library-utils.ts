import type {
  EvolutionSearchSettings,
  RuleLibraryCaps,
  RuleLibraryResponse,
  RuleLibraryTemplateKind,
} from "@/lib/api-types";

export interface RuleLibraryEdits {
  /** Summaries of the approved templates; summaries are unique per library. */
  approved: string[];
  insertionPoints: string[];
  caps: RuleLibraryCaps;
}

export const templateKindLabels: Record<RuleLibraryTemplateKind, string> = {
  trend_cross: "Trend crosses",
  price_vs_ma: "Price vs moving average",
  oscillator_threshold: "Oscillator thresholds",
  band_touch: "Band touches",
  volume_filter: "Volume filters",
};

export function initialLibraryEdits(library: RuleLibraryResponse): RuleLibraryEdits {
  return {
    approved: [],
    insertionPoints: library.insertion_points.map((point) => point.id),
    caps: { ...library.cap_defaults },
  };
}

export function toggleListEntry(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((entry) => entry !== id) : [...list, id];
}

/** The evolution settings an experiment request should carry for these edits. */
export function buildEvolutionSettings(
  library: RuleLibraryResponse,
  edits: RuleLibraryEdits,
): EvolutionSearchSettings {
  const approved = new Set(edits.approved);
  return {
    ruleLibrary: library.templates
      .filter((template) => approved.has(template.summary))
      .map((template) => template.rule),
    insertionPoints: edits.insertionPoints,
    ...edits.caps,
  };
}

export function libraryIssue(
  library: RuleLibraryResponse,
  edits: RuleLibraryEdits,
): string | null {
  if (edits.approved.length > 0 && library.insertion_points.length === 0) {
    return "This strategy has no and/or group to insert rules into, so approved rules cannot be used.";
  }
  if (edits.approved.length > 0 && edits.insertionPoints.length === 0) {
    return "Approve at least one insertion point, or clear the approved rules.";
  }
  if (edits.approved.length > library.limits.maxRuleLibrary) {
    return `At most ${library.limits.maxRuleLibrary} rules can be approved.`;
  }
  for (const key of Object.keys(edits.caps) as Array<keyof RuleLibraryCaps>) {
    const value = edits.caps[key];
    const min = key === "maxNewRulesPerSide" ? 0 : 1;
    if (!Number.isInteger(value) || value < min || value > library.limits[key]) {
      return `${key} must be a whole number between ${min} and ${library.limits[key]}.`;
    }
  }
  return null;
}

export function librarySummary(library: RuleLibraryResponse, edits: RuleLibraryEdits): string {
  const parts = [`${edits.approved.length} of ${library.templates.length} rules approved`];
  if (library.insertion_points.length > 0) {
    parts.push(
      `${edits.insertionPoints.length} of ${library.insertion_points.length} insertion points`,
    );
  } else {
    parts.push("no insertion points available");
  }
  return parts.join(" · ");
}
