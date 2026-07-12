import { useState } from "react";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";

import type { RuleRole } from "@/lib/api";
import { nodeLabel } from "@/lib/optimize-chart-utils";
import { numericNodes, underOffRule } from "@/lib/optimize-search-space-utils";
import type { useOptimizeSearchSpace } from "@/hooks/use-optimize-search-space";
import { Badge } from "@/components/ui/badge";
import { NumberInput } from "@/components/ui/number-input";
import { Select } from "@/components/ui/select";

/**
 * Collapsible Mode A/B controls for the new-experiment form: per-rule
 * required/optional/off roles and per-parameter tune/lock with bounded ranges.
 */
export function OptimizeSearchSpaceEditor({
  searchSpace,
}: {
  searchSpace: ReturnType<typeof useOptimizeSearchSpace>;
}) {
  const [open, setOpen] = useState(false);
  const { preview, edits, loading, error, issue, summary } = searchSpace;

  const headerNote = loading
    ? "Loading search space…"
    : error
      ? "Search space unavailable — defaults will be used"
      : summary;

  return (
    <section className="rounded-md border">
      <button
        type="button"
        aria-expanded={open}
        className="hover:bg-muted/50 flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm"
        onClick={() => setOpen((previous) => !previous)}
      >
        {open ? (
          <ChevronDownIcon className="text-muted-foreground size-4 shrink-0" aria-hidden />
        ) : (
          <ChevronRightIcon className="text-muted-foreground size-4 shrink-0" aria-hidden />
        )}
        <span className="font-medium">Parameters &amp; rules</span>
        <span className="text-muted-foreground ml-auto min-w-0 truncate text-xs">{headerNote}</span>
      </button>

      {open && preview && edits ? (
        <div className="flex flex-col gap-4 border-t px-3 pt-3 pb-3">
          <div className="flex flex-col gap-1">
            <h4 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              Rules
            </h4>
            <p className="text-muted-foreground text-xs">
              Optional rules are switched on/off by the search; off rules are removed before
              searching.
            </p>
            {preview.rules.map((rule) => (
              <div key={rule.id} className="flex items-center gap-2 py-0.5">
                <Badge variant="outline" className="w-14 justify-center">
                  {rule.side}
                </Badge>
                <code className="min-w-0 flex-1 truncate font-mono text-xs">{rule.summary}</code>
                <Select
                  value={edits.roles[rule.id]}
                  aria-label={`Role for rule ${rule.id}`}
                  className="w-28"
                  onChange={(event) => searchSpace.setRole(rule.id, event.target.value as RuleRole)}
                >
                  <option value="required">Required</option>
                  <option value="optional">Optional</option>
                  <option value="off">Off</option>
                </Select>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-1">
            <h4 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              Parameters
            </h4>
            {numericNodes(preview).map((node) => {
              const edit = edits.parameters[node.id];
              if (!edit) {
                return null;
              }
              const ruleOff = underOffRule(node.id, edits);
              return (
                <div
                  key={node.id}
                  className={`flex flex-wrap items-center gap-2 py-0.5 ${ruleOff ? "opacity-50" : ""}`}
                >
                  <span className="w-44 truncate text-xs" title={node.id}>
                    {nodeLabel(node)}
                  </span>
                  <span className="text-muted-foreground w-16 text-xs">now {node.current}</span>
                  {ruleOff ? (
                    <span className="text-muted-foreground text-xs">rule is off</span>
                  ) : (
                    <>
                      <Select
                        value={edit.locked ? "lock" : "tune"}
                        aria-label={`Search mode for ${node.id}`}
                        className="w-20"
                        onChange={(event) =>
                          searchSpace.setParameter(node.id, {
                            locked: event.target.value === "lock",
                          })
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
                    </>
                  )}
                </div>
              );
            })}
          </div>

          {issue ? <p className="text-destructive text-xs">{issue}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
