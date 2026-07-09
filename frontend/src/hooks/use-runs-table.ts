import { useMemo, useState } from "react";

import type { BacktestRunSummary } from "@/lib/api";

export type RunsSortKey = "ran" | "trades" | "win_rate" | "return" | "max_drawdown" | "sharpe";
export type SortDirection = "asc" | "desc";

export const runsPageSizeOptions = [20, 50, 100] as const;

function sortValue(run: BacktestRunSummary, key: RunsSortKey): number | null {
  switch (key) {
    case "ran":
      return new Date(run.created_at).getTime();
    case "trades":
      return run.metrics.trade_count;
    case "win_rate":
      return run.metrics.win_rate_pct;
    case "return":
      return run.metrics.total_return_pct;
    case "max_drawdown":
      return run.metrics.max_drawdown_pct ?? null;
    case "sharpe":
      return run.metrics.sharpe_ratio;
  }
}

// Runs missing a value (older records lack the newer metrics) sink to the
// bottom in either direction so a sort never hides them at the top.
function compareRuns(
  a: BacktestRunSummary,
  b: BacktestRunSummary,
  key: RunsSortKey,
  direction: SortDirection,
): number {
  const left = sortValue(a, key);
  const right = sortValue(b, key);
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  const diff = left - right;
  return direction === "asc" ? diff : -diff;
}

export function useRunsTable(runs: BacktestRunSummary[]) {
  const [sort, setSort] = useState<{ key: RunsSortKey; direction: SortDirection }>({
    key: "ran",
    direction: "desc",
  });
  const [pageSize, setPageSize] = useState<number>(runsPageSizeOptions[0]);
  const [page, setPage] = useState(0);

  const sorted = useMemo(
    () => [...runs].sort((a, b) => compareRuns(a, b, sort.key, sort.direction)),
    [runs, sort],
  );

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const clampedPage = Math.min(page, pageCount - 1);
  const start = clampedPage * pageSize;
  const visibleRuns = sorted.slice(start, start + pageSize);

  function toggleSort(key: RunsSortKey) {
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
        : { key, direction: "desc" },
    );
    setPage(0);
  }

  function changePageSize(size: number) {
    setPageSize(size);
    setPage(0);
  }

  return {
    sort,
    toggleSort,
    visibleRuns,
    page: clampedPage,
    pageCount,
    pageSize,
    changePageSize,
    setPage,
    totalRuns: sorted.length,
  };
}
