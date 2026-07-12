import type {
  NumericSearchNode,
  ParameterOverride,
  RuleRole,
  SearchSpacePreview,
  SearchSpacePreviewRule,
} from "@/lib/api";

export interface ParameterEdit {
  locked: boolean;
  min: number;
  max: number;
}

export interface SearchSpaceEdits {
  roles: Record<string, RuleRole>;
  parameters: Record<string, ParameterEdit>;
}

export type NumericPreviewNode = NumericSearchNode & {
  hard_min: number | null;
  hard_max: number | null;
};

export function numericNodes(preview: SearchSpacePreview): NumericPreviewNode[] {
  return preview.nodes.filter(
    (node): node is NumericPreviewNode => node.kind === "numeric",
  );
}

export function initialEdits(preview: SearchSpacePreview): SearchSpaceEdits {
  return {
    roles: Object.fromEntries(preview.rules.map((rule) => [rule.id, "required" as RuleRole])),
    parameters: Object.fromEntries(
      numericNodes(preview).map((node) => [
        node.id,
        { locked: false, min: node.min, max: node.max },
      ]),
    ),
  };
}

export function buildRuleRoles(edits: SearchSpaceEdits): Record<string, RuleRole> | undefined {
  const entries = Object.entries(edits.roles).filter(([, role]) => role !== "required");
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

export function buildParameterOverrides(
  preview: SearchSpacePreview,
  edits: SearchSpaceEdits,
): Record<string, ParameterOverride> | undefined {
  const overrides: Record<string, ParameterOverride> = {};
  for (const node of numericNodes(preview)) {
    const edit = edits.parameters[node.id];
    if (!edit) {
      continue;
    }
    if (edit.locked) {
      overrides[node.id] = { locked: true };
    } else if (edit.min !== node.min || edit.max !== node.max) {
      overrides[node.id] = { min: edit.min, max: edit.max };
    }
  }
  return Object.keys(overrides).length > 0 ? overrides : undefined;
}

export interface RuleParameterGroup {
  rule: SearchSpacePreviewRule | null;
  nodes: NumericPreviewNode[];
}

/** Parameters grouped under the rule they belong to; rule-less nodes last. */
export function ruleParameterGroups(preview: SearchSpacePreview): RuleParameterGroup[] {
  const nodes = numericNodes(preview);
  const grouped = new Set<string>();
  const groups: RuleParameterGroup[] = preview.rules.map((rule) => {
    const ruleNodes = nodes.filter((node) => node.id.startsWith(`${rule.id}.`));
    for (const node of ruleNodes) {
      grouped.add(node.id);
    }
    return { rule, nodes: ruleNodes };
  });
  const leftover = nodes.filter((node) => !grouped.has(node.id));
  if (leftover.length > 0) {
    groups.push({ rule: null, nodes: leftover });
  }
  return groups;
}

export function underOffRule(nodeId: string, edits: SearchSpaceEdits): boolean {
  return Object.entries(edits.roles).some(
    ([ruleId, role]) => role === "off" && nodeId.startsWith(`${ruleId}.`),
  );
}

/** Nodes the optimizer would actually search, given locks and off rules. */
export function searchedNodes(
  preview: SearchSpacePreview,
  edits: SearchSpaceEdits,
): NumericPreviewNode[] {
  return numericNodes(preview).filter(
    (node) => !edits.parameters[node.id]?.locked && !underOffRule(node.id, edits),
  );
}

export function editsIssue(preview: SearchSpacePreview, edits: SearchSpaceEdits): string | null {
  const sides = new Set(preview.rules.map((rule) => rule.side));
  for (const side of sides) {
    const anyOn = preview.rules.some(
      (rule) => rule.side === side && edits.roles[rule.id] !== "off",
    );
    if (!anyOn) {
      return `At least one ${side} rule must stay on.`;
    }
  }
  for (const node of numericNodes(preview)) {
    const edit = edits.parameters[node.id];
    if (!edit || edit.locked) {
      continue;
    }
    if (edit.min >= edit.max) {
      return `Range for ${node.id} needs min below max.`;
    }
    if (
      (node.hard_min != null && edit.min < node.hard_min) ||
      (node.hard_max != null && edit.max > node.hard_max)
    ) {
      return `Range for ${node.id} must stay within ${node.hard_min}–${node.hard_max}.`;
    }
  }
  const optionalRules = Object.values(edits.roles).filter((role) => role === "optional").length;
  if (searchedNodes(preview, edits).length === 0 && optionalRules === 0) {
    return "Everything is locked, so there is nothing left to search.";
  }
  return null;
}

export function editsSummary(preview: SearchSpacePreview, edits: SearchSpaceEdits): string {
  const searched = searchedNodes(preview, edits).length;
  const total = numericNodes(preview).length;
  const parts = [`${searched} of ${total} parameters searched`];
  const optional = Object.values(edits.roles).filter((role) => role === "optional").length;
  const off = Object.values(edits.roles).filter((role) => role === "off").length;
  if (optional > 0) {
    parts.push(`${optional} optional ${optional === 1 ? "rule" : "rules"}`);
  }
  if (off > 0) {
    parts.push(`${off} ${off === 1 ? "rule" : "rules"} off`);
  }
  return parts.join(" · ");
}
