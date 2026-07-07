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

export interface IndicatorSpec {
  id?: string;
  kind: IndicatorKind;
  parameters?: Record<string, number>;
}

export interface IndicatorPointResponse {
  timestamp_ms: number;
  timestamp: string;
  values: Record<string, number | null>;
}

export interface IndicatorSeriesResponse {
  id: string;
  kind: IndicatorKind;
  label: string;
  placement: IndicatorPlacement;
  parameters: Record<string, number>;
  values: IndicatorValueDefinition[];
  points: IndicatorPointResponse[];
}
