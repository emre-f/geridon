import { useMemo, useState } from "react";

import type { BucketStudy, ScoreAnalysis } from "@/lib/api-client-signals-registry";
import { formatCompact } from "@/lib/format";
import { niceTicks, roundedBarPath } from "@/lib/chart-scale";
import { formatReturnValue, formatScaledTick, returnScaleFor, signalFlagLabel } from "@/lib/signal-lab-utils";
import { useElementSize } from "@/hooks/use-element-size";

const margin = { top: 16, right: 14, bottom: 34, left: 48 };
const height = 200;
const maxBarWidth = 24;
const barColor = "var(--viz-baseline)";

function bucketTag(index: number, total: number) {
  if (index === 0) {
    return "low score";
  }
  return index === total - 1 ? "high score" : "";
}

function BucketBars({ analysis }: { analysis: ScoreAnalysis }) {
  const [containerRef, { width }] = useElementSize<HTMLDivElement>();
  const [hovered, setHovered] = useState<number | null>(null);
  const buckets = analysis.score_buckets;

  const plot = useMemo(() => {
    if (buckets.length === 0 || width <= 0) {
      return null;
    }
    const rawValues = [0, ...buckets.map((b) => b.reference_gap).filter((v): v is number => v != null)];
    const { unit, scale } = returnScaleFor(Math.max(...rawValues.map(Math.abs)));
    let min = Math.min(...rawValues) * scale;
    let max = Math.max(...rawValues) * scale;
    const pad = (max - min || 1) * 0.08;
    min = min < 0 ? min - pad : min;
    max = max > 0 ? max + pad : max;

    const innerWidth = Math.max(width - margin.left - margin.right, 10);
    const innerHeight = height - margin.top - margin.bottom;
    const band = innerWidth / buckets.length;
    const barWidth = Math.min(maxBarWidth, Math.max(4, band - 8));
    const yAt = (scaled: number) => margin.top + ((max - scaled) / (max - min)) * innerHeight;

    return {
      unit,
      scale,
      innerWidth,
      innerHeight,
      band,
      barWidth,
      yAt,
      zeroY: yAt(0),
      yTicks: niceTicks(min, max).map((value) => ({ value, y: yAt(value) })),
    };
  }, [buckets, width]);

  const hoveredBucket = hovered != null ? buckets[hovered] : null;

  return (
    <div ref={containerRef} className="relative w-full">
      <svg
        role="img"
        aria-label="Gap versus baseline at the reference horizon per score bucket, low to high"
        width="100%"
        height={height}
        viewBox={width > 0 ? `0 0 ${width} ${height}` : undefined}
        onPointerLeave={() => setHovered(null)}
      >
        {plot ? (
          <>
            {plot.yTicks.map((tick) => (
              <g key={tick.value}>
                <line
                  x1={margin.left}
                  x2={margin.left + plot.innerWidth}
                  y1={tick.y}
                  y2={tick.y}
                  stroke={tick.value === 0 ? "var(--muted-foreground)" : "var(--border)"}
                  strokeWidth={1}
                  opacity={tick.value === 0 ? 0.6 : 0.55}
                />
                <text x={margin.left - 8} y={tick.y + 3.5} fontSize={11} fill="var(--muted-foreground)" textAnchor="end">
                  {formatScaledTick(tick.value)}
                </text>
              </g>
            ))}
            <text x={margin.left - 8} y={margin.top - 5} fontSize={10} fill="var(--muted-foreground)" textAnchor="end">
              {plot.unit}
            </text>

            {buckets.map((bucket, index) => {
              const value = bucket.reference_gap;
              const centerX = margin.left + index * plot.band + plot.band / 2;
              return (
                <g key={bucket.label} opacity={hovered == null || hovered === index ? 1 : 0.5}>
                  {value != null ? (
                    <path
                      d={roundedBarPath(
                        centerX - plot.barWidth / 2,
                        Math.min(plot.yAt(value * plot.scale), plot.zeroY),
                        plot.barWidth,
                        Math.max(Math.abs(plot.yAt(value * plot.scale) - plot.zeroY), 1),
                        4,
                        value >= 0
                          ? { topLeft: true, topRight: true }
                          : { bottomLeft: true, bottomRight: true },
                      )}
                      fill={barColor}
                    />
                  ) : (
                    <text x={centerX} y={plot.zeroY - 6} fontSize={10} fill="var(--muted-foreground)" textAnchor="middle">
                      no data
                    </text>
                  )}
                  <text x={centerX} y={height - 18} fontSize={11} fill="var(--foreground)" textAnchor="middle">
                    {bucket.label.toUpperCase()}
                  </text>
                  <text x={centerX} y={height - 6} fontSize={10} fill="var(--muted-foreground)" textAnchor="middle">
                    {[bucketTag(index, buckets.length), `${formatCompact(bucket.n_events)} events`]
                      .filter(Boolean)
                      .join(" · ")}
                  </text>
                  <rect
                    x={margin.left + index * plot.band}
                    y={margin.top}
                    width={plot.band}
                    height={plot.innerHeight}
                    fill="transparent"
                    onPointerEnter={() => setHovered(index)}
                  />
                </g>
              );
            })}
          </>
        ) : null}
      </svg>

      {plot && hoveredBucket && hovered != null ? (
        <div
          className="border-border bg-popover text-popover-foreground pointer-events-none absolute z-10 w-56 rounded-md border p-2.5 text-xs shadow-md"
          style={{
            top: 8,
            left: Math.min(
              Math.max(margin.left + hovered * plot.band + plot.band / 2 - 112, 0),
              Math.max(width - 232, 0),
            ),
          }}
        >
          <div className="font-medium">Bucket {hoveredBucket.label.toUpperCase()}</div>
          <dl className="mt-1 space-y-0.5">
            {[
              { label: `Gap at ${analysis.reference_horizon} bars`, value: formatReturnValue(hoveredBucket.reference_gap) },
              { label: "Peak gap", value: formatReturnValue(hoveredBucket.peak_gap) },
              {
                label: "Natural hold",
                value:
                  hoveredBucket.natural_holding_period_bars == null
                    ? "—"
                    : `${hoveredBucket.natural_holding_period_bars} bars`,
              },
              { label: "Events", value: hoveredBucket.n_events.toLocaleString() },
              {
                label: "Score range",
                value:
                  hoveredBucket.min_score == null || hoveredBucket.max_score == null
                    ? "—"
                    : `${hoveredBucket.min_score.toFixed(2)} to ${hoveredBucket.max_score.toFixed(2)}`,
              },
            ].map((row) => (
              <div key={row.label} className="flex items-center justify-between gap-2">
                <dt className="text-muted-foreground">{row.label}</dt>
                <dd className="tabular-nums font-medium">{row.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
    </div>
  );
}

function FlagSplitCell({ bucket }: { bucket: BucketStudy }) {
  return (
    <span className="tabular-nums">
      {formatReturnValue(bucket.reference_gap)}
      <span className="text-muted-foreground"> · {formatCompact(bucket.n_events)} ev</span>
    </span>
  );
}

function FlagSplitRow({ field, withFlag, withoutFlag, missing }: {
  field: string;
  withFlag: BucketStudy;
  withoutFlag: BucketStudy;
  missing: number;
}) {
  return (
    <tr className="border-b last:border-b-0">
      <td className="py-1.5 pr-3 font-medium">{signalFlagLabel(field)}</td>
      <td className="px-2 py-1.5 text-right"><FlagSplitCell bucket={withFlag} /></td>
      <td className="px-2 py-1.5 text-right"><FlagSplitCell bucket={withoutFlag} /></td>
      <td className="text-muted-foreground py-1.5 pl-3 text-right tabular-nums">{missing.toLocaleString()}</td>
    </tr>
  );
}

export function SignalScoreBuckets({ analysis }: { analysis: ScoreAnalysis }) {
  const monotonic = analysis.monotonic_in_score;
  return (
    <div className="flex flex-col gap-3">
      <BucketBars analysis={analysis} />
      <p className="text-muted-foreground px-1 text-xs">
        {monotonic == null
          ? "Monotonicity in score: not measurable (a bucket is missing a gap)."
          : monotonic
            ? "Gap increases strictly with score: strong evidence the score means something."
            : "Gap is not monotonic in score."}
        {analysis.unscored_events > 0
          ? ` ${analysis.unscored_events.toLocaleString()} unscored events excluded from buckets.`
          : ""}
      </p>
      {analysis.flag_splits.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground border-b text-xs">
                <th className="py-1.5 pr-3 text-left font-medium">Payload flag</th>
                <th className="px-2 py-1.5 text-right font-medium">With flag</th>
                <th className="px-2 py-1.5 text-right font-medium">Without</th>
                <th className="py-1.5 pl-3 text-right font-medium">Missing</th>
              </tr>
            </thead>
            <tbody>
              {analysis.flag_splits.map((split) => (
                <FlagSplitRow
                  key={split.field}
                  field={split.field}
                  withFlag={split.with_flag}
                  withoutFlag={split.without_flag}
                  missing={split.missing_events}
                />
              ))}
            </tbody>
          </table>
          <p className="text-muted-foreground mt-1 px-1 text-xs">
            Gap at {analysis.reference_horizon} bars per split, with event counts.
          </p>
        </div>
      ) : null}
    </div>
  );
}
