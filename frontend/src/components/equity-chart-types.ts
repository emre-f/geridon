import type { IndicatorLineStyle } from "@/lib/api";

/** A buy-and-hold comparison line, already normalized to the run's starting capital. */
export interface EquityOverlay {
  id: string;
  label: string;
  style: IndicatorLineStyle;
  points: Array<{ timestamp_ms: number; value: number }>;
}
