import type { BacktestRunRecord, IndicatorDefinition, IndicatorKind } from "@/lib/api";
import { formatRanAt, formatRunRange, formatRunSizing } from "@/lib/backtest-utils";
import { StrategyRulesSummary } from "@/components/strategy-rules-summary";

export function BacktestStrategyDetails({
  activeRun,
  strategyName,
  definitionsByKind,
}: {
  activeRun: BacktestRunRecord;
  strategyName: string;
  definitionsByKind: Map<IndicatorKind, IndicatorDefinition>;
}) {
  const rows = [
    { label: "Name", value: strategyName },
    { label: "Ran", value: formatRanAt(activeRun.created_at) },
    { label: "Period", value: formatRunRange(activeRun) },
    { label: "Timeframe", value: activeRun.timeframe.toUpperCase() },
    { label: "Sizing", value: formatRunSizing(activeRun) },
  ];

  return (
    <div className="flex flex-col gap-5 text-sm">
      <dl className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-3 lg:grid-cols-5">
        {rows.map((row) => (
          <div key={row.label} className="flex flex-col gap-0.5">
            <dt className="text-muted-foreground text-xs">{row.label}</dt>
            <dd className="font-medium">{row.value}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-col gap-2">
        <span className="text-muted-foreground">Entry &amp; exit rules</span>
        <StrategyRulesSummary
          snapshot={activeRun.strategy_snapshot}
          definitionsByKind={definitionsByKind}
        />
      </div>
    </div>
  );
}
