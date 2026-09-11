import type { SignalSelectionStats } from "@/lib/api-client-signals-evaluations";
import { exclusionSummary, type SignalEvaluationFormState } from "@/lib/signal-evaluation-query";
import { Field } from "@/components/ui/field";
import { HelpTip } from "@/components/ui/help-tip";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";

export function SignalPayloadFilterFields({
  form,
  onChange,
}: {
  form: SignalEvaluationFormState;
  onChange: (patch: Partial<SignalEvaluationFormState>) => void;
}) {
  if (form.kind === "insider_cluster_buy") {
    return (
      <>
        <Field label="Min insiders">
          <Input
            inputMode="numeric"
            value={form.minInsiderCount}
            placeholder="any"
            className="w-24"
            aria-label="Minimum insiders in cluster"
            onChange={(event) => onChange({ minInsiderCount: event.target.value })}
          />
        </Field>
        <Field label="Min combined $">
          <Input
            inputMode="decimal"
            value={form.minCombinedDollarValue}
            placeholder="any"
            className="w-28"
            aria-label="Minimum combined dollar value"
            onChange={(event) => onChange({ minCombinedDollarValue: event.target.value })}
          />
        </Field>
      </>
    );
  }
  if (form.kind === "earnings_beat" || form.kind === "earnings_miss") {
    return (
      <Field label="Min estimates">
        <Input
          inputMode="numeric"
          value={form.minNumEstimates}
          placeholder="any"
          className="w-24"
          aria-label="Minimum analyst estimates"
          onChange={(event) => onChange({ minNumEstimates: event.target.value })}
        />
      </Field>
    );
  }
  if (form.kind === "short_interest_report" || form.kind === "short_interest_spike") {
    return (
      <>
        <Field label="Min days to cover">
          <Input
            inputMode="decimal"
            value={form.minDaysToCover}
            placeholder="any"
            className="w-24"
            aria-label="Minimum days to cover"
            onChange={(event) => onChange({ minDaysToCover: event.target.value })}
          />
        </Field>
        <Field label="Min change %">
          <Input
            inputMode="decimal"
            value={form.minChangePercent}
            placeholder="any"
            className="w-24"
            aria-label="Minimum change percent vs prior cycle"
            onChange={(event) => onChange({ minChangePercent: event.target.value })}
          />
        </Field>
      </>
    );
  }
  if (form.kind === "congress_buy" || form.kind === "congress_sell") {
    return (
      <>
        <Field label="Min amount $">
          <Input
            inputMode="decimal"
            value={form.minAmountLow}
            placeholder="any"
            className="w-28"
            aria-label="Minimum amount range low"
            onChange={(event) => onChange({ minAmountLow: event.target.value })}
          />
        </Field>
        <Field label="Min disclosure lag">
          <Input
            inputMode="numeric"
            value={form.minDisclosureLagDays}
            placeholder="any"
            className="w-24"
            aria-label="Minimum disclosure lag in days"
            onChange={(event) => onChange({ minDisclosureLagDays: event.target.value })}
          />
        </Field>
        <label className="flex items-center gap-1.5 pt-5 text-sm">
          <input
            type="checkbox"
            className="size-3.5 accent-[var(--primary)]"
            checked={form.promptDisclosuresOnly}
            onChange={(event) => onChange({ promptDisclosuresOnly: event.target.checked })}
          />
          Prompt disclosures only
        </label>
      </>
    );
  }
  return (
    <>
      <Field label="Min trade $">
        <Input
          inputMode="decimal"
          value={form.minDollarValue}
          placeholder="any"
          className="w-28"
          aria-label="Minimum trade dollar value"
          onChange={(event) => onChange({ minDollarValue: event.target.value })}
        />
      </Field>
      <label className="flex items-center gap-1.5 pt-5 text-sm">
        <input
          type="checkbox"
          className="size-3.5 accent-[var(--primary)]"
          checked={form.officersOnly}
          onChange={(event) => onChange({ officersOnly: event.target.checked })}
        />
        Officers only
      </label>
    </>
  );
}

export function SignalUniverseAndRangeFields({
  form,
  onChange,
}: {
  form: SignalEvaluationFormState;
  onChange: (patch: Partial<SignalEvaluationFormState>) => void;
}) {
  return (
    <>
      <Field
        label="Min price"
        labelExtra={
          <HelpTip ariaLabel="About universe filters">
            <span className="font-medium">Universe filters</span>
            <ul className="mt-1 list-disc pl-4">
              <li>Point-in-time: medians over the 63 bars before each event.</li>
              <li>Filters penny stocks and illiquid names where fills are fiction.</li>
            </ul>
          </HelpTip>
        }
      >
        <Input
          inputMode="decimal"
          value={form.minPrice}
          placeholder="any"
          className="w-20"
          aria-label="Minimum median price"
          onChange={(event) => onChange({ minPrice: event.target.value })}
        />
      </Field>
      <Field label="Min median $ volume">
        <Input
          inputMode="decimal"
          value={form.minMedianDollarVolume}
          placeholder="any"
          className="w-28"
          aria-label="Minimum median dollar volume"
          onChange={(event) => onChange({ minMedianDollarVolume: event.target.value })}
        />
      </Field>
      <Field label="From">
        <Input
          type="date"
          value={form.startDate}
          aria-label="Evaluation start date"
          className="w-36"
          onChange={(event) => onChange({ startDate: event.target.value })}
        />
      </Field>
      <Field label="To">
        <Input
          type="date"
          value={form.endDate}
          aria-label="Evaluation end date"
          className="w-36"
          onChange={(event) => onChange({ endDate: event.target.value })}
        />
      </Field>
      <Field label="Seed">
        <NumberInput
          className="w-20"
          aria-label="Evaluation seed"
          value={form.seed}
          min={0}
          max={1_000_000}
          step={1}
          onValueChange={(seed) => onChange({ seed })}
        />
      </Field>
    </>
  );
}

export function SignalSelectionPreview({
  stats,
  error,
}: {
  stats: SignalSelectionStats | null;
  error: string | null;
}) {
  if (error != null) {
    return <p className="text-destructive text-sm">{error}</p>;
  }
  if (stats == null) {
    return <p className="text-muted-foreground text-sm">Previewing selection…</p>;
  }
  const exclusions = exclusionSummary(stats);
  return (
    <p className="text-sm">
      <span className="font-medium">
        {stats.selected.toLocaleString()} events, {stats.tickers.toLocaleString()} tickers
      </span>
      <span className="text-muted-foreground">
        {" "}
        of {stats.candidates.toLocaleString()} candidates
        {exclusions.length > 0 ? ` (excluded: ${exclusions.join(", ")})` : ""}
        {stats.holdout_clamped ? ". Range clamped to before the holdout boundary." : ""}
      </span>
    </p>
  );
}
