import { useState } from "react";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";

import type { RuleRole } from "@/lib/api";
import { ruleParameterGroups, type RuleParameterGroup } from "@/lib/optimize-search-space-utils";
import type { useOptimizeSearchSpace } from "@/hooks/use-optimize-search-space";
import { searchSpaceHelp } from "@/components/optimize-section-help";
import { OptimizeSearchSpaceParameterRow } from "@/components/optimize-search-space-parameter-row";
import { Badge } from "@/components/ui/badge";
import { HelpTip } from "@/components/ui/help-tip";
import { Select } from "@/components/ui/select";

type SearchSpaceHook = ReturnType<typeof useOptimizeSearchSpace>;

function RuleGroup({
  group,
  searchSpace,
}: {
  group: RuleParameterGroup;
  searchSpace: SearchSpaceHook;
}) {
  const [expanded, setExpanded] = useState(false);
  const { edits } = searchSpace;
  const rule = group.rule;
  const role = rule ? edits?.roles[rule.id] : undefined;
  const off = role === "off";
  const tuned = group.nodes.filter((node) => !edits?.parameters[node.id]?.locked).length;
  const showParameters = expanded && !off && group.nodes.length > 0;

  return (
    <div className="flex flex-col">
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
            <code className="min-w-0 flex-1 truncate font-mono text-xs">{rule.summary}</code>
            <span className="text-muted-foreground shrink-0 text-xs">
              {off
                ? "removed from search"
                : group.nodes.length === 0
                  ? "no parameters"
                  : `${tuned}/${group.nodes.length} tuned`}
            </span>
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
 * Collapsible Mode A/B controls for the new-experiment form: per-rule
 * required/optional/off roles with each rule's tunable parameters grouped
 * beneath it. Defaults need no editing: every rule stays required and every
 * parameter is tuned over a conservative range around its current value.
 */
export function OptimizeSearchSpaceEditor({ searchSpace }: { searchSpace: SearchSpaceHook }) {
  const [open, setOpen] = useState(false);
  const { preview, edits, loading, error, issue, summary } = searchSpace;

  const headerNote = loading
    ? "Loading search space…"
    : error
      ? "Search space unavailable; defaults will be used"
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
        <div className="flex flex-col gap-2 border-t px-3 pt-3 pb-3">
          <div className="flex items-center gap-2">
            <h4 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              Rules
            </h4>
            <HelpTip ariaLabel="How rule roles and parameter ranges work">
              {searchSpaceHelp}
            </HelpTip>
          </div>
          {ruleParameterGroups(preview).map((group) => (
            <RuleGroup key={group.rule?.id ?? "strategy"} group={group} searchSpace={searchSpace} />
          ))}
          {issue ? <p className="text-destructive text-xs">{issue}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
