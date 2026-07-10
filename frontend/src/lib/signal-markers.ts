import type { StrategySignal } from "@/lib/api";

export const signalSideFill: Record<StrategySignal["side"], string> = {
  buy: "var(--chart-up)",
  sell: "var(--chart-down)",
  cash: "var(--muted-foreground)",
};

export const signalSideLabel: Record<StrategySignal["side"], string> = {
  buy: "Buy",
  sell: "Sell",
  cash: "Cash",
};
