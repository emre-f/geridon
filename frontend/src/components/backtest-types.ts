import type { IndicatorLineStyle } from "@/lib/api";

export interface ComparisonSlot {
  id: string;
  ticker: string;
  visible: boolean;
  style: IndicatorLineStyle;
}
