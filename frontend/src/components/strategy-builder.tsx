import { useMemo } from "react";
import { CopyIcon, PlusIcon, Trash2Icon } from "lucide-react";

import {
  type IndicatorDefinition,
  type StrategyDraft,
  type StrategyRecord,
  type StrategyValidationResult,
} from "@/lib/api";
import { asRootGroup, createCashGroup } from "@/lib/strategy";
import { StrategyBuilderActions } from "@/components/strategy-builder-actions";
import { StrategyTreeSection } from "@/components/strategy-tree-section";
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
  const cashGroup = useMemo(
    () => (draft?.cash ? asRootGroup(draft.cash) : null),
    [draft],
  );

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

            <StrategyTreeSection
              label="Entry"
              badgeClassName="border-transparent bg-[var(--chart-up-muted)] text-[var(--chart-up)]"
              hint="Go long when these conditions are met"
              group={entryGroup}
              catalog={catalog}
              onChange={(next) => editDraft((current) => ({ ...current, entry: next }))}
            />

            <Separator />

            <StrategyTreeSection
              label="Exit"
              badgeClassName="border-transparent bg-[var(--chart-down-muted)] text-[var(--chart-down)]"
              hint="Sell — or, in three-state mode, go short — when these conditions are met"
              group={exitGroup}
              catalog={catalog}
              onChange={(next) => editDraft((current) => ({ ...current, exit: next }))}
            />

            <Separator />

            {cashGroup ? (
              <StrategyTreeSection
                label="Cash"
                badgeClassName="border-transparent bg-muted text-muted-foreground"
                hint="Three-state mode only: return to cash when these conditions are met"
                group={cashGroup}
                catalog={catalog}
                onChange={(next) => editDraft((current) => ({ ...current, cash: next }))}
                onRemove={() =>
                  editDraft(({ cash: _dropped, ...rest }) => rest)
                }
              />
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="self-start"
                onClick={() =>
                  editDraft((current) => ({ ...current, cash: createCashGroup() }))
                }
              >
                <PlusIcon />
                Add cash rules (three-state)
              </Button>
            )}

            <StrategyBuilderActions
              selectedId={selectedId}
              saving={saving}
              validating={validating}
              validation={validation}
              error={error}
              onValidate={onValidate}
              onSave={onSave}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}
