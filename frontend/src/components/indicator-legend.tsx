import { useEffect, useMemo, useRef, useState } from "react";
import { Trash2Icon } from "lucide-react";

import type {
  IndicatorDefinition,
  IndicatorKind,
  IndicatorLineStyle,
  IndicatorParameterDefinition,
  IndicatorSeries,
  IndicatorSpec,
} from "@/lib/api";
import { formatCurrency } from "@/lib/format";
import {
  definitionValueSlots,
  indicatorShortLabel,
  normalizeLineStyles,
} from "@/lib/indicator-style";
import { cn } from "@/lib/utils";
import { ColorPicker } from "@/components/color-picker";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/ui/number-input";

function formatLegendValue(value: number, placement: IndicatorDefinition["placement"]) {
  if (placement === "overlay") {
    return formatCurrency(value);
  }

  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: Math.abs(value) < 10 ? 4 : 2,
  }).format(value);
}

/**
 * Compact indicator chips overlaid on the chart's top-left corner. Each chip
 * shows the indicator's short label and its values at the hovered candle (or
 * the latest visible candle); clicking a chip opens its settings.
 */
export function IndicatorLegend({
  indicators,
  definitionsByKind,
  series,
  valueTimestampMs,
  onUpdateParameter,
  onUpdateLineStyle,
  onRemove,
  className,
}: {
  indicators: IndicatorSpec[];
  definitionsByKind: Map<IndicatorKind, IndicatorDefinition>;
  series: IndicatorSeries[];
  valueTimestampMs: number | null;
  onUpdateParameter: (
    id: string,
    parameter: IndicatorParameterDefinition,
    nextValue: number,
  ) => void;
  onUpdateLineStyle: (id: string, slotIndex: number, patch: Partial<IndicatorLineStyle>) => void;
  onRemove: (id: string) => void;
  className?: string;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const valueMapsById = useMemo(
    () =>
      new Map(
        series.map((item) => [
          item.id,
          new Map(item.points.map((point) => [point.timestamp_ms, point.values])),
        ]),
      ),
    [series],
  );

  useEffect(() => {
    if (openId && !indicators.some((indicator) => indicator.id === openId)) {
      setOpenId(null);
    }
  }, [indicators, openId]);

  useEffect(() => {
    if (!openId) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        rootRef.current &&
        !rootRef.current.contains(event.target)
      ) {
        setOpenId(null);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenId(null);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [openId]);

  if (indicators.length === 0) {
    return null;
  }

  const openIndicatorIndex = indicators.findIndex((indicator) => indicator.id === openId);
  const openIndicator = openIndicatorIndex === -1 ? null : indicators[openIndicatorIndex];
  const openDefinition = openIndicator ? definitionsByKind.get(openIndicator.kind) : undefined;

  return (
    <div
      ref={rootRef}
      className={cn("pointer-events-none relative flex flex-col items-start", className)}
    >
      {indicators.map((indicator, indicatorIndex) => {
        const definition = definitionsByKind.get(indicator.kind);
        if (!definition) {
          return null;
        }

        const valueSlots = definitionValueSlots(definition);
        const lineStyles = normalizeLineStyles(indicator.styles, valueSlots.length, indicatorIndex);
        const label = indicatorShortLabel(definition, indicator.parameters);
        const values =
          valueTimestampMs == null
            ? undefined
            : valueMapsById.get(indicator.id)?.get(valueTimestampMs);
        const open = openId === indicator.id;

        return (
          <button
            key={indicator.id}
            type="button"
            className={cn(
              "bg-card/80 hover:bg-muted pointer-events-auto flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[11px] leading-4 backdrop-blur-[2px] transition-colors",
              open && "bg-muted",
            )}
            aria-expanded={open}
            aria-label={`${definition.full_name} settings`}
            title={`${definition.full_name} — click to edit`}
            onClick={() => setOpenId(open ? null : indicator.id)}
          >
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: lineStyles[0].color }}
              aria-hidden="true"
            />
            <span className="text-foreground font-medium">{label}</span>
            {valueSlots.map((valueDefinition, slotIndex) => {
              const value = values?.[valueDefinition.key];

              return (
                <span
                  key={valueDefinition.key}
                  className="tabular-nums"
                  style={{ color: lineStyles[slotIndex].color }}
                >
                  {typeof value === "number" && Number.isFinite(value)
                    ? formatLegendValue(value, definition.placement)
                    : "–"}
                </span>
              );
            })}
          </button>
        );
      })}

      {openIndicator && openDefinition ? (
        // Anchored beside the whole chip stack so it never covers other chips.
        <IndicatorSettings
          className="pointer-events-auto absolute left-[calc(100%+0.5rem)] top-0 z-40"
          indicator={openIndicator}
          definition={openDefinition}
          indicatorIndex={openIndicatorIndex}
          onUpdateParameter={onUpdateParameter}
          onUpdateLineStyle={onUpdateLineStyle}
          onRemove={(id) => {
            onRemove(id);
            setOpenId(null);
          }}
        />
      ) : null}
    </div>
  );
}

