import { RefreshCwIcon, RotateCcwIcon, Trash2Icon, XIcon } from "lucide-react";

import type { OptimizationExperimentListItem } from "@/lib/api";
import { canCancel, canResume, formatExperimentCreatedAt, methodLabels, statusBadgeVariant, statusLabels } from "@/lib/optimize-utils";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { OptimizeExperimentProgress } from "@/components/optimize-experiment-progress";

// Header and rows share this template so the columns line up like a table.
export const experimentsRowGrid =
  "grid min-w-0 flex-1 grid-cols-[6.5rem_minmax(8rem,1fr)_5rem_5rem_7rem_10.5rem] items-center gap-x-3";

function RowCells({ experiment }: { experiment: OptimizationExperimentListItem }) {
  return (
    <>
      <span className="text-muted-foreground text-xs">
        {formatExperimentCreatedAt(experiment.created_at)}
      </span>
      <span className="truncate font-medium" title={experiment.strategy_name}>
        {experiment.strategy_name}
      </span>
      <span className="text-muted-foreground truncate text-xs">
        {experiment.tickers.join(", ")}
      </span>
      <span className="text-muted-foreground text-xs">{experiment.timeframe.toUpperCase()}</span>
      <span className="text-muted-foreground text-xs">{methodLabels[experiment.method]}</span>
      <OptimizeExperimentProgress experiment={experiment} />
    </>
  );
}

export function OptimizeExperimentRow({
  experiment,
  actioning,
  selected,
  onSelect,
  onCancel,
  onResume,
  onDelete,
}: {
  experiment: OptimizationExperimentListItem;
  actioning: boolean;
  selected: boolean;
  onSelect: (experiment: OptimizationExperimentListItem) => void;
  onCancel: (experiment: OptimizationExperimentListItem) => void;
  onResume: (experiment: OptimizationExperimentListItem) => void;
  onDelete: (experiment: OptimizationExperimentListItem) => void;
}) {
  const selectable = !canCancel(experiment.status);

  return (
    <div
      className={cn(
        "hover:bg-muted/50 group flex items-center gap-3 rounded-md px-2 py-1.5 text-sm transition-colors",
        selected && "bg-muted/60",
      )}
    >
      {selectable ? (
        <button
          type="button"
          className={cn(experimentsRowGrid, "text-left")}
          aria-expanded={selected}
          title={selected ? "Hide results" : "Show results"}
          onClick={() => onSelect(experiment)}
        >
          <RowCells experiment={experiment} />
        </button>
      ) : (
        <div className={experimentsRowGrid}>
          <RowCells experiment={experiment} />
        </div>
      )}

      <div className="flex w-20 shrink-0 items-center">
        <Badge variant={statusBadgeVariant[experiment.status]}>
          {statusLabels[experiment.status]}
        </Badge>
      </div>

      <div className="flex w-16 shrink-0 items-center justify-end gap-1">
        {actioning ? (
          <span className="flex size-7 items-center justify-center">
            <RefreshCwIcon className="text-muted-foreground size-3.5 animate-spin" />
          </span>
        ) : (
          <>
            {canCancel(experiment.status) ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-destructive size-7"
                aria-label="Cancel experiment"
                title="Cancel"
                onClick={() => onCancel(experiment)}
              >
                <XIcon className="size-3.5" />
              </Button>
            ) : null}
            {canResume(experiment.status) ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-foreground size-7"
                aria-label="Resume experiment"
                title="Resume"
                onClick={() => onResume(experiment)}
              >
                <RotateCcwIcon className="size-3.5" />
              </Button>
            ) : null}
            {!canCancel(experiment.status) ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-destructive size-7 opacity-0 transition-opacity group-hover:opacity-100"
                aria-label="Delete experiment"
                title="Delete"
                onClick={() => onDelete(experiment)}
              >
                <Trash2Icon className="size-3.5" />
              </Button>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
