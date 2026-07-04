import type {
  IndicatorDefinition,
  IndicatorLineStroke,
  IndicatorLineStyle,
  IndicatorValueDefinition,
} from "@/lib/api";
import { isHexColor, paletteColorAt } from "@/lib/color-palette";

export const fallbackValueDefinition: IndicatorValueDefinition = {
  key: "value",
  label: "Color",
  style: "line",
};

/** Line slots for an indicator; falls back to one slot if a stale backend catalog omits them. */
export function definitionValueSlots(definition: IndicatorDefinition) {
  return definition.values?.length ? definition.values : [fallbackValueDefinition];
}

/** Compact chart label, e.g. "SMA 20" or "MACD 12/26/9"; mirrors the backend series label. */
export function indicatorShortLabel(
  definition: IndicatorDefinition,
  parameters: Record<string, number>,
) {
  const parameterText = definition.parameters
    .map((parameter) => parameters[parameter.key] ?? parameter.default_value)
    .join("/");

  return parameterText ? `${definition.label} ${parameterText}` : definition.label;
}

export const lineStrokes: IndicatorLineStroke[] = ["solid", "dashed", "dotted"];
export const lineWidths = [1, 2, 3, 4];
export const minLineOpacity = 0.1;
export const maxLineOpacity = 1;

export function isLineStroke(value: unknown): value is IndicatorLineStroke {
  return lineStrokes.includes(value as IndicatorLineStroke);
}

export function clampLineWidth(value: number) {
  return Math.min(Math.max(Math.round(value), lineWidths[0]), lineWidths[lineWidths.length - 1]);
}

export function clampLineOpacity(value: number) {
  return Math.min(Math.max(value, minLineOpacity), maxLineOpacity);
}

export function defaultLineStyle(paletteIndex: number): IndicatorLineStyle {
  return {
    color: paletteColorAt(paletteIndex),
    stroke: "solid",
    width: 2,
    opacity: 1,
  };
}

export function sanitizeLineStyle(value: unknown, fallback: IndicatorLineStyle): IndicatorLineStyle {
  if (typeof value !== "object" || value == null) {
    return fallback;
  }

  const { color, stroke, width, opacity } = value as Record<string, unknown>;
  return {
    color: isHexColor(color) ? color.toLowerCase() : fallback.color,
    stroke: isLineStroke(stroke) ? stroke : fallback.stroke,
    width:
      typeof width === "number" && Number.isFinite(width)
        ? clampLineWidth(width)
        : fallback.width,
    opacity:
      typeof opacity === "number" && Number.isFinite(opacity)
        ? clampLineOpacity(opacity)
        : fallback.opacity,
  };
}

/** Pads or trims an indicator's line styles to one style per value slot. */
export function normalizeLineStyles(
  styles: IndicatorLineStyle[] | undefined,
  slotCount: number,
  indicatorIndex: number,
): IndicatorLineStyle[] {
  return Array.from({ length: slotCount }, (_, slotIndex) =>
    sanitizeLineStyle(styles?.[slotIndex], defaultLineStyle(indicatorIndex + slotIndex)),
  );
}

/** SVG stroke-dasharray for a stroke style, scaled to the line width. */
export function strokeDashArray(stroke: IndicatorLineStroke, width: number) {
  switch (stroke) {
    case "dashed":
      return `${width * 4} ${width * 2.5}`;
    case "dotted":
      return `0.1 ${width * 2.2}`;
    default:
      return undefined;
  }
}
