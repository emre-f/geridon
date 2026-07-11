export type AppTab = "charts" | "strategies" | "backtest" | "optimize";

export interface SymbolContextMenu {
  ticker: string;
  x: number;
  y: number;
}
