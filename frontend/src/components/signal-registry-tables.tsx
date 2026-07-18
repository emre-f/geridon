import type {
  RegistryKindSummary,
  SignalEvaluationListItem,
} from "@/lib/api-client-signals-registry";
import {
  formatReturnValue,
  formatTStat,
  formatUtcTimestamp,
  holdoutStatus,
  signalKindLabel,
  verdictMeta,
} from "@/lib/signal-lab-utils";
import { Badge } from "@/components/ui/badge";

const headerCell = "px-2 py-1.5 text-right font-medium";
const numberCell = "px-2 py-1.5 text-right tabular-nums";

export function RegistryKindTable({ kinds }: { kinds: RegistryKindSummary[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-muted-foreground border-b text-xs">
            <th className="py-1.5 pr-3 text-left font-medium">Event kind</th>
            <th className={headerCell}>Runs</th>
            <th className={headerCell}>No signal</th>
            <th className={headerCell}>Weak</th>
            <th className={headerCell}>Candidate</th>
            <th className={headerCell}>Best t</th>
            <th className={headerCell}>Median t</th>
            <th className={headerCell}>Best net</th>
            <th className={headerCell}>Median net</th>
            <th className="py-1.5 pl-3 text-right font-medium">Holdouts</th>
          </tr>
        </thead>
        <tbody>
          {kinds.map((kind) => (
            <tr key={kind.event_kind} className="border-b last:border-b-0">
              <td className="whitespace-nowrap py-1.5 pr-3 font-medium">
                {signalKindLabel(kind.event_kind)}
              </td>
              <td className={numberCell}>{kind.evaluations}</td>
              <td className={numberCell}>{kind.verdicts.no_signal}</td>
              <td className={numberCell}>{kind.verdicts.weak}</td>
              <td className={numberCell}>{kind.verdicts.candidate}</td>
              <td className={numberCell}>{formatTStat(kind.best_t_stat)}</td>
              <td className={numberCell}>{formatTStat(kind.median_t_stat)}</td>
              <td className={numberCell}>{formatReturnValue(kind.best_net_abnormal_return)}</td>
              <td className={numberCell}>{formatReturnValue(kind.median_net_abnormal_return)}</td>
              <td className="py-1.5 pl-3 text-right tabular-nums">{kind.holdouts_consumed}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HoldoutCell({ evaluation }: { evaluation: SignalEvaluationListItem }) {
  const status = holdoutStatus(evaluation);
  if (status === "consumed") {
    return (
      <span className="text-muted-foreground text-xs">
        consumed {formatUtcTimestamp(evaluation.holdout_consumed_at as string)}
      </span>
    );
  }
  if (status === "available") {
    return <span className="text-xs font-medium">available</span>;
  }
  return <span className="text-muted-foreground text-xs">locked</span>;
}

export function RegistryEvaluationsTable({
  evaluations,
  onOpen,
}: {
  evaluations: SignalEvaluationListItem[];
  onOpen?: (id: number) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-muted-foreground border-b text-xs">
            <th className="py-1.5 pr-3 text-left font-medium">Evaluation</th>
            <th className="px-2 py-1.5 text-left font-medium">Event kind</th>
            <th className="px-2 py-1.5 text-left font-medium">Run</th>
            <th className="px-2 py-1.5 text-left font-medium">Verdict</th>
            <th className={headerCell}>t-stat</th>
            <th className={headerCell}>Net</th>
            <th className={headerCell}>Events</th>
            <th className="py-1.5 pl-3 text-left font-medium">Holdout</th>
          </tr>
        </thead>
        <tbody>
          {evaluations.map((evaluation) => {
            const meta = verdictMeta[evaluation.verdict];
            return (
              <tr key={evaluation.id} className="border-b last:border-b-0">
                <td className="py-1.5 pr-3">
                  {onOpen ? (
                    <button
                      type="button"
                      className="text-foreground font-medium underline-offset-2 hover:underline"
                      onClick={() => onOpen(evaluation.id)}
                    >
                      #{evaluation.id}
                    </button>
                  ) : (
                    <span className="font-medium">#{evaluation.id}</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-2 py-1.5">
                  {signalKindLabel(evaluation.event_kind)}
                </td>
                <td className="whitespace-nowrap px-2 py-1.5">
                  {formatUtcTimestamp(evaluation.created_at)}
                </td>
                <td className="px-2 py-1.5">
                  <Badge variant={meta.badgeVariant}>{meta.label}</Badge>
                </td>
                <td className={numberCell}>{formatTStat(evaluation.headline.baseline_gap_t_stat)}</td>
                <td className={numberCell}>
                  {formatReturnValue(evaluation.headline.net_abnormal_return)}
                </td>
                <td className={numberCell}>{evaluation.headline.n_events.toLocaleString()}</td>
                <td className="whitespace-nowrap py-1.5 pl-3">
                  <HoldoutCell evaluation={evaluation} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
