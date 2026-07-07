import {
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type FormEvent,
  type MouseEvent,
  type RefObject,
} from "react";

import {
  deleteSymbol,
  listSymbols,
  syncCandles,
  validateSymbol,
  type SymbolSummary,
} from "@/lib/api";
import {
  loadLastTicker,
  pullChartStates,
  removeChartState,
  saveLastTicker,
} from "@/lib/chart-state";
import {
  initialSymbolManagerState,
  symbolManagerReducer,
} from "@/hooks/symbol-manager-state";

const defaultTicker = "SPY";
const visibleSymbolLimit = 80;

/** Chart-side reactions to symbol changes; wired through a ref because the chart hook runs after this one. */
export interface SymbolChartBridge {
  prepareForSymbol: (symbol: SymbolSummary) => void;
  restoreChartState: (symbol: SymbolSummary) => void;
  clearCandleData: () => void;
}

interface SymbolManagerOptions {
  chartBridge: RefObject<SymbolChartBridge | null>;
  onError: (message: string | null) => void;
}

function defaultSymbol(symbols: SymbolSummary[]) {
  return symbols.find((symbol) => symbol.ticker === defaultTicker) ?? symbols[0];
}

/** Owns the symbol sidebar: stored symbols, selection, add/delete flows, and the context menu. */
export function useSymbolManager({ chartBridge, onError }: SymbolManagerOptions) {
  const [state, dispatch] = useReducer(symbolManagerReducer, initialSymbolManagerState);
  const { symbols, selectedTicker, symbolFilter, addPanelOpen, addTickerInput, contextMenu } = state;
  const addPanelRef = useRef<HTMLDivElement | null>(null);
  const addTickerInputRef = useRef<HTMLInputElement | null>(null);

  const selectedSymbol = useMemo(
    () => symbols.find((symbol) => symbol.ticker === selectedTicker),
    [selectedTicker, symbols],
  );
  const filteredSymbols = useMemo(() => {
    const normalized = symbolFilter.toUpperCase().trim();
    return normalized ? symbols.filter((symbol) => symbol.ticker.includes(normalized)) : symbols;
  }, [symbolFilter, symbols]);
  const visibleSymbols = filteredSymbols.slice(0, visibleSymbolLimit);

  useEffect(() => {
    if (selectedTicker) {
      saveLastTicker(selectedTicker);
    }
  }, [selectedTicker]);

  useEffect(() => {
    let cancelled = false;

    async function loadSymbols() {
      onError(null);

      try {
        // Merge chart states stored in the backend DB into localStorage first
        // so restoring chart state picks them up even after a storage wipe.
        const [nextSymbols] = await Promise.all([listSymbols(), pullChartStates()]);
        if (cancelled) {
          return;
        }

        const lastTicker = loadLastTicker();
        const nextDefaultSymbol =
          (lastTicker ? nextSymbols.find((symbol) => symbol.ticker === lastTicker) : undefined) ??
          defaultSymbol(nextSymbols);
        dispatch({
          type: "symbolsLoaded",
          symbols: nextSymbols,
          selectedTicker: nextDefaultSymbol?.ticker ?? "",
        });
        if (nextDefaultSymbol) {
          chartBridge.current?.prepareForSymbol(nextDefaultSymbol);
        }
      } catch (loadError) {
        if (!cancelled) {
          onError(loadError instanceof Error ? loadError.message : "Could not load symbols.");
        }
      } finally {
        if (!cancelled) {
          dispatch({ type: "loadFinished" });
        }
      }
    }

    loadSymbols();
    return () => {
      cancelled = true;
    };
    // chartBridge is a ref and onError a stable setter, so this still runs once.
  }, [chartBridge, onError]);

  useEffect(() => {
    if (!addPanelOpen) {
      return;
    }

    addTickerInputRef.current?.focus();

    function handlePointerDown(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        addPanelRef.current &&
        !addPanelRef.current.contains(event.target)
      ) {
        dispatch({ type: "addPanelToggled", open: false });
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        dispatch({ type: "addPanelToggled", open: false });
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [addPanelOpen]);

  useEffect(() => {
    if (!contextMenu) {
      return;
    }

    function closeContextMenu() {
      dispatch({ type: "contextMenuClosed" });
    }

    function closeContextMenuOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        dispatch({ type: "contextMenuClosed" });
      }
    }

    window.addEventListener("click", closeContextMenu);
    window.addEventListener("scroll", closeContextMenu, true);
    window.addEventListener("keydown", closeContextMenuOnEscape);
    return () => {
      window.removeEventListener("click", closeContextMenu);
      window.removeEventListener("scroll", closeContextMenu, true);
      window.removeEventListener("keydown", closeContextMenuOnEscape);
    };
  }, [contextMenu]);

  async function loadSymbolList(preferredTicker?: string) {
    const nextSymbols = await listSymbols();
    const nextSymbol =
      (preferredTicker
        ? nextSymbols.find((symbol) => symbol.ticker === preferredTicker)
        : undefined) ??
      nextSymbols.find((symbol) => symbol.ticker === selectedTicker) ??
      defaultSymbol(nextSymbols);

    dispatch({
      type: "symbolsLoaded",
      symbols: nextSymbols,
      selectedTicker: nextSymbol?.ticker ?? "",
    });
    if (nextSymbol) {
      chartBridge.current?.prepareForSymbol(nextSymbol);
    } else {
      chartBridge.current?.clearCandleData();
    }

    return nextSymbols;
  }

  function selectSymbol(symbol: SymbolSummary) {
    if (symbol.ticker !== selectedTicker) {
      chartBridge.current?.restoreChartState(symbol);
    }
    dispatch({ type: "tickerSelected", ticker: symbol.ticker });
    dispatch({ type: "contextMenuClosed" });
    onError(null);
  }

  function openSymbolContextMenu(event: MouseEvent<HTMLButtonElement>, ticker: string) {
    event.preventDefault();
    const menuWidth = 176;
    const menuHeight = 44;

    dispatch({
      type: "contextMenuOpened",
      menu: {
        ticker,
        x: Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth - 8)),
        y: Math.max(8, Math.min(event.clientY, window.innerHeight - menuHeight - 8)),
      },
    });
  }

  async function handleDeleteSymbol(ticker: string) {
    if (!window.confirm(`Delete ${ticker} and all related candle data?`)) {
      dispatch({ type: "contextMenuClosed" });
      return;
    }

    dispatch({ type: "deleteStarted", ticker });
    onError(null);

    try {
      await deleteSymbol(ticker);
      removeChartState(ticker);
      await loadSymbolList();
      if (ticker === selectedTicker) {
        chartBridge.current?.clearCandleData();
      }
    } catch (deleteError) {
      onError(deleteError instanceof Error ? deleteError.message : `Could not delete ${ticker}.`);
    } finally {
      dispatch({ type: "deleteFinished" });
    }
  }

  async function handleAddSymbolSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = addTickerInput.toUpperCase().trim();

    if (!normalized) {
      onError("Enter a ticker to add.");
      return;
    }

    const exactMatch = symbols.find((symbol) => symbol.ticker === normalized);
    if (exactMatch) {
      selectSymbol(exactMatch);
      dispatch({ type: "addSucceeded" });
      return;
    }

    dispatch({ type: "addStarted" });
    onError(null);

    try {
      const validation = await validateSymbol(normalized);
      if (!validation.valid) {
        throw new Error(`No Yahoo Finance data found for ${normalized}.`);
      }

      const end = new Date();
      const dailyStart = new Date(end);
      dailyStart.setUTCFullYear(dailyStart.getUTCFullYear() - 5);
      const hourlyStart = new Date(end);
      hourlyStart.setUTCFullYear(hourlyStart.getUTCFullYear() - 1);

      const dailyResult = await syncCandles({
        ticker: normalized,
        timeframe: "1d",
        start: dailyStart.toISOString(),
        end: end.toISOString(),
      });
      if (dailyResult.candles_received === 0 && dailyResult.candles_inserted === 0) {
        throw new Error(`No Yahoo Finance candles returned for ${normalized}.`);
      }

      await syncCandles({
        ticker: normalized,
        timeframe: "1h",
        start: hourlyStart.toISOString(),
        end: end.toISOString(),
      }).catch(() => null);

      const nextSymbols = await loadSymbolList(normalized);
      if (!nextSymbols.some((symbol) => symbol.ticker === normalized)) {
        throw new Error(`Could not add ${normalized} to stored symbols.`);
      }

      dispatch({ type: "addSucceeded" });
    } catch (addError) {
      onError(addError instanceof Error ? addError.message : `Could not add ${normalized}.`);
    } finally {
      dispatch({ type: "addFinished" });
    }
  }

  /** Remounts the chart for the current ticker by briefly clearing the selection. */
  function refresh() {
    if (!selectedTicker) {
      return;
    }

    const ticker = selectedTicker;
    dispatch({ type: "tickerSelected", ticker: "" });
    globalThis.requestAnimationFrame(() => dispatch({ type: "tickerSelected", ticker }));
  }

  return {
    ...state,
    selectedSymbol,
    filteredSymbols,
    visibleSymbols,
    addPanelRef,
    addTickerInputRef,
    setSymbolFilter: (value: string) => dispatch({ type: "filterChanged", value }),
    setAddTickerInput: (value: string) => dispatch({ type: "addInputChanged", value }),
    setAddPanelOpen: (open: boolean | ((current: boolean) => boolean)) =>
      dispatch({
        type: "addPanelToggled",
        open: typeof open === "function" ? open(state.addPanelOpen) : open,
      }),
    selectSymbol,
    openSymbolContextMenu,
    handleDeleteSymbol,
    handleAddSymbolSubmit,
    refresh,
  };
}
