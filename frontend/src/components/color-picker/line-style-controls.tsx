import { useState } from "react";

import type { IndicatorLineStroke, IndicatorLineStyle } from "@/lib/api";
import {
  clampLineOpacity,
  lineStrokes,
  lineWidths,
  minLineOpacity,
  strokeDashArray,
} from "@/lib/indicator-style";
import { cn } from "@/lib/utils";
import { useDebouncedCommit } from "@/hooks/use-debounced-commit";
import {
  lineOptionClass,
  selectedControlClass,
} from "@/components/color-picker/styles";

export type LineStyleValue = Omit<IndicatorLineStyle, "color">;

const commitDelayMs = 400;

const strokeLabels: Record<IndicatorLineStroke, string> = {
  solid: "Solid line",
  dashed: "Dashed line",
  dotted: "Dotted line",
};

function LinePreview({ stroke, width }: { stroke: IndicatorLineStroke; width: number }) {
  return (
    <svg viewBox="0 0 28 10" className="h-2.5 w-7" aria-hidden="true">
      <line
        x1="2"
        y1="5"
        x2="26"
        y2="5"
        stroke="currentColor"
        strokeWidth={width}
        strokeLinecap="round"
        strokeDasharray={strokeDashArray(stroke, width)}
      />
    </svg>
  );
}

export function LineStyleControls({
  value,
  onChange,
  showStroke,
}: {
  value: LineStyleValue;
  onChange: (patch: Partial<LineStyleValue>) => void;
  showStroke: boolean;
}) {
  const [draftOpacity, setDraftOpacity] = useState<number | null>(null);
  const { schedule, flush } = useDebouncedCommit<number>(
    (opacity) => onChange({ opacity }),
    commitDelayMs,
  );
  const displayOpacity = draftOpacity ?? value.opacity;

  return (
    <div className="border-border mt-2.5 flex flex-col gap-2 border-t pt-2.5">
      {showStroke ? (
        <>
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground w-12 shrink-0 text-xs">Style</span>
            {lineStrokes.map((stroke) => (
              <button
                key={stroke}
                type="button"
                className={cn(lineOptionClass, value.stroke === stroke && selectedControlClass)}
                aria-label={strokeLabels[stroke]}
                aria-pressed={value.stroke === stroke}
                title={strokeLabels[stroke]}
                onClick={() => onChange({ stroke })}
              >
                <LinePreview stroke={stroke} width={2} />
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground w-12 shrink-0 text-xs">Width</span>
            {lineWidths.map((width) => (
              <button
                key={width}
                type="button"
                className={cn(lineOptionClass, value.width === width && selectedControlClass)}
                aria-label={`Line width ${width}`}
                aria-pressed={value.width === width}
                title={`${width}pt`}
                onClick={() => onChange({ width })}
              >
                <LinePreview stroke="solid" width={width} />
              </button>
            ))}
          </div>
        </>
      ) : null}
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground w-12 shrink-0 text-xs">Opacity</span>
        <input
          type="range"
          min={minLineOpacity * 100}
          max={100}
          step={5}
          value={Math.round(displayOpacity * 100)}
          className="min-w-0 flex-1 cursor-pointer accent-[var(--primary)]"
          aria-label="Line opacity"
          onChange={(event) => {
            const opacity = clampLineOpacity(Number(event.target.value) / 100);
            setDraftOpacity(opacity);
            schedule(opacity);
          }}
          onPointerUp={flush}
          onBlur={flush}
        />
        <span className="text-muted-foreground w-9 shrink-0 text-right text-xs tabular-nums">
          {Math.round(displayOpacity * 100)}%
        </span>
      </div>
    </div>
  );
}
