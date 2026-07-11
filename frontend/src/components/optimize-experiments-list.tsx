import type { OptimizationExperimentListItem } from "@/lib/api";
import { experimentsRowGrid, OptimizeExperimentRow } from "@/components/optimize-experiment-row";

export function OptimizeExperimentsList({
  experiments,
  loading,
  actioningId,
  selectedId,
  onSelect,
  onCancel,
  onResume,
  onDelete,
}: {
  experiments: OptimizationExperimentListItem[];
  loading: boolean;
  actioningId: number | null;
  selectedId: number | null;
  onSelect: (experiment: OptimizationExperimentListItem) => void;
  onCancel: (experiment: OptimizationExperimentListItem) => void;
  onResume: (experiment: OptimizationExperimentListItem) => void;
  onDelete: (experiment: OptimizationExperimentListItem) => void;
}) {
  if (loading && experiments.length === 0) {
    return <p className="text-muted-foreground text-sm">Loading…</p>;
  }

  if (experiments.length === 0) {
    return <p className="text-muted-foreground text-sm">No experiments yet.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[58rem]">
        <div className="text-muted-foreground flex items-center gap-3 px-2 pb-1 text-xs">
          <div className={experimentsRowGrid}>
            <span>Started</span>
            <span>Strategy</span>
            <span>Symbols</span>
            <span>TF</span>
            <span>Method</span>
            <span>Progress</span>
          </div>
          <span className="w-20 shrink-0" aria-hidden />
          <span className="w-16 shrink-0" aria-hidden />
        </div>

        {experiments.map((experiment) => (
          <OptimizeExperimentRow
            key={experiment.id}
            experiment={experiment}
            actioning={actioningId === experiment.id}
            selected={selectedId === experiment.id}
            onSelect={onSelect}
            onCancel={onCancel}
            onResume={onResume}
            onDelete={onDelete}
          />
        ))}
      </div>
    </div>
  );
}
