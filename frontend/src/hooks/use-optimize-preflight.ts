import { useEffect, useRef, useState } from "react";

import {
  preflightOptimizationExperiment,
  type CreateOptimizationExperimentInput,
  type ExperimentPreflight,
} from "@/lib/api";

interface PreflightState {
  preflight: ExperimentPreflight | null;
  loading: boolean;
  error: string | null;
}

const debounceMs = 600;

/**
 * Debounced cost estimate for the draft experiment: whenever the config
 * settles, POSTs it to the preflight endpoint, which runs a small timed
 * benchmark on the selected data. Pass null while the form is incomplete.
 */
export function useOptimizePreflight(input: CreateOptimizationExperimentInput | null) {
  const [state, setState] = useState<PreflightState>({
    preflight: null,
    loading: false,
    error: null,
  });
  const inputRef = useRef(input);
  useEffect(() => {
    inputRef.current = input;
  }, [input]);
  const key = input == null ? null : JSON.stringify(input);

  useEffect(() => {
    if (key == null) {
      setState({ preflight: null, loading: false, error: null });
      return;
    }
    let cancelled = false;
    setState((previous) => ({ ...previous, loading: true, error: null }));
    const timer = setTimeout(() => {
      const current = inputRef.current;
      if (current == null) {
        return;
      }
      preflightOptimizationExperiment(current)
        .then((preflight) => {
          if (!cancelled) {
            setState({ preflight, loading: false, error: null });
          }
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            setState({
              preflight: null,
              loading: false,
              error: error instanceof Error ? error.message : "Preflight failed.",
            });
          }
        });
    }, debounceMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [key]);

  return state;
}
