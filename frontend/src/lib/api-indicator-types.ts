// Open-ended so new indicators only need a backend catalog entry; validity is
// checked against the fetched catalog, not the type system.
export type IndicatorKind = string;

export type IndicatorPlacement = "overlay" | "pane" | "volume";

export type IndicatorValueStyle = "line" | "histogram" | "none";

export interface IndicatorParameterDefinition {
  key: string;
  label: string;
  default_value: number;
  min: number;
  max: number;
  step: number;
}

export interface IndicatorValueDefinition {
  key: string;
  label: string;
  description?: string;
  style: IndicatorValueStyle;
}

export interface IndicatorDefinition {
  kind: IndicatorKind;
  label: string;
  full_name: string;
  description: string;
  placement: IndicatorPlacement;
  parameters: IndicatorParameterDefinition[];
  values: IndicatorValueDefinition[];
}

export type IndicatorLineStroke = "solid" | "dashed" | "dotted";

export interface IndicatorLineStyle {
  color: string;
  stroke: IndicatorLineStroke;
  width: number;
  opacity: number;
}

export interface IndicatorSpec {
  id: string;
  kind: IndicatorKind;
  parameters: Record<string, number>;
  styles?: IndicatorLineStyle[];
}

export interface IndicatorPoint {
  timestamp_ms: number;
  timestamp: string;
  values: Record<string, number | null>;
}

export interface IndicatorSeries {
  id: string;
  kind: IndicatorKind;
  label: string;
  placement: IndicatorPlacement;
  parameters: Record<string, number>;
  styles?: IndicatorLineStyle[];
  values: IndicatorValueDefinition[];
  points: IndicatorPoint[];
}
