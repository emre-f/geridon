import { useEffect, useMemo, useReducer } from "react";

import {
  createStrategy,
  deleteStrategy,
  generateSignals,
  listIndicators,
  listStrategies,
  updateStrategy,
  validateStrategy,
  type IndicatorDefinition,
  type IndicatorKind,
  type IndicatorLineStyle,
  type IndicatorSpec,
  type StrategyDraft,
  type StrategyRecord,
} from "@/lib/api";
import type { AppTab } from "@/lib/app-types";
import { loadLastStrategySelection, saveLastStrategySelection } from "@/lib/chart-state";
import { definitionValueSlots, normalizeLineStyles } from "@/lib/indicator-style";
import { createStrategyDraft, strategyIndicatorSpecs } from "@/lib/strategy";
import { draftFromRecord, sameDraft } from "@/lib/strategy-draft";
import type { TimeWindow } from "@/hooks/chart-display";
import {
  initialStrategyWorkspaceState,
  strategyWorkspaceReducer,
} from "@/hooks/strategy-workspace-state";

interface StrategyWorkspaceOptions {
  activeTab: AppTab;
  indicatorCatalog: IndicatorDefinition[];
  indicatorDefinitionsByKind: Map<IndicatorKind, IndicatorDefinition>;
  selectedTicker: string;
  timeframe: string;
  candleRequestWindow: TimeWindow | undefined;
}

function errorMessage(candidate: unknown, fallback: string) {
  return candidate instanceof Error ? candidate.message : fallback;
}

/**
 * Owns the Strategies tab: the saved-strategy list, the draft being edited,
 * validation, and the indicator/signal previews for the chart.
 */
