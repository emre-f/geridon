import type { SignalEvaluationRecord } from "@/lib/api-client-signals-registry";
import {
  formatReturnValue,
  formatTStat,
  formatUtcTimestamp,
  verdictMeta,
} from "@/lib/signal-lab-utils";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Tile {
  label: string;
  value: string;
  detail?: string;
  tone?: string;
}

function returnTone(value: number | null | undefined) {
  if (value == null || value === 0) {
    return undefined;
  }
  return value > 0 ? "text-[var(--chart-up)]" : "text-[var(--chart-down)]";
}

function buildTiles(evaluation: SignalEvaluationRecord): Tile[] {
  const { headline, detail } = evaluation;
  const holdingPeriod = detail?.horizon_summary.natural_holding_period_bars ?? null;
  const costLine = detail?.cost_line ?? null;
  return [
    {
      label: "Baseline-gap t-stat",
      value: formatTStat(headline.baseline_gap_t_stat),
      detail: "block t-stat at the headline horizon",
    },
    {
      label: "Net abnormal return",
      value: formatReturnValue(headline.net_abnormal_return),
      detail:
        costLine == null
          ? undefined
          : `gross ${formatReturnValue(costLine.gross_abnormal_return)}, costs ${formatReturnValue(costLine.round_trip_cost).replace("+", "")} round trip`,
      tone: returnTone(headline.net_abnormal_return),
    },
    {
      label: "Events",
      value: headline.n_events.toLocaleString(),
      detail: detail == null ? undefined : `${detail.study.n_tickers.toLocaleString()} tickers`,
    },
    {
      label: "Natural holding period",
      value: holdingPeriod == null ? "—" : `${holdingPeriod} bars`,
      detail: holdingPeriod == null ? "gap never goes positive" : "where the gap stops growing",
    },
  ];
}

function SelectionNotes({ evaluation }: { evaluation: SignalEvaluationRecord }) {
  const selection = evaluation.detail?.selection;
  return (
    <div className="text-muted-foreground space-y-1 text-xs">
      {selection ? (
        <p>
          {selection.selected.toLocaleString()} of {selection.candidates.toLocaleString()} candidate
          events selected across {selection.tickers.toLocaleString()} tickers.
          {selection.holdout_clamped ? " Date range clamped to before the holdout boundary." : ""}
        </p>
      ) : null}
      <p>
        Candle universe is survivorship-biased: today's listings only, delisted losers missing, so
        long-side results skew high.
      </p>
    </div>
  );
}

export function SignalVerdictCard({ evaluation }: { evaluation: SignalEvaluationRecord }) {
  const meta = verdictMeta[evaluation.verdict];
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>Verdict</CardTitle>
          <Badge variant={meta.badgeVariant}>{meta.label}</Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-muted-foreground text-sm">{meta.description}</p>
        <dl className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {buildTiles(evaluation).map((tile) => (
            <div key={tile.label} className="bg-muted/30 flex flex-col gap-0.5 rounded-md p-2.5">
              <dt className="text-muted-foreground text-xs">{tile.label}</dt>
              <dd className="flex flex-col">
                <span className={cn("text-lg font-semibold", tile.tone)}>{tile.value}</span>
                {tile.detail ? (
                  <span className="text-muted-foreground/70 text-[11px]">{tile.detail}</span>
                ) : null}
              </dd>
            </div>
          ))}
        </dl>
        <SelectionNotes evaluation={evaluation} />
      </CardContent>
    </Card>
  );
}

export function SignalHoldoutCard({ evaluation }: { evaluation: SignalEvaluationRecord }) {
  const results = evaluation.holdout_results;
  if (evaluation.holdout_consumed_at == null || results == null) {
    return null;
  }
  const meta = verdictMeta[results.verdict];
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>Holdout check</CardTitle>
          <Badge variant={meta.badgeVariant}>{meta.label}</Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <p className="text-muted-foreground text-sm">
          Same query and seed rerun once on the sealed window, consumed{" "}
          {formatUtcTimestamp(evaluation.holdout_consumed_at)}.
        </p>
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <span>
            <span className="text-muted-foreground">t-stat </span>
            <span className="tabular-nums font-medium">
              {formatTStat(results.headline.baseline_gap_t_stat)}
            </span>
          </span>
          <span>
            <span className="text-muted-foreground">net </span>
            <span className={cn("tabular-nums font-medium", returnTone(results.headline.net_abnormal_return))}>
              {formatReturnValue(results.headline.net_abnormal_return)}
            </span>
          </span>
          <span>
            <span className="text-muted-foreground">events </span>
            <span className="tabular-nums font-medium">
              {results.headline.n_events.toLocaleString()}
            </span>
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
