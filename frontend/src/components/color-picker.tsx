import { useEffect, useRef, useState } from "react";
import { CheckIcon, PencilIcon } from "lucide-react";

import { maxPaletteColors, minPaletteColors, usePaletteColors } from "@/lib/color-palette";
import { strokeDashArray } from "@/lib/indicator-style";
import { cn } from "@/lib/utils";
import {
  AddPaletteSwatch,
  EditablePaletteSwatch,
} from "@/components/color-picker/palette-swatches";
import {
  LineStyleControls,
  type LineStyleValue,
} from "@/components/color-picker/line-style-controls";
import {
  colorPopoverClass,
  selectedControlClass,
  swatchControlClass,
} from "@/components/color-picker/styles";
import { Button } from "@/components/ui/button";

export type { LineStyleValue };

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
        className={cn(swatchControlClass, open && selectedControlClass)}
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
              strokeDasharray={strokeDashArray(
                lineStyle.stroke,
                lineStyle.stroke === "dashed" ? 1.5 : Math.min(lineStyle.width, 2),
              )}
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
        <div className={colorPopoverClass}>
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
                  key={color}
                  index={index}
                  color={color}
                  canDelete={paletteColors.length > minPaletteColors}
                />
              ) : (
                <button
                  key={color}
                  type="button"
                  className={cn(
                    swatchControlClass,
                    color === value.toLowerCase() && selectedControlClass,
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