export function useStrategyWorkspace({
  activeTab,
  indicatorCatalog,
  indicatorDefinitionsByKind,
  selectedTicker,
  timeframe,
  candleRequestWindow,
}: StrategyWorkspaceOptions) {
  const [state, dispatch] = useReducer(strategyWorkspaceReducer, initialStrategyWorkspaceState);
  const { strategies, draft, lastValidDraft, previewSpecs } = state;

  const selectedRecord = useMemo(
    () => strategies.find((strategy) => strategy.id === state.selectedId),
    [state.selectedId, strategies],
  );
  const dirty = useMemo(() => {
    if (!draft) {
      return false;
    }
    if (!selectedRecord) {
      // A pristine (New) draft is not worth warning about; only edits are.
      return !sameDraft(draft, createStrategyDraft(indicatorCatalog));
    }

    return !sameDraft(draft, draftFromRecord(selectedRecord));
  }, [indicatorCatalog, selectedRecord, draft]);
  const previewKey = useMemo(
    () => JSON.stringify(previewSpecs.map(({ id, kind, parameters }) => ({ id, kind, parameters }))),
    [previewSpecs],
  );
  const previewRequestSpecs = useMemo(
    () => JSON.parse(previewKey) as IndicatorSpec[],
    [previewKey],
  );
  const indicatorsForChart = useMemo(() => {
    const specIndexById = new Map(previewSpecs.map((indicator, index) => [indicator.id, index]));
    const stylesById = new Map(previewSpecs.map((indicator) => [indicator.id, indicator.styles]));

    return state.indicatorSeries.map((series) => ({
      ...series,
      styles: normalizeLineStyles(
        stylesById.get(series.id),
        series.values.length,
        specIndexById.get(series.id) ?? 0,
      ),
    }));
  }, [state.indicatorSeries, previewSpecs]);

  function specsFor(nextDraft: StrategyDraft) {
    return strategyIndicatorSpecs(nextDraft, indicatorDefinitionsByKind);
  }

  useEffect(() => {
    let cancelled = false;

    async function loadSavedStrategies() {
      try {
        const records = await listStrategies();
        if (!cancelled) {
          dispatch({ type: "strategiesLoaded", records });
        }
      } catch (loadError) {
        if (!cancelled) {
          dispatch({
            type: "strategiesFailed",
            message: errorMessage(loadError, "Could not load strategies."),
          });
        }
      }
    }

    loadSavedStrategies();
    return () => {
      cancelled = true;
    };
  }, []);

  // Reopen the remembered strategy once the list and catalog are both ready.
  useEffect(() => {
    if (state.initialized || state.strategiesLoading || indicatorCatalog.length === 0) {
      return;
    }

    const remembered = loadLastStrategySelection();
    const record =
      remembered === "new"
        ? undefined
        : strategies.find((strategy) => strategy.id === Number(remembered));
    const nextDraft = record ? draftFromRecord(record) : createStrategyDraft(indicatorCatalog);
    dispatch({
      type: "initialized",
      opened: {
        id: record?.id ?? null,
        draft: nextDraft,
        previewSpecs: strategyIndicatorSpecs(nextDraft, indicatorDefinitionsByKind),
      },
    });
  }, [indicatorCatalog, indicatorDefinitionsByKind, strategies, state.strategiesLoading, state.initialized]);

  // Validate edits after a short pause so typing doesn't spam the backend.
  useEffect(() => {
    if (activeTab !== "strategies" || !draft || indicatorCatalog.length === 0) {
      return;
    }

    let cancelled = false;
    const timeout = window.setTimeout(async () => {
      dispatch({ type: "validateStarted" });

      try {
        const result = await validateStrategy(draft);
        if (!cancelled) {
          dispatch({
            type: "validated",
            result,
            draft,
            previewSpecs: strategyIndicatorSpecs(draft, indicatorDefinitionsByKind),
          });
        }
      } catch (validateError) {
        if (!cancelled) {
          dispatch({
            type: "errorSet",
            message: errorMessage(validateError, "Could not validate the strategy."),
          });
        }
      } finally {
        if (!cancelled) {
          dispatch({ type: "validateFinished" });
        }
      }
    }, 400);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [activeTab, indicatorCatalog.length, indicatorDefinitionsByKind, draft]);

  useEffect(() => {
    if (
      activeTab !== "strategies" ||
      !selectedTicker ||
      !candleRequestWindow ||
      previewRequestSpecs.length === 0
    ) {
      dispatch({ type: "indicatorsCleared" });
      return;
    }

    let cancelled = false;
    const requestWindow = candleRequestWindow;

    async function loadStrategyIndicators() {
      dispatch({ type: "indicatorsRequested" });

      try {
        const nextSeries = await listIndicators({
          ticker: selectedTicker,
          timeframe,
          startMs: requestWindow.startMs,
          endMs: requestWindow.endMs,
          indicators: previewRequestSpecs,
        });

        if (!cancelled) {
          dispatch({ type: "indicatorSeriesLoaded", series: nextSeries });
        }
      } catch (loadError) {
        if (!cancelled) {
          dispatch({
            type: "indicatorsFailed",
            message: errorMessage(loadError, "Could not load strategy indicators."),
          });
        }
      }
    }

    loadStrategyIndicators();
    return () => {
      cancelled = true;
    };
  }, [activeTab, candleRequestWindow, selectedTicker, previewKey, previewRequestSpecs, timeframe]);

  useEffect(() => {
    dispatch({ type: "signalsCleared" });

    if (activeTab !== "strategies" || !selectedTicker || !candleRequestWindow || !lastValidDraft) {
      return;
    }

    let cancelled = false;
    const requestWindow = candleRequestWindow;
    const requestStrategy = lastValidDraft;

    async function loadSignals() {
      try {
        const response = await generateSignals({
          ticker: selectedTicker,
          timeframe,
          startMs: requestWindow.startMs,
          endMs: requestWindow.endMs,
          strategy: requestStrategy,
        });

        if (!cancelled) {
          dispatch({ type: "signalsLoaded", signals: response.signals });
        }
      } catch (signalError) {
        if (!cancelled) {
          dispatch({
            type: "errorSet",
            message: errorMessage(signalError, "Could not generate signals."),
          });
        }
      }
    }

    loadSignals();
    return () => {
      cancelled = true;
    };
  }, [activeTab, candleRequestWindow, lastValidDraft, selectedTicker, timeframe]);

  useEffect(() => {
    if (!dirty) {
      return;
    }

    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [dirty]);

  function confirmDiscardChanges() {
    return !dirty || window.confirm("You have unsaved changes — discard them?");
  }

  function openRecord(record: StrategyRecord) {
    const nextDraft = draftFromRecord(record);
    dispatch({
      type: "opened",
      opened: { id: record.id, draft: nextDraft, previewSpecs: specsFor(nextDraft) },
    });
    saveLastStrategySelection(String(record.id));
  }

  function openNew() {
    const nextDraft = createStrategyDraft(indicatorCatalog);
    dispatch({
      type: "opened",
      opened: { id: null, draft: nextDraft, previewSpecs: specsFor(nextDraft) },
    });
    saveLastStrategySelection("new");
  }

  function handleSelect(value: string) {
    if (!confirmDiscardChanges()) {
      return;
    }

    if (value === "new") {
      openNew();
      return;
    }

    const record = strategies.find((strategy) => strategy.id === Number(value));
    if (record) {
      openRecord(record);
    }
  }

  /**
   * Turns the current draft (including unsaved edits) into a new unsaved
   * strategy, leaving the stored original untouched. Saving then creates a
   * separate record.
   */
  function handleDuplicate() {
    if (!draft) {
      return;
    }

    const suffix = " (copy)";
    const base = draft.name.trim().slice(0, 80 - suffix.length);
    dispatch({ type: "duplicated", name: `${base}${suffix}` });
    saveLastStrategySelection("new");
  }

  async function handleValidate() {
    if (!draft) {
      return null;
    }

    dispatch({ type: "validateStarted" });
    try {
      const result = await validateStrategy(draft);
      dispatch({ type: "validated", result, draft, previewSpecs: specsFor(draft) });
      return result;
    } catch (validateError) {
      dispatch({
        type: "errorSet",
        message: errorMessage(validateError, "Could not validate the strategy."),
      });
      return null;
    } finally {
      dispatch({ type: "validateFinished" });
    }
  }

  async function handleSave() {
    if (!draft) {
      return;
    }

    const result = await handleValidate();
    if (!result?.valid) {
      return;
    }

    dispatch({ type: "saveStarted" });
    try {
      const record =
        state.selectedId == null
          ? await createStrategy(draft)
          : await updateStrategy(state.selectedId, draft);
      const nextDraft = draftFromRecord(record);
      dispatch({
        type: "saved",
        record,
        opened: { id: record.id, draft: nextDraft, previewSpecs: specsFor(nextDraft) },
        validation: result,
      });
      saveLastStrategySelection(String(record.id));
    } catch (saveError) {
      dispatch({
        type: "errorSet",
        message: errorMessage(saveError, "Could not save the strategy."),
      });
    } finally {
      dispatch({ type: "saveFinished" });
    }
  }

  async function handleDelete() {
    if (state.selectedId == null) {
      return;
    }

    const record = strategies.find((strategy) => strategy.id === state.selectedId);
    if (!window.confirm(`Delete strategy "${record?.name ?? state.selectedId}"?`)) {
      return;
    }

    dispatch({ type: "errorSet", message: null });
    try {
      await deleteStrategy(state.selectedId);
      dispatch({ type: "deleted", id: state.selectedId });
      openNew();
    } catch (deleteError) {
      dispatch({
        type: "errorSet",
        message: errorMessage(deleteError, "Could not delete the strategy."),
      });
    }
  }

  /** Confirms discarding edits when leaving the Strategies tab; false keeps the tab. */
  function handleLeaveTab() {
    if (!confirmDiscardChanges()) {
      return false;
    }

    const resetDraft = selectedRecord
      ? draftFromRecord(selectedRecord)
      : indicatorCatalog.length > 0
        ? createStrategyDraft(indicatorCatalog)
        : null;
    dispatch({ type: "leftStrategiesTab", draft: resetDraft });
    return true;
  }

  function updateIndicatorLineStyle(
    id: string,
    slotIndex: number,
    patch: Partial<IndicatorLineStyle>,
  ) {
    const spec = previewSpecs.find((candidate) => candidate.id === id);
    const definition = spec ? indicatorDefinitionsByKind.get(spec.kind) : undefined;
    dispatch({
      type: "previewStyleChanged",
      id,
      slotIndex,
      slotCount: definition ? definitionValueSlots(definition).length : slotIndex + 1,
      patch,
    });
  }

  return {
    ...state,
    selectedRecord,
    dirty,
    indicatorsForChart,
    handleSelect,
    handleDuplicate,
    registerSavedStrategy: (record: StrategyRecord) =>
      dispatch({ type: "recordRegistered", record }),
    handleDraftChange: (nextDraft: StrategyDraft) =>
      dispatch({ type: "draftChanged", draft: nextDraft }),
    handleValidate,
    handleSave,
    handleDelete,
    handleLeaveTab,
    updateIndicatorLineStyle,
  };
}
