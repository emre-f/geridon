import { CheckIcon, RefreshCwIcon, SaveIcon } from "lucide-react";

import type { StrategyValidationResult } from "@/lib/api";
import { describeIssuePath } from "@/lib/strategy";
import { Button } from "@/components/ui/button";

export function StrategyBuilderActions({
  selectedId,
  saving,
  validating,
  validation,
  error,
  onValidate,
  onSave,
}: {
  selectedId: number | null;
  saving: boolean;
  validating: boolean;
  validation: StrategyValidationResult | null;
  error: string | null;
  onValidate: () => void;
  onSave: () => void;
}) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" onClick={onValidate} disabled={validating || saving}>
          {validating ? <RefreshCwIcon className="animate-spin" /> : <CheckIcon />}
          Validate
        </Button>
        <Button type="button" onClick={onSave} disabled={saving || validating}>
          {saving ? <RefreshCwIcon className="animate-spin" /> : <SaveIcon />}
          {selectedId == null ? "Save strategy" : "Save changes"}
        </Button>
        {validation?.valid ? (
          <span className="flex items-center gap-1.5 text-sm text-[var(--chart-up)]">
            <CheckIcon className="size-4" />
            Strategy is valid and ready to run.
          </span>
        ) : null}
      </div>

      {validation && !validation.valid ? (
        <div className="border-destructive/40 bg-destructive/5 rounded-md border p-3">
          <p className="text-destructive text-sm font-medium">
            Fix these issues before running the strategy:
          </p>
          <ul className="text-destructive mt-1.5 flex flex-col gap-1 text-sm">
            {validation.errors.map((issue) => (
              <li key={`${issue.path}-${issue.message}`}>
                <span className="font-medium">{describeIssuePath(issue.path)}:</span>{" "}
                {issue.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {error ? <p className="text-destructive text-sm">{error}</p> : null}
    </>
  );
}
