import { useMemo } from "react";
import {
  CheckIcon,
  CopyIcon,
  RefreshCwIcon,
  SaveIcon,
  Trash2Icon,
} from "lucide-react";

import {
  type IndicatorDefinition,
  type StrategyDraft,
  type StrategyRecord,
  type StrategyValidationResult,
} from "@/lib/api";
import { asRootGroup, describeIssuePath } from "@/lib/strategy";
import { ConditionGroupEditor } from "@/components/strategy-condition-group-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";

interface StrategyBuilderProps {
  catalog: IndicatorDefinition[];
  strategies: StrategyRecord[];
  selectedId: number | null;
  draft: StrategyDraft | null;
  dirty: boolean;
  loading: boolean;
  saving: boolean;
  validating: boolean;
  validation: StrategyValidationResult | null;
  error: string | null;
  onDraftChange: (draft: StrategyDraft) => void;
  onSelectStrategy: (value: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onValidate: () => void;
  onSave: () => void;
}

/**
 * Visual rule builder for trading strategies. Strategies are validated by the
 * backend and stored in SQLite, so they survive browser storage resets.
 */
export function StrategyBuilder({
  catalog,
  strategies,
  selectedId,
  draft,
  dirty,
  loading,
  saving,
  validating,
  validation,
  error,
  onDraftChange,
  onSelectStrategy,
  onDuplicate,
  onDelete,
  onValidate,
  onSave,
}: StrategyBuilderProps) {
  const catalogReady = catalog.length > 0;
  const entryGroup = useMemo(
    () => (draft ? asRootGroup(draft.entry) : null),
    [draft],
  );
  const exitGroup = useMemo(() => (draft ? asRootGroup(draft.exit) : null), [draft]);

  function editDraft(update: (draft: StrategyDraft) => StrategyDraft) {
    if (!draft) {
      return;
    }
    onDraftChange(update(draft));
  }

  return (
    <Card className="gap-4">
      <CardHeader className="gap-4 px-4 sm:px-5 lg:flex lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <CardTitle className="text-xl">Strategy builder</CardTitle>
          <CardDescription>
            Combine indicators, price, and fixed values into entry and exit rules. Strategies are
            validated and stored in the database.
          </CardDescription>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={selectedId == null ? "new" : String(selectedId)}
            aria-label="Stored strategies"
            className="w-48"
            disabled={!catalogReady}
            onChange={(event) => onSelectStrategy(event.target.value)}
          >
            <option value="new">(New)</option>
            {strategies.map((strategy) => (
              <option key={strategy.id} value={strategy.id}>
                {strategy.name}
              </option>
            ))}
          </Select>
          <Button
            type="button"
            variant="outline"
            title="Copy this strategy (including unsaved edits) into a new one, keeping the original as is"
            onClick={onDuplicate}
            disabled={selectedId == null || !draft || saving}
          >
            <CopyIcon />
            Duplicate
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={onDelete}
            disabled={selectedId == null || saving}
          >
            <Trash2Icon />
            Delete
          </Button>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-4 px-4 sm:px-5">
        {loading || !draft || !entryGroup || !exitGroup ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-9 w-64" />
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Name">
                <Input
                  value={draft.name}
                  maxLength={80}
                  aria-label="Strategy name"
                  className="w-64"
                  onChange={(event) =>
                    editDraft((current) => ({ ...current, name: event.target.value }))
                  }
                />
              </Field>
              {dirty ? (
                <Badge variant="secondary" className="mb-1.5">
                  Unsaved changes
                </Badge>
              ) : null}
            </div>

            <section className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <Badge className="border-transparent bg-[var(--chart-up-muted)] text-[var(--chart-up)]">
                  Entry
                </Badge>
                <span className="text-muted-foreground text-xs">
                  Buy when these conditions are met
                </span>
              </div>
              <ConditionGroupEditor
                group={entryGroup}
                catalog={catalog}
                depth={0}
                onChange={(next) => editDraft((current) => ({ ...current, entry: next }))}
              />
            </section>

            <Separator />

            <section className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <Badge className="border-transparent bg-[var(--chart-down-muted)] text-[var(--chart-down)]">
                  Exit
                </Badge>
                <span className="text-muted-foreground text-xs">
                  Sell when these conditions are met
                </span>
              </div>
              <ConditionGroupEditor
                group={exitGroup}
                catalog={catalog}
                depth={0}
                onChange={(next) => editDraft((current) => ({ ...current, exit: next }))}
              />
            </section>

            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={onValidate}
                disabled={validating || saving}
              >
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
                  {validation.errors.map((issue, index) => (
                    <li key={`${issue.path}-${index}`}>
                      <span className="font-medium">{describeIssuePath(issue.path)}:</span>{" "}
                      {issue.message}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {error ? <p className="text-destructive text-sm">{error}</p> : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