function IndicatorSettings({
  indicator,
  definition,
  indicatorIndex,
  onUpdateParameter,
  onUpdateLineStyle,
  onRemove,
  className,
}: {
  indicator: IndicatorSpec;
  definition: IndicatorDefinition;
  indicatorIndex: number;
  onUpdateParameter: (
    id: string,
    parameter: IndicatorParameterDefinition,
    nextValue: number,
  ) => void;
  onUpdateLineStyle: (id: string, slotIndex: number, patch: Partial<IndicatorLineStyle>) => void;
  onRemove: (id: string) => void;
  className?: string;
}) {
  const valueSlots = definitionValueSlots(definition);
  const lineStyles = normalizeLineStyles(indicator.styles, valueSlots.length, indicatorIndex);
  const label = indicatorShortLabel(definition, indicator.parameters);

  return (
    <div
      className={cn(
        "border-border bg-popover text-popover-foreground w-60 rounded-md border p-2.5 shadow-lg",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-medium leading-tight">{label}</div>
          <div className="text-muted-foreground text-xs">{definition.full_name}</div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="text-destructive hover:text-destructive size-7 shrink-0"
          aria-label={`Remove ${label}`}
          title={`Remove ${label}`}
          onClick={() => onRemove(indicator.id)}
        >
          <Trash2Icon className="size-4" />
        </Button>
      </div>

      {definition.parameters.length > 0 ? (
        <div className="mt-2.5 flex flex-col gap-1.5">
          {definition.parameters.map((parameter) => (
            <label
              key={parameter.key}
              className="text-muted-foreground flex items-center justify-between gap-2 text-xs"
            >
              <span>{parameter.label}</span>
              <NumberInput
                value={indicator.parameters[parameter.key] ?? parameter.default_value}
                min={parameter.min}
                max={parameter.max}
                step={parameter.step}
                className="h-8 w-24 px-2 text-xs"
                aria-label={`${label} ${parameter.label}`}
                onValueChange={(nextValue) => onUpdateParameter(indicator.id, parameter, nextValue)}
              />
            </label>
          ))}
        </div>
      ) : null}

      <div className="border-border mt-2.5 flex flex-col gap-1.5 border-t pt-2.5">
        {valueSlots.map((valueDefinition, slotIndex) => {
          const lineStyle = lineStyles[slotIndex];

          return (
            <div
              key={valueDefinition.key}
              className="text-muted-foreground flex items-center justify-between gap-2 text-xs"
            >
              <span>{valueSlots.length > 1 ? valueDefinition.label : "Color"}</span>
              <ColorPicker
                value={lineStyle.color}
                ariaLabel={`${label} ${valueDefinition.label} color and line style`}
                lineStyle={{
                  stroke: lineStyle.stroke,
                  width: lineStyle.width,
                  opacity: lineStyle.opacity,
                }}
                showStrokeControls={valueDefinition.style === "line"}
                onChange={(color) => onUpdateLineStyle(indicator.id, slotIndex, { color })}
                onLineStyleChange={(patch) => onUpdateLineStyle(indicator.id, slotIndex, patch)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
