import { useEffect, useMemo, useRef, useState } from "react";

import type {
  IndicatorDefinition,
  IndicatorKind,
  IndicatorLineStyle,
  IndicatorParameterDefinition,
  IndicatorSeries,
  IndicatorSpec,
} from "@/lib/api";
import { formatCompact, formatCurrency } from "@/lib/format";
import {
  definitionValueSlots,
  indicatorShortLabel,
  normalizeLineStyles,
} from "@/lib/indicator-style";
import { cn } from "@/lib/utils";
import { IndicatorSettings } from "@/components/indicator-settings";

// Hoisted: Intl constructors are expensive to rebuild per legend value.
const preciseLegendFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 });
const roundedLegendFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

function formatLegendValue(value: number, placement: IndicatorDefinition["placement"]) {
  if (placement === "overlay") {
    return formatCurrency(value);
  }
  if (placement === "volume") {
    return formatCompact(value);
  }

  return (Math.abs(value) < 10 ? preciseLegendFormat : roundedLegendFormat).format(value);
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
  onUpdateParameter?: (
    id: string,
    parameter: IndicatorParameterDefinition,
    nextValue: number,
  ) => void;
  onUpdateLineStyle?: (id: string, slotIndex: number, patch: Partial<IndicatorLineStyle>) => void;
  onRemove?: (id: string) => void;
  className?: string;
}) {
  const [openChipId, setOpenId] = useState<string | null>(null);
  // Derived rather than reset in an effect: a remembered id whose indicator
  // was removed simply stops matching, so the settings panel closes itself.
  const openId =
    openChipId != null && indicators.some((indicator) => indicator.id === openChipId)
      ? openChipId
      : null;
  // Chips are interactive whenever line styles are editable; parameter and
  // remove controls appear only when their callbacks are provided.
  const interactive = Boolean(onUpdateLineStyle);
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
        // Values with style "none" carry no drawn line, so the chip dot shows
        // the first slot that actually appears on the chart.
        const dotSlotIndex = Math.max(
          valueSlots.findIndex((valueDefinition) => valueDefinition.style !== "none"),
          0,
        );
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
              !interactive && "cursor-default hover:bg-card/80",
              open && "bg-muted",
            )}
            aria-expanded={open}
            aria-label={interactive ? `${definition.full_name} settings` : definition.full_name}
            title={interactive ? `${definition.full_name} — click to edit` : definition.full_name}
            onClick={() => {
              if (interactive) {
                setOpenId(open ? null : indicator.id);
              }
            }}
          >
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: lineStyles[dotSlotIndex].color }}
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

      {openIndicator && openDefinition && onUpdateLineStyle ? (
        // Anchored beside the whole chip stack so it never covers other chips.
        <IndicatorSettings
          className="pointer-events-auto absolute left-[calc(100%+0.5rem)] top-0 z-40"
          indicator={openIndicator}
          definition={openDefinition}
          indicatorIndex={openIndicatorIndex}
          onUpdateParameter={onUpdateParameter}
          onUpdateLineStyle={onUpdateLineStyle}
          onRemove={
            onRemove
              ? (id) => {
                  onRemove(id);
                  setOpenId(null);
                }
              : undefined
          }
        />
      ) : null}
    </div>
  );
}
