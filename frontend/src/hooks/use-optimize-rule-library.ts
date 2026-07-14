import { useEffect, useMemo, useState } from "react";

import { getOptimizationRuleLibrary, type RuleLibraryResponse } from "@/lib/api";
import {
  buildEvolutionSettings,
  initialLibraryEdits,
  libraryIssue,
  librarySummary,
  toggleListEntry,
  type RuleLibraryEdits,
} from "@/lib/optimize-rule-library-utils";

interface RuleLibraryState {
  library: RuleLibraryResponse | null;
  edits: RuleLibraryEdits | null;
  loading: boolean;
  error: string | null;
}

const emptyState: RuleLibraryState = { library: null, edits: null, loading: false, error: null };

/**
 * Loads the seeded Mode C rule library for the selected strategy and tracks
 * which templates, insertion points, and caps the user approved. Only active
 * while the evolution method is selected; edits reset on strategy change.
 */
export function useOptimizeRuleLibrary(strategyId: number | null, enabled: boolean) {
  const [state, setState] = useState<RuleLibraryState>(emptyState);

  useEffect(() => {
    if (strategyId == null || !enabled) {
      setState(emptyState);
      return;
    }
    let cancelled = false;
    setState({ library: null, edits: null, loading: true, error: null });
    getOptimizationRuleLibrary(strategyId)
      .then((library) => {
        if (!cancelled) {
          setState({ library, edits: initialLibraryEdits(library), loading: false, error: null });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            library: null,
            edits: null,
            loading: false,
            error: error instanceof Error ? error.message : "Could not load the rule library.",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [strategyId, enabled]);

  const { library, edits } = state;
  const derived = useMemo(() => {
    if (!library || !edits) {
      return { evolution: undefined, issue: null, summary: "" };
    }
    return {
      evolution: buildEvolutionSettings(library, edits),
      issue: libraryIssue(library, edits),
      summary: librarySummary(library, edits),
    };
  }, [library, edits]);

  const patchEdits = (patch: (edits: RuleLibraryEdits) => Partial<RuleLibraryEdits>) =>
    setState((previous) =>
      previous.edits
        ? { ...previous, edits: { ...previous.edits, ...patch(previous.edits) } }
        : previous,
    );

  return {
    library,
    edits,
    loading: state.loading,
    error: state.error,
    ...derived,
    toggleTemplate: (summary: string) =>
      patchEdits((current) => ({ approved: toggleListEntry(current.approved, summary) })),
    toggleInsertionPoint: (id: string) =>
      patchEdits((current) => ({
        insertionPoints: toggleListEntry(current.insertionPoints, id),
      })),
    setCap: (key: keyof RuleLibraryEdits["caps"], value: number) =>
      patchEdits((current) => ({ caps: { ...current.caps, [key]: value } })),
  };
}
