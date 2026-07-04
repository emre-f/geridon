import { useCallback, useEffect, useRef, useState } from "react";
import { CheckIcon, PencilIcon, PlusIcon, XIcon } from "lucide-react";

import type { IndicatorLineStroke, IndicatorLineStyle } from "@/lib/api";
import {
  addPaletteColor,
  isHexColor,
  maxPaletteColors,
  minPaletteColors,
  removePaletteColor,
  updatePaletteColor,
  usePaletteColors,
} from "@/lib/color-palette";
import {
  clampLineOpacity,
  lineStrokes,
  lineWidths,
  minLineOpacity,
  strokeDashArray,
} from "@/lib/indicator-style";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export type LineStyleValue = Omit<IndicatorLineStyle, "color">;

const commitDelayMs = 400;

/**
 * Native color inputs fire change events continuously while dragging in some
 * browsers. Drafts stay in local state so only the swatch re-renders; commits
 * are debounced and flushed on blur/unmount.
 */
function useDebouncedCommit<T>(commit: (value: T) => void) {
  const timeoutRef = useRef<number | undefined>(undefined);
  const pendingRef = useRef<{ value: T } | null>(null);
  const commitRef = useRef(commit);
  commitRef.current = commit;

  const flush = useCallback(() => {
    window.clearTimeout(timeoutRef.current);
    if (pendingRef.current != null) {
      const { value } = pendingRef.current;
      pendingRef.current = null;
      commitRef.current(value);
    }
  }, []);

  const schedule = useCallback(
    (value: T) => {
      pendingRef.current = { value };
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = window.setTimeout(flush, commitDelayMs);
    },
    [flush],
  );

  useEffect(() => flush, [flush]);

  return { schedule, flush };
}

function EditablePaletteSwatch({
  index,
  color,
  canDelete,
}: {
  index: number;
  color: string;
  canDelete: boolean;
}) {
  const [draftColor, setDraftColor] = useState<string | null>(null);
  const { schedule, flush } = useDebouncedCommit<string>((nextColor) =>
    updatePaletteColor(index, nextColor),
  );
  const displayColor = draftColor ?? color;

  return (
    <div className="relative">
      <label
        className="border-input relative flex size-8 cursor-pointer items-center justify-center rounded-md border bg-background shadow-xs transition-[border-color,box-shadow] hover:border-ring/60"
        title={`Edit saved color ${displayColor}`}
      >
        <span
          className="border-border size-5 rounded-sm border"
          style={{ backgroundColor: displayColor }}
          aria-hidden="true"
        />
        <input
          type="color"
          value={displayColor}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          aria-label={`Edit saved color ${index + 1}`}
          onChange={(event) => {
            if (isHexColor(event.target.value)) {
              setDraftColor(event.target.value.toLowerCase());
              schedule(event.target.value.toLowerCase());
            }
          }}
          onBlur={flush}
        />
      </label>
      {canDelete ? (
        <button
          type="button"
          className="bg-destructive absolute -right-1.5 -top-1.5 flex size-4 items-center justify-center rounded-full text-white shadow-xs transition-transform hover:scale-110"
          aria-label={`Delete saved color ${displayColor}`}
          title="Delete saved color"
          onClick={() => removePaletteColor(index)}
        >
          <XIcon className="size-2.5" />
        </button>
      ) : null}
    </div>
  );
}

function AddPaletteSwatch({
  initialColor,
  onPicked,
}: {
  initialColor: string;
  onPicked: (color: string) => void;
}) {
  const [draftColor, setDraftColor] = useState<string | null>(null);
  const addedIndexRef = useRef<number | null>(null);
  const { schedule, flush } = useDebouncedCommit<string>((color) => {
    if (addedIndexRef.current == null) {
      addedIndexRef.current = addPaletteColor(color);
    } else {
      updatePaletteColor(addedIndexRef.current, color);
    }
    onPicked(color);
  });

  return (
    <label
      className="border-input relative flex size-8 cursor-pointer items-center justify-center rounded-md border border-dashed bg-background shadow-xs transition-[border-color,box-shadow] hover:border-ring/60"
      title="Add a new saved color"
    >
      {draftColor ? (
        <span
          className="border-border size-5 rounded-sm border"
          style={{ backgroundColor: draftColor }}
          aria-hidden="true"
        />
      ) : (
        <PlusIcon className="text-muted-foreground size-4" aria-hidden="true" />
      )}
      <input
        type="color"
        value={draftColor ?? initialColor}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        aria-label="Add a new saved color"
        onChange={(event) => {
          if (isHexColor(event.target.value)) {
            setDraftColor(event.target.value.toLowerCase());
            schedule(event.target.value.toLowerCase());
          }
        }}
        onBlur={() => {
          flush();
          addedIndexRef.current = null;
          setDraftColor(null);
        }}
      />
    </label>
  );
}

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

