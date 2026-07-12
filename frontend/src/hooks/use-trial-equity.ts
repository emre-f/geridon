import { useEffect, useState } from "react";

import { getOptimizationTrialEquity, type TrialEquityResponse } from "@/lib/api";

interface EquityState {
  curves: Record<string, TrialEquityResponse>;
  loading: boolean;
  error: string | null;
}

/**
 * Fetches a trial's on-demand validation equity curves when it is selected.
 * The endpoint recomputes backtests, so responses are cached per trial.
 */
export function useTrialEquity(experimentId: number, trialIndex: number | null) {
  const [state, setState] = useState<EquityState>({ curves: {}, loading: false, error: null });

  const key = trialIndex != null ? `${experimentId}:${trialIndex}` : null;
  const equity = key != null ? (state.curves[key] ?? null) : null;

  useEffect(() => {
    if (key == null || trialIndex == null || equity != null) {
      return;
    }
    let cancelled = false;

    async function load() {
      setState((previous) => ({ ...previous, loading: true, error: null }));
      try {
        const response = await getOptimizationTrialEquity(experimentId, trialIndex!);
        if (!cancelled) {
          setState((previous) => ({
            curves: { ...previous.curves, [key!]: response },
            loading: false,
            error: null,
          }));
        }
      } catch (error) {
        if (!cancelled) {
          setState((previous) => ({
            ...previous,
            loading: false,
            error:
              error instanceof Error ? error.message : "Could not load the validation equity curves.",
          }));
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [experimentId, trialIndex, key, equity]);

  return { equity, loading: state.loading, error: state.error };
}
