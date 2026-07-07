import { Trash2Icon } from "lucide-react";

import type {
  IndicatorDefinition,
  IndicatorLineStyle,
  IndicatorParameterDefinition,
  IndicatorSpec,
} from "@/lib/api";
import {
  definitionValueSlots,
  indicatorShortLabel,
  normalizeLineStyles,
} from "@/lib/indicator-style";
import { cn } from "@/lib/utils";
import { ColorPicker } from "@/components/color-picker";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/ui/number-input";

export function IndicatorSettings({
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
  onUpdateParameter?: (
    id: string,
    parameter: IndicatorParameterDefinition,
    nextValue: number,
  ) => void;
  onUpdateLineStyle: (id: string, slotIndex: number, patch: Partial<IndicatorLineStyle>) => void;
  onRemove?: (id: string) => void;
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
        {onRemove ? (
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
        ) : null}
      </div>

      {definition.parameters.length > 0 ? (
        <div className="mt-2.5 flex flex-col gap-1.5">
          {definition.parameters.map((parameter) => (
            <label
              key={parameter.key}
              className="text-muted-foreground flex items-center justify-between gap-2 text-xs"
            >
              <span>{parameter.label}</span>
              {onUpdateParameter ? (
                <NumberInput
                  value={indicator.parameters[parameter.key] ?? parameter.default_value}
                  min={parameter.min}
                  max={parameter.max}
                  step={parameter.step}
                  className="h-8 w-24 px-2 text-xs"
                  aria-label={`${label} ${parameter.label}`}
                  onValueChange={(nextValue) =>
                    onUpdateParameter(indicator.id, parameter, nextValue)
                  }
                />
              ) : (
                <span className="text-foreground tabular-nums">
                  {indicator.parameters[parameter.key] ?? parameter.default_value}
                </span>
              )}
            </label>
          ))}
        </div>
      ) : null}

      <div className="border-border mt-2.5 flex flex-col gap-1.5 border-t pt-2.5">
        {valueSlots.map((valueDefinition, slotIndex) => {
          const lineStyle = lineStyles[slotIndex];
          if (valueDefinition.style === "none") {
            return null;
          }

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
