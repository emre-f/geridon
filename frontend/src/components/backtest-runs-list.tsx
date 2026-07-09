import { ChevronDownIcon, ChevronUpIcon, ChevronsUpDownIcon } from "lucide-react";

import type { BacktestRunSummary } from "@/lib/api";
import { useRunsTable, type RunsSortKey } from "@/hooks/use-runs-table";
import { cn } from "@/lib/utils";
import { BacktestRunRow, runsRowGrid } from "@/components/backtest-run-row";
import { BacktestRunsPagination } from "@/components/backtest-runs-pagination";

type Sort = ReturnType<typeof useRunsTable>["sort"];

function SortHeader({
  label,
  sortKey,
  sort,
  onSort,
  hint,
}: {
  label: string;
  sortKey: RunsSortKey;
  sort: Sort;
  onSort: (key: RunsSortKey) => void;
  hint?: string;
}) {
  const active = sort.key === sortKey;
  const Icon = !active
    ? ChevronsUpDownIcon
    : sort.direction === "asc"
      ? ChevronUpIcon
      : ChevronDownIcon;
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      className="group/th hover:text-foreground flex items-center justify-end gap-0.5 transition-colors"
    >
      {hint ? (
        <span className="relative">
          <span className="decoration-muted-foreground/40 underline decoration-dotted underline-offset-2">
            {label}
          </span>
          <span className="border-border bg-popover text-popover-foreground invisible absolute right-0 top-[calc(100%+0.375rem)] z-50 w-48 rounded-md border p-2 text-left text-[11px] font-normal opacity-0 shadow-md transition-opacity group-hover/th:visible group-hover/th:opacity-100 group-focus/th:visible group-focus/th:opacity-100">
            {hint}
          </span>
        </span>
      ) : (
        <span>{label}</span>
      )}
      <Icon className={cn("size-3", active ? "opacity-100" : "opacity-40")} />
    </button>
  );
}

export function BacktestRunsList({
  activeRunId,
  openingRunId,
  runs,
  runsLoading,
  onDeleteRun,
  onOpenRun,
}: {
  activeRunId: number | undefined;
  openingRunId: number | null;
  runs: BacktestRunSummary[];
  runsLoading: boolean;
  onDeleteRun: (run: BacktestRunSummary) => void;
  onOpenRun: (run: BacktestRunSummary) => void;
}) {
  const table = useRunsTable(runs);

  if (runsLoading) {
    return <p className="text-muted-foreground text-sm">Loading…</p>;
  }

  if (runs.length === 0) {
    return <p className="text-muted-foreground text-sm">No runs yet for this strategy.</p>;
  }

  const { sort, toggleSort } = table;

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[52rem]">
        <div className="text-muted-foreground flex items-center gap-3 px-2 pb-1 text-xs">
          <div className={runsRowGrid}>
            <SortHeader label="Ran" sortKey="ran" sort={sort} onSort={toggleSort} />
            <span>Ticker</span>
            <span>TF</span>
            <span>Mode</span>
            <span>Rules</span>
            <span>Period</span>
            <SortHeader label="Trades" sortKey="trades" sort={sort} onSort={toggleSort} />
            <SortHeader label="Win rate" sortKey="win_rate" sort={sort} onSort={toggleSort} />
            <SortHeader label="Return" sortKey="return" sort={sort} onSort={toggleSort} />
            <SortHeader
              label="Max DD"
              sortKey="max_drawdown"
              sort={sort}
              onSort={toggleSort}
              hint="Max drawdown — the deepest peak-to-trough drop in equity during the run."
            />
            <SortHeader
              label="Sharpe"
              sortKey="sharpe"
              sort={sort}
              onSort={toggleSort}
              hint="Sharpe ratio — return earned per unit of volatility, annualized. Higher is better."
            />
          </div>
          {/* Spacer matching the per-row delete button so headers stay aligned. */}
          <span className="w-7 shrink-0" aria-hidden />
        </div>

        {table.visibleRuns.map((run) => (
          <BacktestRunRow
            key={run.id}
            run={run}
            active={activeRunId === run.id}
            opening={openingRunId === run.id}
            onOpenRun={onOpenRun}
            onDeleteRun={onDeleteRun}
          />
        ))}

        {table.totalRuns > 20 ? (
          <BacktestRunsPagination
            page={table.page}
            pageCount={table.pageCount}
            pageSize={table.pageSize}
            totalRuns={table.totalRuns}
            onPageChange={table.setPage}
            onPageSizeChange={table.changePageSize}
          />
        ) : null}
      </div>
    </div>
  );
}
