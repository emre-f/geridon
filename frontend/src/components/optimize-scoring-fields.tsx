import type { OptimizationObjective, ScoringConfig } from "@/lib/api";
import {
  objectiveLabels,
  scoringIssue,
  scoringSummary,
} from "@/lib/optimize-scoring-utils";
import { Field } from "@/components/ui/field";
import { HelpTip } from "@/components/ui/help-tip";
import { NumberInput } from "@/components/ui/number-input";
import { Select } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";

const scoringHelp = (
  <div className="flex flex-col gap-1.5">
    <p>
      <strong>The robust score</strong> is the median objective across
      validation folds minus the penalties, so a candidate must earn its
      drawdowns, churn, and complexity.
    </p>
    <ul className="flex list-disc flex-col gap-0.5 pl-3.5">
      <li>
        <strong>Objective:</strong> what each fold is measured by; Sharpe is
        recommended because raw return ignores risk
      </li>
      <li>
        <strong>Penalties:</strong> weights per unit of median drawdown, fold
        instability, turnover, and strategy complexity
      </li>
      <li>
        <strong>Constraints:</strong> hard filters; failing any makes a
        candidate ineligible no matter its score
      </li>
    </ul>
    <p>The defaults are calibrated on fixtures; change them deliberately.</p>
  </div>
);

const penaltyFields = [
  ["drawdown", "Drawdown", 0.01],
  ["instability", "Instability", 0.05],
  ["turnover", "Turnover", 0.01],
  ["complexity", "Complexity", 0.01],
] as const;

export function OptimizeScoringFields({
  scoring,
  onScoringChange,
}: {
  scoring: ScoringConfig;
  onScoringChange: (scoring: ScoringConfig) => void;
}) {
  const issue = scoringIssue(scoring);

  return (
    <section className="flex flex-col gap-2">
      <Separator />
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-medium">Objective &amp; constraints</h3>
        <HelpTip ariaLabel="How candidates are scored and filtered">
          {scoringHelp}
        </HelpTip>
        <span className="text-muted-foreground ml-auto min-w-0 truncate text-xs">
          {scoringSummary(scoring)}
        </span>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <Field label="Objective">
          <Select
            value={scoring.objective}
            aria-label="Scoring objective"
            className="w-44"
            onChange={(event) =>
              onScoringChange({
                ...scoring,
                objective: event.target.value as OptimizationObjective,
              })
            }
          >
            {Object.entries(objectiveLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
                {value === "sharpe" ? " (recommended)" : ""}
              </option>
            ))}
          </Select>
        </Field>
        {penaltyFields.map(([key, label, step]) => (
          <Field key={key} label={`${label} penalty`}>
            <NumberInput
              className="w-20"
              aria-label={`${label} penalty weight`}
              value={scoring.penalties[key]}
              min={0}
              max={10}
              step={step}
              onValueChange={(value) =>
                onScoringChange({
                  ...scoring,
                  penalties: { ...scoring.penalties, [key]: value },
                })
              }
            />
          </Field>
        ))}
        <Field label="Min trades">
          <NumberInput
            className="w-20"
            aria-label="Minimum total trades"
            value={scoring.constraints.minTotalTrades}
            min={0}
            max={10_000}
            step={1}
            onValueChange={(value) =>
              onScoringChange({
                ...scoring,
                constraints: { ...scoring.constraints, minTotalTrades: value },
              })
            }
          />
        </Field>
        <Field label="Max drawdown %">
          <NumberInput
            className="w-20"
            aria-label="Maximum fold drawdown percent"
            value={scoring.constraints.maxDrawdownPct}
            min={1}
            max={100}
            step={1}
            onValueChange={(value) =>
              onScoringChange({
                ...scoring,
                constraints: { ...scoring.constraints, maxDrawdownPct: value },
              })
            }
          />
        </Field>
        <Field label="Min positive folds %">
          <NumberInput
            className="w-20"
            aria-label="Minimum positive fold percent"
            value={Math.round(
              scoring.constraints.minPositiveFoldFraction * 100,
            )}
            min={0}
            max={100}
            step={5}
            onValueChange={(value) =>
              onScoringChange({
                ...scoring,
                constraints: {
                  ...scoring.constraints,
                  minPositiveFoldFraction: value / 100,
                },
              })
            }
          />
        </Field>
      </div>
      {issue ? <p className="text-destructive text-xs">{issue}</p> : null}
    </section>
  );
}
