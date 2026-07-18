import { useEffect, useMemo, useRef, useState } from "react";
import { FlaskConicalIcon, PlayIcon, RefreshCwIcon } from "lucide-react";

import {
  createSignalEvaluation,
  previewSignalSelection,
  signalEventKinds,
  type SignalJobRow,
  type SignalSelectionStats,
} from "@/lib/api-client-signals-evaluations";
import {
  buildSignalQuery,
  initialSignalEvaluationForm,
  signalKindLabels,
  type SignalEvaluationFormState,
} from "@/lib/signal-evaluation-query";
import {
  SignalPayloadFilterFields,
  SignalSelectionPreview,
  SignalUniverseAndRangeFields,
} from "@/components/signal-evaluation-fields";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";

const previewDebounceMs = 400;

export function SignalEvaluationForm({
  onJobCreated,
}: {
  onJobCreated: (job: SignalJobRow) => void;
}) {
  const [form, setForm] = useState(initialSignalEvaluationForm);
  const [preview, setPreview] = useState<SignalSelectionStats | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const requestRef = useRef(0);

  const query = useMemo(() => buildSignalQuery(form), [form]);

  useEffect(() => {
    const requestId = ++requestRef.current;
    const timeout = window.setTimeout(async () => {
      try {
        const { stats } = await previewSignalSelection(query);
        if (requestRef.current === requestId) {
          setPreview(stats);
          setPreviewError(null);
        }
      } catch (cause) {
        if (requestRef.current === requestId) {
          setPreviewError(cause instanceof Error ? cause.message : "Preview failed.");
        }
      }
    }, previewDebounceMs);
    return () => window.clearTimeout(timeout);
  }, [query]);

  function update(patch: Partial<SignalEvaluationFormState>) {
    setForm((previous) => ({ ...previous, ...patch }));
  }

  async function handleRun() {
    setCreating(true);
    setSubmitError(null);
    try {
      onJobCreated(await createSignalEvaluation({ ...query, seed: form.seed }));
    } catch (cause) {
      setSubmitError(cause instanceof Error ? cause.message : "Could not start the evaluation.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <Card className="gap-4">
      <CardHeader className="gap-1 px-4 sm:px-5">
        <CardTitle className="flex items-center gap-2 text-xl">
          <FlaskConicalIcon className="size-5" />
          Evaluate an event signal
        </CardTitle>
        <CardDescription>
          Pooled event study across every ticker with data: does this event kind predict abnormal
          returns after costs? Every run is recorded in the registry, so the draw counter stays
          honest.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 px-4 sm:px-5">
        <div className="flex flex-wrap items-start gap-4">
          <div className="flex flex-wrap items-start gap-3">
            <Field label="Event kind">
              <Select
                value={form.kind}
                aria-label="Event kind"
                className="w-44"
                onChange={(event) =>
                  update({ kind: event.target.value as SignalEvaluationFormState["kind"] })
                }
              >
                {signalEventKinds.map((kind) => (
                  <option key={kind} value={kind}>
                    {signalKindLabels[kind]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Min score">
              <Input
                inputMode="decimal"
                value={form.minScore}
                placeholder="any"
                className="w-20"
                aria-label="Minimum event score"
                onChange={(event) => update({ minScore: event.target.value })}
              />
            </Field>
            <SignalPayloadFilterFields form={form} onChange={update} />
          </div>

          <Separator orientation="vertical" className="hidden h-auto self-stretch sm:block" />

          <div className="flex flex-wrap items-start gap-3">
            <SignalUniverseAndRangeFields form={form} onChange={update} />
          </div>
        </div>

        <SignalSelectionPreview stats={preview} error={previewError} />

        <div className="text-muted-foreground rounded-md border p-3 text-xs">
          <p className="text-foreground font-medium">Before you run</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            <li>
              Holdout boundary: events from Jan 1, 2025 onward are sealed out of every evaluation.
              Only the one-shot holdout check on a candidate may spend them.
            </li>
            <li>
              Survivorship caveat: the universe is tickers with candle data today, so delisted
              names are missing and results skew optimistic.
            </li>
          </ul>
        </div>

        {submitError != null ? <p className="text-destructive text-sm">{submitError}</p> : null}

        <div>
          <Button type="button" onClick={handleRun} disabled={creating}>
            {creating ? <RefreshCwIcon className="animate-spin" /> : <PlayIcon />}
            Run evaluation
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
