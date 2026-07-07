import type { StrategyCondition, StrategyDraft, StrategyRecord } from "@/lib/api";
import { asRootGroup } from "@/lib/strategy";

export function draftFromRecord(record: StrategyRecord): StrategyDraft {
  return {
    name: record.name,
    entry: asRootGroup(record.entry),
    exit: asRootGroup(record.exit),
  };
}

function stripConditionIds(condition: StrategyCondition): unknown {
  // Stored records only carry enabled when false, so mirror that here to keep
  // dirty comparisons stable.
  const enabled = condition.enabled === false ? { enabled: false } : {};

  if (condition.type === "group") {
    return {
      type: condition.type,
      operator: condition.operator,
      conditions: condition.conditions.map(stripConditionIds),
      ...enabled,
    };
  }

  return {
    type: condition.type,
    left: condition.left,
    operator: condition.operator,
    right: condition.right,
    ...enabled,
  };
}

function serializableDraft(draft: StrategyDraft) {
  return {
    name: draft.name,
    entry: stripConditionIds(draft.entry),
    exit: stripConditionIds(draft.exit),
  };
}

export function sameDraft(left: StrategyDraft | null, right: StrategyDraft | null) {
  if (!left || !right) {
    return left === right;
  }

  return JSON.stringify(serializableDraft(left)) === JSON.stringify(serializableDraft(right));
}