function LineStyleControls({
  value,
  onChange,
  showStroke,
}: {
  value: LineStyleValue;
  onChange: (patch: Partial<LineStyleValue>) => void;
  showStroke: boolean;
}) {
  const [draftOpacity, setDraftOpacity] = useState<number | null>(null);
  const { schedule, flush } = useDebouncedCommit<number>((opacity) => onChange({ opacity }));
  const displayOpacity = draftOpacity ?? value.opacity;
  const optionClass =
    "border-input text-foreground flex h-7 flex-1 cursor-pointer items-center justify-center rounded-md border bg-background shadow-xs transition-[border-color,box-shadow] hover:border-ring/60";
  const selectedOptionClass = "border-ring ring-2 ring-ring/40";

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
                className={cn(optionClass, value.stroke === stroke && selectedOptionClass)}
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
                className={cn(optionClass, value.width === width && selectedOptionClass)}
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

export function ColorPicker({
  value,
  onChange,
  ariaLabel,
  className,
  lineStyle,
  onLineStyleChange,
  showStrokeControls = true,
}: {
  value: string;
  onChange: (color: string) => void;
  ariaLabel: string;
  className?: string;
  lineStyle?: LineStyleValue;
  onLineStyleChange?: (patch: Partial<LineStyleValue>) => void;
  showStrokeControls?: boolean;
}) {
  const paletteColors = usePaletteColors();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      setEditing(false);
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        containerRef.current &&
        !containerRef.current.contains(event.target)
      ) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <button
        type="button"
        className={cn(
          "border-input relative flex size-8 cursor-pointer items-center justify-center rounded-md border bg-background shadow-xs transition-[border-color,box-shadow] hover:border-ring/60",
          open && "border-ring ring-2 ring-ring/40",
        )}
        aria-label={ariaLabel}
        aria-expanded={open}
        title={ariaLabel}
        onClick={() => setOpen((currentOpen) => !currentOpen)}
      >
        {lineStyle && showStrokeControls ? (
          <svg viewBox="0 0 26 26" className="size-[26px]" aria-hidden="true">
            <line
              x1="1"
              y1="13"
              x2="25"
              y2="13"
              stroke={value}
              strokeWidth={lineStyle.width}
              strokeLinecap={lineStyle.stroke === "dotted" ? "round" : "butt"}
              strokeDasharray={
                // Dash pattern compressed so "dashed" still reads at thumbnail size.
                strokeDashArray(
                  lineStyle.stroke,
                  lineStyle.stroke === "dashed" ? 1.5 : Math.min(lineStyle.width, 2),
                )
              }
            />
          </svg>
        ) : (
          <span
            className="border-border size-5 rounded-sm border"
            style={{ backgroundColor: value }}
            aria-hidden="true"
          />
        )}
      </button>

      {open ? (
        <div className="border-border bg-popover text-popover-foreground absolute left-0 top-[calc(100%+0.375rem)] z-30 w-60 rounded-md border p-2.5 shadow-lg">
          <div className="flex items-center justify-between gap-2 pb-2">
            <span className="text-muted-foreground text-xs font-medium">Saved colors</span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label={editing ? "Done editing saved colors" : "Edit saved colors"}
              title={editing ? "Done editing saved colors" : "Edit saved colors"}
              onClick={() => setEditing((currentEditing) => !currentEditing)}
            >
              {editing ? <CheckIcon className="size-4" /> : <PencilIcon className="size-4" />}
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {paletteColors.map((color, index) =>
              editing ? (
                <EditablePaletteSwatch
                  key={index}
                  index={index}
                  color={color}
                  canDelete={paletteColors.length > minPaletteColors}
                />
              ) : (
                <button
                  key={index}
                  type="button"
                  className={cn(
                    "border-input relative flex size-8 cursor-pointer items-center justify-center rounded-md border bg-background shadow-xs transition-[border-color,box-shadow] hover:border-ring/60",
                    color === value.toLowerCase() && "border-ring ring-2 ring-ring/40",
                  )}
                  aria-label={`Use saved color ${color}`}
                  title={color}
                  onClick={() => onChange(color)}
                >
                  <span
                    className="border-border size-5 rounded-sm border"
                    style={{ backgroundColor: color }}
                    aria-hidden="true"
                  />
                </button>
              ),
            )}
            {paletteColors.length < maxPaletteColors ? (
              <AddPaletteSwatch initialColor={value} onPicked={onChange} />
            ) : null}
          </div>
          {lineStyle && onLineStyleChange ? (
            <LineStyleControls
              value={lineStyle}
              onChange={onLineStyleChange}
              showStroke={showStrokeControls}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
