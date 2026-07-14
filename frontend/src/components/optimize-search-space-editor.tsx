import { useState } from "react";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";

import type { RuleRole } from "@/lib/api";
import {
  ruleParameterGroups,
  sizingNodes,
  type RuleParameterGroup,
} from "@/lib/optimize-search-space-utils";
import type { useOptimizeSearchSpace } from "@/hooks/use-optimize-search-space";
import { searchSpaceHelp } from "@/components/optimize-section-help";
import {
  OptimizeSearchSpaceParameterRow,
  OptimizeSearchSpaceSizingRow,
} from "@/components/optimize-search-space-parameter-row";
import { Badge } from "@/components/ui/badge";
import { HelpTip } from "@/components/ui/help-tip";
import { Select } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";

type SearchSpaceHook = ReturnType<typeof useOptimizeSearchSpace>;

function RuleGroup({
  group,
  searchSpace,
  rolesEditable,
}: {
  group: RuleParameterGroup;
  searchSpace: SearchSpaceHook;
  rolesEditable: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const { edits } = searchSpace;
  const rule = group.rule;
  const role = rule ? edits?.roles[rule.id] : undefined;
  const off = role === "off";
  const tuned = group.nodes.filter((node) => !edits?.parameters[node.id]?.locked).length;
  const showParameters = expanded && !off && group.nodes.length > 0;

  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex items-center gap-2 py-0.5">
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={`Parameters for ${rule ? `rule ${rule.id}` : "the strategy"}`}
          disabled={off || group.nodes.length === 0}
          className="text-muted-foreground disabled:opacity-30"
          onClick={() => setExpanded((previous) => !previous)}
        >
          {expanded && !off ? (
            <ChevronDownIcon className="size-4" aria-hidden />
          ) : (
            <ChevronRightIcon className="size-4" aria-hidden />
          )}
        </button>
        {rule ? (
          <>
            <Badge variant="outline" className="w-14 justify-center">
              {rule.side}
            </Badge>
            <span className="min-w-0 flex-1 truncate text-xs" title={rule.summary}>
              {rule.label ?? rule.summary}
            </span>
            <span className="text-muted-foreground shrink-0 text-xs">
              {off
                ? "removed from search"
                : group.nodes.length === 0
                  ? "no parameters"
                  : `${tuned}/${group.nodes.length} tuned`}
            </span>
            {rolesEditable ? (
              <>
                <label
                  className={`flex shrink-0 items-center gap-1 text-xs ${off ? "opacity-30" : ""}`}
                  title="Also search this rule's comparison operator (gt, lt, cross above, ...)"
                >
                  <input
                    type="checkbox"
                    className="size-3.5 accent-[var(--primary)]"
                    checked={edits?.operators[rule.id] ?? false}
                    disabled={off}
                    aria-label={`Search the operator of rule ${rule.id}`}
                    onChange={(event) =>
                      searchSpace.setOperatorSearch(rule.id, event.target.checked)
                    }
                  />
                  operator
                </label>
                <Select
                  value={role}
                  aria-label={`Role for rule ${rule.id}`}
                  className="w-28"
                  onChange={(event) => searchSpace.setRole(rule.id, event.target.value as RuleRole)}
                >
                  <option value="required">Required</option>
                  <option value="optional">Optional</option>
                  <option value="off">Off</option>
                </Select>
              </>
            ) : null}
          </>
        ) : (
          <>
            <span className="min-w-0 flex-1 truncate text-xs">Strategy-level parameters</span>
            <span className="text-muted-foreground shrink-0 text-xs">
              {tuned}/{group.nodes.length} tuned
            </span>
          </>
        )}
      </div>
      {showParameters ? (
        <div className="flex flex-col pb-1 pl-6">
          {group.nodes.map((node) => (
            <OptimizeSearchSpaceParameterRow key={node.id} node={node} searchSpace={searchSpace} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Mode A/B controls for the new-experiment form: per-rule required/optional/off
 * roles with each rule's tunable parameters grouped beneath it. Defaults need
 * no editing: every rule stays required and every parameter is tuned over a
 * conservative range around its current value. In Mode A (tune parameters)
 * roles are hidden and every rule stays as it is in the strategy.
 */
export function OptimizeSearchSpaceEditor({
  searchSpace,
  rolesEditable = true,
}: {
  searchSpace: SearchSpaceHook;
  rolesEditable?: boolean;
}) {
  const { preview, edits, loading, error, issue, summary } = searchSpace;

  const headerNote = loading
    ? "Loading search space…"
    : error
      ? "Search space unavailable; defaults will be used"
      : summary;

  return (
    <section className="flex flex-col gap-2">
      <Separator />
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-medium">Parameters &amp; rules</h3>
        <HelpTip ariaLabel="How rule roles and parameter ranges work">{searchSpaceHelp}</HelpTip>
        <span className="text-muted-foreground ml-auto min-w-0 truncate text-xs">{headerNote}</span>
      </div>

      {preview && edits ? (
        <>
          <div className="relative grid gap-x-12 gap-y-0.5 lg:grid-cols-2">
            <div className="bg-border absolute inset-y-0 left-1/2 hidden w-px lg:block" aria-hidden />
            {ruleParameterGroups(preview).map((group) => (
              <RuleGroup
                key={group.rule?.id ?? "strategy"}
                group={group}
                searchSpace={searchSpace}
                rolesEditable={rolesEditable}
              />
            ))}
          </div>
          {rolesEditable && (preview.at_least_groups ?? []).length > 0 ? (
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
              <span className="text-muted-foreground text-xs">At-least counts</span>
              {preview.at_least_groups.map((group) => (
                <label
                  key={group.id}
                  className="flex items-center gap-1.5"
                  title={`Search how many of the ${group.size} conditions in "${group.id}" must hold (currently ${group.count})`}
                >
                  <input
                    type="checkbox"
                    className="size-3.5 accent-[var(--primary)]"
                    checked={edits.atLeast[group.id] ?? false}
                    aria-label={`Search the at-least count of group ${group.id}`}
                    onChange={(event) =>
                      searchSpace.setAtLeastSearch(group.id, event.target.checked)
                    }
                  />
                  <span className="text-xs">
                    {group.id}: {group.count} of {group.size}
                  </span>
                </label>
              ))}
            </div>
          ) : null}
          {sizingNodes(preview).length > 0 ? (
            <div className="flex flex-col">
              <span className="text-muted-foreground text-xs">
                Backtest sizing (locked unless tuned)
              </span>
              {sizingNodes(preview).map((node) => (
                <OptimizeSearchSpaceSizingRow key={node.id} node={node} searchSpace={searchSpace} />
              ))}
            </div>
          ) : null}
          {issue ? <p className="text-destructive text-xs">{issue}</p> : null}
        </>
      ) : null}
    </section>
  );
}
