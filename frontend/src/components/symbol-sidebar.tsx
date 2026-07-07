import { type FormEvent, type MouseEvent, type RefObject } from "react";
import { PlusIcon, RefreshCwIcon, SearchIcon, XIcon } from "lucide-react";

import type { SymbolSummary } from "@/lib/api";
import { formatCompact } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

const selectedSymbolClass =
  "!bg-[var(--control-selected)] !text-[var(--control-selected-foreground)] hover:!bg-[var(--control-selected-hover)] hover:!text-[var(--control-selected-foreground)]";

export function SymbolSidebar({
  addPanelRef,
  addTickerInputRef,
  addPanelOpen,
  addTickerInput,
  addingSymbol,
  deletingTicker,
  filteredSymbols,
  selectedTicker,
  symbolFilter,
  symbolsLoading,
  visibleSymbols,
  onAddPanelOpenChange,
  onAddTickerInputChange,
  onAddSymbolSubmit,
  onContextMenu,
  onSelectSymbol,
  onSymbolFilterChange,
}: {
  addPanelRef: RefObject<HTMLDivElement | null>;
  addTickerInputRef: RefObject<HTMLInputElement | null>;
  addPanelOpen: boolean;
  addTickerInput: string;
  addingSymbol: boolean;
  deletingTicker: string | null;
  filteredSymbols: SymbolSummary[];
  selectedTicker: string;
  symbolFilter: string;
  symbolsLoading: boolean;
  visibleSymbols: SymbolSummary[];
  onAddPanelOpenChange: (open: boolean | ((current: boolean) => boolean)) => void;
  onAddTickerInputChange: (value: string) => void;
  onAddSymbolSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onContextMenu: (event: MouseEvent<HTMLButtonElement>, ticker: string) => void;
  onSelectSymbol: (symbol: SymbolSummary) => void;
  onSymbolFilterChange: (value: string) => void;
}) {
  return (
    <aside className="flex min-h-0 flex-col gap-3 xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)]">
      <div ref={addPanelRef} className="relative px-1">
        <div className="flex items-center justify-between gap-3">
          <CardTitle>Symbols</CardTitle>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={addPanelOpen ? "Close add symbol" : "Add symbol"}
            title={addPanelOpen ? "Close add symbol" : "Add symbol"}
            onClick={() => onAddPanelOpenChange((open) => !open)}
          >
            {addPanelOpen ? <XIcon /> : <PlusIcon />}
          </Button>
        </div>
        {addPanelOpen ? (
          <form
            className="absolute left-1 right-1 top-[calc(100%+0.75rem)] z-20 flex gap-3 rounded-md border border-[var(--control-border)] bg-[var(--control-surface)] p-3 shadow-xl"
            onSubmit={onAddSymbolSubmit}
          >
            <div className="min-w-0 flex-1">
              <Input
                ref={addTickerInputRef}
                value={addTickerInput}
                onChange={(event) => onAddTickerInputChange(event.target.value.toUpperCase())}
                placeholder="Ticker"
                aria-label="Ticker to add"
                disabled={addingSymbol}
                maxLength={16}
              />
            </div>
            <Button type="submit" variant="secondary" disabled={addingSymbol || symbolsLoading}>
              {addingSymbol ? <RefreshCwIcon className="animate-spin" /> : <PlusIcon />}
              {addingSymbol ? "Adding" : "Add"}
            </Button>
          </form>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-col gap-3">
        <div className="relative">
          <SearchIcon className="text-muted-foreground pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2" />
          <Input
            value={symbolFilter}
            onChange={(event) => onSymbolFilterChange(event.target.value.toUpperCase())}
            placeholder="Search symbols"
            aria-label="Search symbols"
            className="pl-9"
          />
        </div>

        <div className="border-border min-h-72 overflow-y-auto rounded-md border">
          {symbolsLoading ? (
            <div className="flex flex-col gap-2 p-2">
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
          ) : visibleSymbols.length > 0 ? (
            <div className="flex flex-col p-1">
              {visibleSymbols.map((symbol) => {
                const isSelected = symbol.ticker === selectedTicker;
                const timeframeLabels = symbol.timeframes
                  .map((item) => item.timeframe.toUpperCase())
                  .join(", ");

                return (
                  <button
                    key={symbol.ticker}
                    type="button"
                    className={cn(
                      "hover:!bg-[var(--control-hover)] hover:!text-foreground flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors",
                      isSelected && selectedSymbolClass,
                    )}
                    aria-pressed={isSelected}
                    disabled={deletingTicker === symbol.ticker}
                    onClick={() => onSelectSymbol(symbol)}
                    onContextMenu={(event) => onContextMenu(event, symbol.ticker)}
                  >
                    <span className="font-medium">{symbol.ticker}</span>
                    <span
                      className={cn(
                        "text-muted-foreground text-xs",
                        isSelected && "!text-current opacity-80",
                      )}
                    >
                      {timeframeLabels}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="text-muted-foreground flex min-h-72 items-center justify-center px-4 text-center text-sm">
              {symbolFilter ? "No matching symbols." : "No stored symbols."}
            </div>
          )}
        </div>

        {filteredSymbols.length > visibleSymbols.length ? (
          <p className="text-muted-foreground text-xs">
            Showing first {formatCompact(visibleSymbols.length)}{" "}
            {symbolFilter ? "matches" : "symbols"}.
          </p>
        ) : null}
      </div>
    </aside>
  );
}
