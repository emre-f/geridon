import { resolve } from "node:path";

import { backendRoot } from "../../config.ts";
import { readSample, samplePath } from "./eightKCalibrationSet.ts";
import { scoreCalibration, type ScoredFiling } from "./eightKCalibrationScore.ts";
import { labelerVersion } from "./eightKLabelPrompt.ts";
import { labelKinds, type FilingLabel } from "./eightKLabelSchema.ts";
import {
  buildTickerMap,
  listCachedFilings,
  readLabel,
  type CachedFiling,
} from "./eightKLabelStore.ts";

const cacheDir = resolve(backendRoot, "data/raw/sec8k");

function optionValue(args: string[], prefix: string, fallback: string): string {
  const option = args.find((arg) => arg.startsWith(prefix));
  return option ? option.slice(prefix.length) : fallback;
}

/** A filing's labels reduced to a sorted kind multiset, e.g. "guidance x1". */
function kindSummary(labels: FilingLabel[]): string {
  if (labels.length === 0) {
    return "(none)";
  }
  const counts = new Map<string, number>();
  for (const label of labels) {
    counts.set(label.kind, (counts.get(label.kind) ?? 0) + 1);
  }
  return labelKinds
    .filter((kind) => counts.has(kind))
    .map((kind) => `${kind} x${counts.get(kind)}`)
    .join(", ");
}

function sameKinds(a: FilingLabel[], b: FilingLabel[]): boolean {
  return kindSummary(a) === kindSummary(b);
}

/**
 * Compares two labeler versions over the frozen calibration sample without a
 * human gold file: it treats side A as the reference and reports how far side B
 * agrees with it. This is the labeler-vs-labeler view used to pick which model
 * to trust and to find the filings worth human review, distinct from
 * `calibrate 8k score`, which grades one labeler against the hand-checked gold.
 */
export async function runCompareEightKCommand(args: string[]): Promise<void> {
  const sample = await readSample();
  if (sample == null) {
    throw new Error(`No calibration sample at ${samplePath}; run "npm run calibrate -- 8k sample" first.`);
  }

  const effort = optionValue(args, "--effort=", "medium");
  const aModel = optionValue(args, "--a=", "");
  const bModel = optionValue(args, "--b=", "");
  if (aModel === "" || bModel === "") {
    throw new Error("Usage: npm run label -- 8k compare --a=<model> --b=<model> [--effort=medium]");
  }
  const aVersion = labelerVersion(aModel, effort);
  const bVersion = labelerVersion(bModel, effort);

  const tickerByCik = await buildTickerMap(cacheDir);
  const filingByAccession = new Map<string, CachedFiling>(
    (await listCachedFilings(cacheDir)).map((filing) => [filing.accession_path, filing]),
  );

  const scored: ScoredFiling[] = [];
  const disagreements: Array<{ accession: string; ticker: string; a: string; b: string }> = [];
  let bothLabeled = 0;
  let onlyA = 0;
  let onlyB = 0;
  let neither = 0;
  let exactAgreements = 0;

  for (const entry of sample.filings) {
    const filing = filingByAccession.get(entry.accession_path);
    const a = filing == null ? null : await readLabel(filing.dir, aVersion);
    const b = filing == null ? null : await readLabel(filing.dir, bVersion);
    if (a == null && b == null) {
      neither += 1;
      continue;
    }
    if (a == null) {
      onlyB += 1;
      continue;
    }
    if (b == null) {
      onlyA += 1;
      continue;
    }
    bothLabeled += 1;
    scored.push({ accession_path: entry.accession_path, gold: a.labels, predicted: b.labels });
    if (sameKinds(a.labels, b.labels)) {
      exactAgreements += 1;
    } else {
      disagreements.push({
        accession: entry.accession_path,
        ticker: tickerByCik.get(entry.cik) ?? `CIK${entry.cik}`,
        a: kindSummary(a.labels),
        b: kindSummary(b.labels),
      });
    }
  }

  if (scored.length === 0) {
    throw new Error(
      `No filing has labels from both ${aVersion} and ${bVersion}; label the sample under each first.`,
    );
  }

  const score = scoreCalibration(scored);
  console.log(`A (reference): ${aVersion}`);
  console.log(`B (compared):  ${bVersion}`);
  console.log(
    `\nCoverage of ${sample.filings.length} sampled filings: ` +
      `${bothLabeled} both, ${onlyA} only A, ${onlyB} only B, ${neither} neither`,
  );
  console.log(
    `Kind-set agreement: ${exactAgreements}/${bothLabeled} filings ` +
      `(${((exactAgreements / bothLabeled) * 100).toFixed(0)}%) label the same kinds`,
  );

  console.log("\nB relative to A (A treated as reference):");
  console.log(`  kind F1            ${score.kind_f1.toFixed(3)}`);
  console.log(`  direction accuracy ${score.direction_accuracy.toFixed(3)} over ${score.matched_labels} shared labels`);
  console.log(`  severity within 1  ${score.severity_within_one.toFixed(3)}`);
  console.log(`  guidance figure F1 ${score.guidance_figure_f1.toFixed(3)}`);

  console.log("\nPer kind (B vs A):");
  for (const kind of score.kinds) {
    console.log(
      `  ${kind.kind.padEnd(26)} support=${String(kind.support).padStart(3)} ` +
        `P=${kind.precision.toFixed(2)} R=${kind.recall.toFixed(2)} F1=${kind.f1.toFixed(2)}`,
    );
  }

  if (disagreements.length > 0) {
    console.log(`\nDisagreements (${disagreements.length}):`);
    for (const row of disagreements) {
      console.log(`  ${row.ticker.padEnd(6)} ${row.accession}  A: ${row.a}   B: ${row.b}`);
    }
  }
}
