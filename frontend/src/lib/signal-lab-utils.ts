import type {
  SignalEvaluationListItem,
  SignalVerdict,
} from "@/lib/api-client-signals-registry";

export function signalKindLabel(kind: string) {
  const words = kind.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function signalFlagLabel(field: string) {
  return signalKindLabel(field.replace(/^is_/, ""));
}

export interface VerdictMeta {
  label: string;
  badgeVariant: "default" | "secondary" | "outline";
  description: string;
}

export const verdictMeta: Record<SignalVerdict, VerdictMeta> = {
  candidate: {
    label: "Candidate",
    badgeVariant: "default",
    description:
      "Clears the strict bar: t-stat at least 3, net abnormal return above 10 bp, at least 500 events. Unlocks the one-shot holdout check and promotion.",
  },
  weak: {
    label: "Weak",
    badgeVariant: "secondary",
    description:
      "Worth another look (t-stat at least 2, positive net return, at least 100 events), but below the candidate bar.",
  },
  no_signal: {
    label: "No signal",
    badgeVariant: "outline",
    description: "No evidence of a post-event abnormal return net of costs.",
  },
};

export type HoldoutStatus = "consumed" | "available" | "locked";

export function holdoutStatus(
  evaluation: Pick<SignalEvaluationListItem, "verdict" | "holdout_consumed_at">,
): HoldoutStatus {
  if (evaluation.holdout_consumed_at != null) {
    return "consumed";
  }
  return evaluation.verdict === "candidate" ? "available" : "locked";
}

export function formatReturnValue(value: number | null | undefined) {
  if (value == null) {
    return "—";
  }
  const sign = value > 0 ? "+" : "";
  if (Math.abs(value) >= 0.01) {
    return `${sign}${(value * 100).toFixed(2)}%`;
  }
  return `${sign}${(value * 10000).toFixed(1)} bp`;
}

export function formatTStat(value: number | null | undefined) {
  return value == null ? "—" : value.toFixed(2);
}

export interface ReturnScale {
  unit: "%" | "bp";
  scale: number;
}

export function returnScaleFor(maxAbs: number): ReturnScale {
  return maxAbs >= 0.02 ? { unit: "%", scale: 100 } : { unit: "bp", scale: 10_000 };
}

export function formatScaledTick(value: number) {
  const abs = Math.abs(value);
  if (abs >= 100) {
    return value.toFixed(0);
  }
  return value.toFixed(abs >= 10 ? 1 : 2).replace(/\.?0+$/, "") || "0";
}

const utcDateFormat = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

export function formatUtcTimestamp(sqliteUtc: string) {
  const iso = sqliteUtc.includes("T") ? sqliteUtc : `${sqliteUtc.replace(" ", "T")}Z`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? sqliteUtc : utcDateFormat.format(date);
}
