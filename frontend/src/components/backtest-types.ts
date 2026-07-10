import type { IndicatorLineStyle } from "@/lib/api";

export interface ComparisonSlot {
  id: string;
  ticker: string;
  visible: boolean;
  style: IndicatorLineStyle;
}

export type BenchmarkId = "hold-self" | "optimal";

/** A built-in benchmark overlay (derived from the backtested ticker itself). */
export interface BenchmarkView {
  id: BenchmarkId;
  label: string;
  title?: string;
  visible: boolean;
  style: IndicatorLineStyle;
}
