import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { runsPageSizeOptions } from "@/hooks/use-runs-table";
import { Button } from "@/components/ui/button";

export function BacktestRunsPagination({
  page,
  pageCount,
  pageSize,
  totalRuns,
  onPageChange,
  onPageSizeChange,
}: {
  page: number;
  pageCount: number;
  pageSize: number;
  totalRuns: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}) {
  const first = page * pageSize + 1;
  const last = Math.min(totalRuns, (page + 1) * pageSize);

  return (
    <div className="text-muted-foreground flex items-center justify-between gap-3 px-2 pt-2 text-xs">
      <span className="tabular-nums">
        {first}–{last} of {totalRuns}
      </span>
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-1.5">
          <span>Show</span>
          <select
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            className="border-input bg-background focus-visible:border-border rounded-md border px-1.5 py-0.5 outline-none"
          >
            {runsPageSizeOptions.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6"
            aria-label="Previous page"
            disabled={page === 0}
            onClick={() => onPageChange(page - 1)}
          >
            <ChevronLeftIcon className="size-3.5" />
          </Button>
          <span className="tabular-nums">
            {page + 1} / {pageCount}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6"
            aria-label="Next page"
            disabled={page >= pageCount - 1}
            onClick={() => onPageChange(page + 1)}
          >
            <ChevronRightIcon className="size-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
