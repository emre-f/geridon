import { useEffect, useMemo, useRef, useState } from "react";
import { SearchIcon } from "lucide-react";

import type { IndicatorDefinition } from "@/lib/api";
import { Input } from "@/components/ui/input";

interface IndicatorPickerBaseProps {
  open: boolean;
  catalog: IndicatorDefinition[];
  onAdd: (definition: IndicatorDefinition) => void;
  onClose: () => void;
}

type IndicatorPickerLimits =
  | { activeCount: number; maxCount: number }
  | { activeCount?: never; maxCount?: never };

type IndicatorPickerProps = IndicatorPickerBaseProps & IndicatorPickerLimits;

/**
 * Modal for adding an indicator: a searchable catalog list showing each
 * indicator's short name, full name, and a one-line description.
 */
export function IndicatorPicker({ open, ...dialogProps }: IndicatorPickerProps) {
  // Mounting the dialog fresh each open resets the search query naturally.
  return open ? <IndicatorPickerDialog {...dialogProps} /> : null;
}

function IndicatorPickerDialog({
  catalog,
  activeCount,
  maxCount,
  onAdd,
  onClose,
}: Omit<IndicatorPickerBaseProps, "open"> & IndicatorPickerLimits) {
  const [query, setQuery] = useState("");
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const atLimit =
    activeCount != null && maxCount != null && activeCount >= maxCount;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    if (!dialog.open) {
      dialog.showModal();
    }
    inputRef.current?.focus();

    function closeOnBackdropClick(event: MouseEvent) {
      if (event.target === dialog) {
        onClose();
      }
    }

    dialog.addEventListener("click", closeOnBackdropClick);
    return () => dialog.removeEventListener("click", closeOnBackdropClick);
  }, [onClose]);

  const filteredCatalog = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return catalog;
    }

    return catalog.filter((definition) =>
      [definition.kind, definition.label, definition.full_name, definition.description].some(
        (text) => text?.toLowerCase().includes(normalized),
      ),
    );
  }, [catalog, query]);

  function addDefinition(definition: IndicatorDefinition) {
    onAdd(definition);
    onClose();
  }

  return (
    <dialog
      ref={dialogRef}
      aria-label="Add indicator"
      className="border-border bg-popover text-popover-foreground fixed left-1/2 top-[12vh] m-0 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 rounded-lg border p-0 shadow-xl backdrop:bg-black/50"
      onCancel={onClose}
    >
      <div className="flex flex-col">
        <div className="p-3 pb-2">
          <div className="relative">
            <SearchIcon className="text-muted-foreground pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2" />
            <Input
              ref={inputRef}
              value={query}
              placeholder="Search indicators"
              aria-label="Search indicators"
              className="pl-9"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && filteredCatalog.length > 0 && !atLimit) {
                  addDefinition(filteredCatalog[0]);
                }
              }}
            />
          </div>
        </div>

        <div className="flex max-h-[50vh] flex-col gap-0.5 overflow-y-auto p-2 pt-1">
          {filteredCatalog.length === 0 ? (
            <p className="text-muted-foreground px-3 py-6 text-center text-sm">
              No indicators match &ldquo;{query}&rdquo;.
            </p>
          ) : (
            filteredCatalog.map((definition) => (
              <button
                key={definition.kind}
                type="button"
                disabled={atLimit}
                className="hover:bg-muted flex w-full flex-col items-start gap-0.5 rounded-md px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
                onClick={() => addDefinition(definition)}
              >
                <span className="text-sm font-medium">
                  {definition.label}
                  <span className="text-muted-foreground font-normal">
                    {" "}
                    &middot; {definition.full_name}
                  </span>
                </span>
                <span className="text-muted-foreground text-xs">{definition.description}</span>
              </button>
            ))
          )}
        </div>

        {atLimit && maxCount != null ? (
          <p className="border-border text-muted-foreground border-t px-4 py-2.5 text-xs">
            Limit of {maxCount} indicators reached. Remove one from the chart to add another.
          </p>
        ) : null}
      </div>
    </dialog>
  );
}
