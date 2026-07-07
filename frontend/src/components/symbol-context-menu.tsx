import { RefreshCwIcon, Trash2Icon } from "lucide-react";

import type { SymbolContextMenu as SymbolContextMenuState } from "@/lib/app-types";

export function SymbolContextMenu({
  menu,
  deletingTicker,
  onDelete,
}: {
  menu: SymbolContextMenuState;
  deletingTicker: string | null;
  onDelete: (ticker: string) => void;
}) {
  const deleting = deletingTicker === menu.ticker;

  return (
    <div
      className="bg-popover text-popover-foreground border-border fixed z-50 min-w-44 rounded-md border p-1 shadow-lg"
      style={{ left: menu.x, top: menu.y }}
      role="menu"
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="text-destructive hover:bg-destructive/10 flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60"
        role="menuitem"
        disabled={deleting}
        onClick={() => onDelete(menu.ticker)}
      >
        {deleting ? (
          <RefreshCwIcon className="size-4 animate-spin" />
        ) : (
          <Trash2Icon className="size-4" />
        )}
        Delete {menu.ticker}
      </button>
    </div>
  );
}
