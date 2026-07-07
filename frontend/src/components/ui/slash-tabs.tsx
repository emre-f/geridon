import { Fragment, useLayoutEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";

export interface SlashTabsOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface SlashTabsProps {
  options: SlashTabsOption[];
  value: string;
  onValueChange: (value: string) => void;
  "aria-label"?: string;
  className?: string;
}

interface UnderlinePosition {
  left: number;
  right: number;
  animate: boolean;
  movingRight: boolean;
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function sameUnderlinePosition(
  previous: UnderlinePosition | null,
  next: UnderlinePosition | null,
) {
  if (previous === next) {
    return true;
  }
  if (!previous || !next) {
    return false;
  }

  return Math.abs(previous.left - next.left) < 0.1 && Math.abs(previous.right - next.right) < 0.1;
}

/**
 * Minimal single-select control: plain text options separated by "/", with a
 * gray underline under the active one. On selection the underline's leading
 * edge moves first and the trailing edge follows, so it stretches toward the
 * target and contracts as it lands.
 */
export function SlashTabs({
  options,
  value,
  onValueChange,
  className,
  "aria-label": ariaLabel,
}: SlashTabsProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const buttonRefs = useRef(new Map<string, HTMLButtonElement>());
  const [underline, setUnderline] = useState<UnderlinePosition | null>(null);
  const underlineRef = useRef<UnderlinePosition | null>(null);
  const optionsKey = useMemo(
    () =>
      options
        .map((option) => `${option.value}:${option.label}:${option.disabled ? "disabled" : ""}`)
        .join("|"),
    [options],
  );

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    function updateUnderline(next: UnderlinePosition | null) {
      if (sameUnderlinePosition(underlineRef.current, next)) {
        return;
      }

      underlineRef.current = next;
      setUnderline(next);
    }

    function measure(animate: boolean) {
      const button = buttonRefs.current.get(value);
      if (!container || !button) {
        updateUnderline(null);
        return;
      }

      const containerRect = container.getBoundingClientRect();
      const buttonRect = button.getBoundingClientRect();
      const left = buttonRect.left - containerRect.left;
      const right = containerRect.right - buttonRect.right;
      const previous = underlineRef.current;

      updateUnderline({
        left,
        right,
        animate: animate && previous != null && !prefersReducedMotion(),
        movingRight: previous ? left >= previous.left : true,
      });
    }

    measure(true);

    const observer = new ResizeObserver(() => measure(false));
    observer.observe(container);
    return () => observer.disconnect();
  }, [optionsKey, value]);

  return (
    <div
      ref={containerRef}
      aria-label={ariaLabel}
      className={cn("relative flex items-center gap-2 pb-1 text-sm", className)}
    >
      {options.map((option, index) => {
        const isSelected = option.value === value;

        return (
          <Fragment key={option.value}>
            {index > 0 ? (
              <span aria-hidden="true" className="text-muted-foreground/50 select-none">
                /
              </span>
            ) : null}
            <button
              ref={(node) => {
                if (node) {
                  buttonRefs.current.set(option.value, node);
                } else {
                  buttonRefs.current.delete(option.value);
                }
              }}
              type="button"
              aria-pressed={isSelected}
              disabled={option.disabled}
              onClick={() => onValueChange(option.value)}
              className={cn(
                "transition-colors",
                isSelected ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                option.disabled &&
                  "text-muted-foreground/40 hover:text-muted-foreground/40 cursor-not-allowed",
              )}
            >
              {option.label}
            </button>
          </Fragment>
        );
      })}
      {underline ? (
        <span
          aria-hidden="true"
          className="bg-muted-foreground/70 absolute bottom-0 h-[1.5px] rounded-full"
          style={{
            left: underline.left,
            right: underline.right,
            transition: underline.animate
              ? underline.movingRight
                ? "right 140ms ease-in-out, left 140ms ease-in-out 40ms"
                : "left 140ms ease-in-out, right 140ms ease-in-out 40ms"
              : "none",
          }}
        />
      ) : null}
    </div>
  );
}
