import type { SymbolSummary } from "@/lib/api";
import type { SymbolContextMenu } from "@/lib/app-types";

export interface SymbolManagerState {
  symbols: SymbolSummary[];
  selectedTicker: string;
  symbolFilter: string;
  symbolsLoading: boolean;
  addPanelOpen: boolean;
  addTickerInput: string;
  addingSymbol: boolean;
  deletingTicker: string | null;
  contextMenu: SymbolContextMenu | null;
}

export const initialSymbolManagerState: SymbolManagerState = {
  symbols: [],
  selectedTicker: "",
  symbolFilter: "",
  symbolsLoading: true,
  addPanelOpen: false,
  addTickerInput: "",
  addingSymbol: false,
  deletingTicker: null,
  contextMenu: null,
};

export type SymbolManagerAction =
  | { type: "symbolsLoaded"; symbols: SymbolSummary[]; selectedTicker: string }
  | { type: "loadFinished" }
  | { type: "tickerSelected"; ticker: string }
  | { type: "filterChanged"; value: string }
  | { type: "addPanelToggled"; open: boolean }
  | { type: "addInputChanged"; value: string }
  | { type: "addStarted" }
  | { type: "addSucceeded" }
  | { type: "addFinished" }
  | { type: "deleteStarted"; ticker: string }
  | { type: "deleteFinished" }
  | { type: "contextMenuOpened"; menu: SymbolContextMenu }
  | { type: "contextMenuClosed" };

export function symbolManagerReducer(
  state: SymbolManagerState,
  action: SymbolManagerAction,
): SymbolManagerState {
  switch (action.type) {
    case "symbolsLoaded":
      return { ...state, symbols: action.symbols, selectedTicker: action.selectedTicker };
    case "loadFinished":
      return { ...state, symbolsLoading: false };
    case "tickerSelected":
      return { ...state, selectedTicker: action.ticker };
    case "filterChanged":
      return { ...state, symbolFilter: action.value };
    case "addPanelToggled":
      return { ...state, addPanelOpen: action.open };
    case "addInputChanged":
      return { ...state, addTickerInput: action.value };
    case "addStarted":
      return { ...state, addingSymbol: true };
    case "addSucceeded":
      return { ...state, addTickerInput: "", addPanelOpen: false };
    case "addFinished":
      return { ...state, addingSymbol: false };
    case "deleteStarted":
      return { ...state, deletingTicker: action.ticker, contextMenu: null };
    case "deleteFinished":
      return { ...state, deletingTicker: null };
    case "contextMenuOpened":
      return { ...state, contextMenu: action.menu };
    case "contextMenuClosed":
      return state.contextMenu == null ? state : { ...state, contextMenu: null };
  }
}
