export type AppTab = "charts" | "strategies" | "backtest" | "optimize" | "signals";

export interface SymbolContextMenu {
  ticker: string;
  x: number;
  y: number;
}
