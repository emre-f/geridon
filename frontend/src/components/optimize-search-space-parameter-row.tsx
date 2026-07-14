import { nodeLabel } from "@/lib/optimize-chart-utils";
import type { NumericPreviewNode } from "@/lib/optimize-search-space-utils";
import type { useOptimizeSearchSpace } from "@/hooks/use-optimize-search-space";
import { NumberInput } from "@/components/ui/number-input";
import { Select } from "@/components/ui/select";

/** One opt-in backtest sizing dimension (buy/sell percent), locked by default. */
export function OptimizeSearchSpaceSizingRow({
  node,
  searchSpace,
}: {
  node: NumericPreviewNode;
  searchSpace: ReturnType<typeof useOptimizeSearchSpace>;
}) {
  const edit = searchSpace.edits?.sizing[node.id];
  if (!edit) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-2 py-0.5">
      <span className="w-24 truncate text-xs" title={node.id}>
        {nodeLabel(node)}
      </span>
      <span className="text-muted-foreground w-16 text-xs">now {node.current}</span>
      <Select
        value={edit.tuned ? "tune" : "lock"}
        aria-label={`Search mode for ${node.id}`}
        className="w-20"
        onChange={(event) =>
          searchSpace.setSizing(node.id, { tuned: event.target.value === "tune" })
        }
      >
        <option value="tune">Tune</option>
        <option value="lock">Lock</option>
      </Select>
      <NumberInput
        className="w-20"
        aria-label={`Minimum for ${node.id}`}
        value={edit.min}
        min={node.hard_min ?? undefined}
        max={node.hard_max ?? undefined}
        step={node.step}
        disabled={!edit.tuned}
        onValueChange={(min) => searchSpace.setSizing(node.id, { min })}
      />
      <span className="text-muted-foreground text-xs">to</span>
      <NumberInput
        className="w-20"
        aria-label={`Maximum for ${node.id}`}
        value={edit.max}
        min={node.hard_min ?? undefined}
        max={node.hard_max ?? undefined}
        step={node.step}
        disabled={!edit.tuned}
        onValueChange={(max) => searchSpace.setSizing(node.id, { max })}
      />
    </div>
  );
}

/** One tunable parameter inside a rule group: tune/lock plus a bounded range. */
export function OptimizeSearchSpaceParameterRow({
  node,
  searchSpace,
}: {
  node: NumericPreviewNode;
  searchSpace: ReturnType<typeof useOptimizeSearchSpace>;
}) {
  const edit = searchSpace.edits?.parameters[node.id];
  if (!edit) {
    return null;
  }
  const paramName = node.path.at(-1) === "value" ? "threshold" : (node.path.at(-1) ?? node.id);

  return (
    <div className="flex flex-wrap items-center gap-2 py-0.5">
      <span className="w-24 truncate text-xs" title={nodeLabel(node)}>
        {paramName}
      </span>
      <span className="text-muted-foreground w-16 text-xs">now {node.current}</span>
      <Select
        value={edit.locked ? "lock" : "tune"}
        aria-label={`Search mode for ${node.id}`}
        className="w-20"
        onChange={(event) =>
          searchSpace.setParameter(node.id, { locked: event.target.value === "lock" })
        }
      >
        <option value="tune">Tune</option>
        <option value="lock">Lock</option>
      </Select>
      <NumberInput
        className="w-20"
        aria-label={`Minimum for ${node.id}`}
        value={edit.min}
        min={node.hard_min ?? undefined}
        max={node.hard_max ?? undefined}
        step={node.step}
        disabled={edit.locked}
        onValueChange={(min) => searchSpace.setParameter(node.id, { min })}
      />
      <span className="text-muted-foreground text-xs">to</span>
      <NumberInput
        className="w-20"
        aria-label={`Maximum for ${node.id}`}
        value={edit.max}
        min={node.hard_min ?? undefined}
        max={node.hard_max ?? undefined}
        step={node.step}
        disabled={edit.locked}
        onValueChange={(max) => searchSpace.setParameter(node.id, { max })}
      />
    </div>
  );
}
