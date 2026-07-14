import { useEffect, useMemo, useState } from "react";

import { getOptimizationSearchSpace, type RuleRole, type SearchSpacePreview } from "@/lib/api";
import {
  buildParameterOverrides,
  buildRuleRoles,
  buildStructureSearch,
  editsIssue,
  editsSummary,
  initialEdits,
  type ParameterEdit,
  type SearchSpaceEdits,
  type SizingEdit,
} from "@/lib/optimize-search-space-utils";

interface SearchSpaceState {
  strategyId: number | null;
  preview: SearchSpacePreview | null;
  edits: SearchSpaceEdits | null;
  loading: boolean;
  error: string | null;
}

const emptyState: SearchSpaceState = {
  strategyId: null,
  preview: null,
  edits: null,
  loading: false,
  error: null,
};

/**
 * Loads the compiled search space for the selected strategy and tracks the
 * user's per-parameter ranges/locks and per-rule roles for the new-experiment
 * form. Edits reset whenever the strategy changes.
 */
export function useOptimizeSearchSpace(strategyId: number | null) {
  const [state, setState] = useState<SearchSpaceState>(emptyState);

  useEffect(() => {
    if (strategyId == null) {
      setState(emptyState);
      return;
    }
    let cancelled = false;
    setState({ strategyId, preview: null, edits: null, loading: true, error: null });
    getOptimizationSearchSpace(strategyId)
      .then((preview) => {
        if (!cancelled) {
          setState({
            strategyId,
            preview,
            edits: initialEdits(preview),
            loading: false,
            error: null,
          });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            strategyId,
            preview: null,
            edits: null,
            loading: false,
            error: error instanceof Error ? error.message : "Could not load the search space.",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [strategyId]);

  const { preview, edits } = state;

  const derived = useMemo(() => {
    if (!preview || !edits) {
      return {
        ruleRoles: undefined,
        parameterOverrides: undefined,
        structureSearch: undefined,
        issue: null,
        summary: "",
      };
    }
    return {
      ruleRoles: buildRuleRoles(edits),
      parameterOverrides: buildParameterOverrides(preview, edits),
      structureSearch: buildStructureSearch(edits),
      issue: editsIssue(preview, edits),
      summary: editsSummary(preview, edits),
    };
  }, [preview, edits]);

  return {
    preview,
    edits,
    loading: state.loading,
    error: state.error,
    ...derived,
    resetRoles: () =>
      setState((previous) =>
        previous.edits
          ? {
              ...previous,
              edits: {
                ...previous.edits,
                roles: Object.fromEntries(
                  Object.keys(previous.edits.roles).map((ruleId) => [ruleId, "required" as RuleRole]),
                ),
                operators: Object.fromEntries(
                  Object.keys(previous.edits.operators).map((ruleId) => [ruleId, false]),
                ),
                atLeast: Object.fromEntries(
                  Object.keys(previous.edits.atLeast).map((groupId) => [groupId, false]),
                ),
              },
            }
          : previous,
      ),
    setSizing: (nodeId: string, patch: Partial<SizingEdit>) =>
      setState((previous) => {
        const edit = previous.edits?.sizing[nodeId];
        if (!previous.edits || !edit) {
          return previous;
        }
        return {
          ...previous,
          edits: {
            ...previous.edits,
            sizing: { ...previous.edits.sizing, [nodeId]: { ...edit, ...patch } },
          },
        };
      }),
    setOperatorSearch: (ruleId: string, searched: boolean) =>
      setState((previous) =>
        previous.edits && ruleId in previous.edits.operators
          ? {
              ...previous,
              edits: {
                ...previous.edits,
                operators: { ...previous.edits.operators, [ruleId]: searched },
              },
            }
          : previous,
      ),
    setAtLeastSearch: (groupId: string, searched: boolean) =>
      setState((previous) =>
        previous.edits && groupId in previous.edits.atLeast
          ? {
              ...previous,
              edits: {
                ...previous.edits,
                atLeast: { ...previous.edits.atLeast, [groupId]: searched },
              },
            }
          : previous,
      ),
    setRole: (ruleId: string, role: RuleRole) =>
      setState((previous) =>
        previous.edits
          ? { ...previous, edits: { ...previous.edits, roles: { ...previous.edits.roles, [ruleId]: role } } }
          : previous,
      ),
    setParameter: (nodeId: string, patch: Partial<ParameterEdit>) =>
      setState((previous) => {
        const edit = previous.edits?.parameters[nodeId];
        if (!previous.edits || !edit) {
          return previous;
        }
        return {
          ...previous,
          edits: {
            ...previous.edits,
            parameters: { ...previous.edits.parameters, [nodeId]: { ...edit, ...patch } },
          },
        };
      }),
  };
}
