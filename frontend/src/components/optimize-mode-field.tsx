import type { SearchMode } from "@/hooks/use-optimize-experiment-form";
import { Field } from "@/components/ui/field";
import { HelpTip } from "@/components/ui/help-tip";
import { Select } from "@/components/ui/select";

const modeHelp = (
  <div className="flex flex-col gap-1.5">
    <p>
      <strong>The mode bounds what the search may change.</strong> Start small: a bigger space
      needs more trials for the same confidence.
    </p>
    <ul className="flex list-disc flex-col gap-0.5 pl-3.5">
      <li>
        <strong>A · Tune parameters:</strong> keeps every rule as it is and searches numeric
        values only
      </li>
      <li>
        <strong>B · Select rules:</strong> also lets marked rules be kept required, tried
        optionally, or turned off
      </li>
      <li>
        <strong>C · Explore new rules:</strong> evolution search that may also insert rules you
        approve from a bounded library
      </li>
    </ul>
  </div>
);

export function OptimizeModeField({
  mode,
  onModeChange,
}: {
  mode: SearchMode;
  onModeChange: (mode: SearchMode) => void;
}) {
  return (
    <Field label="Search mode" labelExtra={<HelpTip ariaLabel="What the search modes mean">{modeHelp}</HelpTip>}>
      <Select
        value={mode}
        aria-label="Search mode"
        className="w-48"
        onChange={(event) => onModeChange(event.target.value as SearchMode)}
      >
        <option value="tune">A · Tune parameters</option>
        <option value="prune">B · Select rules</option>
        <option value="explore">C · Explore new rules</option>
      </Select>
    </Field>
  );
}
