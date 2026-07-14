import type { RuleLibraryCaps, RuleLibraryTemplateKind } from "@/lib/api";
import { templateKindLabels } from "@/lib/optimize-rule-library-utils";
import type { useOptimizeRuleLibrary } from "@/hooks/use-optimize-rule-library";
import { ruleLibraryHelp } from "@/components/optimize-section-help";
import { Badge } from "@/components/ui/badge";
import { Field } from "@/components/ui/field";
import { HelpTip } from "@/components/ui/help-tip";
import { NumberInput } from "@/components/ui/number-input";
import { Separator } from "@/components/ui/separator";

type RuleLibraryHook = ReturnType<typeof useOptimizeRuleLibrary>;

const capFields: Array<{ key: keyof RuleLibraryCaps; label: string; min: number }> = [
  { key: "maxNewRulesPerSide", label: "New rules per side", min: 0 },
  { key: "maxActiveRulesPerSide", label: "Active rules per side", min: 1 },
  { key: "maxUniqueIndicatorsPerSide", label: "Indicators per side", min: 1 },
  { key: "maxTreeDepth", label: "Tree depth", min: 1 },
];

function SectionLabel({ children }: { children: string }) {
  return (
    <h4 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
      {children}
    </h4>
  );
}

/**
 * Mode C controls for the new-experiment form: the user approves candidate
 * rules from the seeded library, the groups where they may be inserted, and
 * the complexity caps. Rendered only for the evolution method.
 */
export function OptimizeRuleLibraryEditor({ ruleLibrary }: { ruleLibrary: RuleLibraryHook }) {
  const { library, edits, loading, error, issue, summary } = ruleLibrary;

  const headerNote = loading ? "Loading rule library…" : error ?? summary;
  const kinds = library
    ? ([...new Set(library.templates.map((entry) => entry.template))] as RuleLibraryTemplateKind[])
    : [];

  return (
    <section className="flex flex-col gap-3">
      <Separator />
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-medium">Candidate rule library</h3>
        <HelpTip ariaLabel="How the candidate rule library works">{ruleLibraryHelp}</HelpTip>
        <span className="text-muted-foreground ml-auto min-w-0 truncate text-xs">{headerNote}</span>
      </div>

      {library && edits ? (
        <>
          <SectionLabel>Approved rules</SectionLabel>
          <div className="flex flex-col gap-1.5">
            {kinds.map((kind) => (
              <div key={kind} className="flex items-baseline gap-3">
                <span className="text-muted-foreground w-44 shrink-0 text-xs">
                  {templateKindLabels[kind]}
                </span>
                <div className="flex min-w-0 flex-1 flex-wrap gap-x-5 gap-y-1">
                  {library.templates
                    .filter((entry) => entry.template === kind)
                    .map((entry) => (
                      <label
                        key={entry.summary}
                        title={entry.summary}
                        className="flex items-center gap-1.5"
                      >
                        <input
                          type="checkbox"
                          className="size-3.5 accent-[var(--primary)]"
                          checked={edits.approved.includes(entry.summary)}
                          aria-label={`Approve rule ${entry.label ?? entry.summary}`}
                          onChange={() => ruleLibrary.toggleTemplate(entry.summary)}
                        />
                        <span className="text-xs">{entry.label ?? entry.summary}</span>
                      </label>
                    ))}
                </div>
              </div>
            ))}
          </div>

          <SectionLabel>Insertion points</SectionLabel>
          {library.insertion_points.length === 0 ? (
            <p className="text-muted-foreground text-xs">
              This strategy has no and/or group, so no rules can be inserted. The search still
              tunes parameters, operators, and rule toggles.
            </p>
          ) : (
            <div className="flex flex-wrap gap-x-6 gap-y-1">
              {library.insertion_points.map((point) => (
                <label key={point.id} title={point.id} className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    className="size-3.5 accent-[var(--primary)]"
                    checked={edits.insertionPoints.includes(point.id)}
                    aria-label={`Allow insertion into ${point.id}`}
                    onChange={() => ruleLibrary.toggleInsertionPoint(point.id)}
                  />
                  <Badge variant="outline" className="w-14 justify-center">
                    {point.side}
                  </Badge>
                  <span className="text-xs">
                    {point.operator.toUpperCase()} group · {point.size}{" "}
                    {point.size === 1 ? "rule" : "rules"}
                  </span>
                </label>
              ))}
            </div>
          )}

          <SectionLabel>Caps</SectionLabel>
          <div className="flex flex-wrap items-end gap-3">
            {capFields.map(({ key, label, min }) => (
              <Field key={key} label={label}>
                <NumberInput
                  className="w-20"
                  aria-label={`Cap: ${label}`}
                  value={edits.caps[key]}
                  min={min}
                  max={library.limits[key]}
                  step={1}
                  onValueChange={(value) => ruleLibrary.setCap(key, value)}
                />
              </Field>
            ))}
          </div>

          {issue ? <p className="text-destructive text-xs">{issue}</p> : null}
        </>
      ) : null}
    </section>
  );
}
