import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDownIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

const maxVisibleMatches = 50;

/**
 * Type-ahead picker for large symbol lists: click (or type) to filter, arrow
 * keys to highlight, Enter/click to select. Falls back to the current value on
 * escape or blur without a selection.
 */
export function SymbolCombobox({
  value,
  tickers,
  onSelect,
  ariaLabel,
  className,
}: {
  value: string;
  tickers: string[];
  onSelect: (ticker: string) => void;
  ariaLabel: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlightIndex, setHighlightIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const matches = useMemo(() => {
    const normalized = query.toUpperCase().trim();
    if (!normalized) {
      return tickers.slice(0, maxVisibleMatches);
    }

    // Prefix matches first so "AA" surfaces AAPL before NAAS-style tickers.
    const prefix: string[] = [];
    const contains: string[] = [];
    for (const ticker of tickers) {
      if (ticker.startsWith(normalized)) {
        prefix.push(ticker);
      } else if (ticker.includes(normalized)) {
        contains.push(ticker);
      }
      if (prefix.length >= maxVisibleMatches) {
        break;
      }
    }
    return [...prefix, ...contains].slice(0, maxVisibleMatches);
  }, [query, tickers]);

  useEffect(() => {
    setHighlightIndex(0);
  }, [query]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (event.target instanceof Node && rootRef.current && !rootRef.current.contains(event.target)) {
        close();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    listRef.current
      ?.querySelector('[data-highlighted="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [highlightIndex, matches, open]);

  function close() {
    setOpen(false);
    setQuery("");
    setHighlightIndex(0);
  }

  function select(ticker: string) {
    onSelect(ticker);
    close();
  }

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <Input
        role="combobox"
        aria-expanded={open}
        aria-label={ariaLabel}
        autoComplete="off"
        spellCheck={false}
        className="pr-7 uppercase"
        value={open ? query : value}
        placeholder={value || "Symbol"}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setOpen(true);
          setQuery(event.target.value.toUpperCase());
        }}
        onKeyDown={(event) => {
          if (!open && (event.key === "ArrowDown" || event.key === "Enter")) {
            setOpen(true);
            return;
          }
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setHighlightIndex((current) => Math.min(current + 1, matches.length - 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setHighlightIndex((current) => Math.max(current - 1, 0));
          } else if (event.key === "Enter") {
            event.preventDefault();
            const match = matches[highlightIndex] ?? matches[0];
            if (match) {
              select(match);
              event.currentTarget.blur();
            }
          } else if (event.key === "Escape") {
            close();
            event.currentTarget.blur();
          }
        }}
      />
      <ChevronDownIcon
        className="text-muted-foreground pointer-events-none absolute right-2 top-1/2 size-4 -translate-y-1/2"
        aria-hidden="true"
      />

      {open ? (
        <div
          ref={listRef}
          role="listbox"
          className="border-border bg-popover text-popover-foreground absolute left-0 top-[calc(100%+0.25rem)] z-50 max-h-56 w-full min-w-28 overflow-y-auto rounded-md border p-1 shadow-md"
        >
          {matches.length === 0 ? (
            <p className="text-muted-foreground px-2 py-1.5 text-xs">No matching symbols.</p>
          ) : (
            matches.map((ticker, index) => (
              <button
                key={ticker}
                type="button"
                role="option"
                aria-selected={ticker === value}
                data-highlighted={index === highlightIndex}
                className={cn(
                  "flex w-full items-center rounded px-2 py-1.5 text-left text-sm transition-colors",
                  index === highlightIndex
                    ? "bg-[var(--control-hover)]"
                    : "hover:bg-[var(--control-hover)]",
                  ticker === value && "font-semibold",
                )}
                onPointerEnter={() => setHighlightIndex(index)}
                // pointerdown beats the input's blur so the click always lands.
                onPointerDown={(event) => {
                  event.preventDefault();
                  select(ticker);
                }}
              >
                {ticker}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
