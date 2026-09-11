import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { backendRoot } from "../../config.ts";
import {
  calibrationSize,
  goldPath,
  readGold,
  readSample,
  resultPath,
  samplePath,
  selectCalibrationSample,
  writeGold,
  writeResult,
  writeSample,
  type GoldEntry,
} from "./eightKCalibrationSet.ts";
import { accuracyBar, scoreCalibration, type ScoredFiling } from "./eightKCalibrationScore.ts";
import { labelerChoiceFromArgs } from "./eightKLabelRunner.ts";
import {
  buildTickerMap,
  listCachedFilings,
  readFilingText,
  readLabel,
  type CachedFiling,
} from "./eightKLabelStore.ts";

const cacheDir = resolve(backendRoot, "data/raw/sec8k");
const cardsDir = resolve(backendRoot, "data/calibration/cards");

function optionValue(args: string[], prefix: string, fallback: string): string {
  const option = args.find((arg) => arg.startsWith(prefix));
  return option ? option.slice(prefix.length) : fallback;
}

async function runSample(args: string[]): Promise<void> {
  if ((await readSample()) != null && !args.includes("--force")) {
    throw new Error(
      `${samplePath} already exists. The sample is frozen on purpose; pass --force to redraw it, ` +
        "which invalidates every review already done against it.",
    );
  }

  const filings = await listCachedFilings(cacheDir);
  const selected = selectCalibrationSample(filings, await buildTickerMap(cacheDir), calibrationSize);
  if (selected.length === 0) {
    throw new Error(`No 2.02 or 5.02 filings are cached under ${cacheDir}; run the 8-K fetch first.`);
  }

  await writeSample({ size: selected.length, created_at: new Date().toISOString(), filings: selected });
  const byStratum = new Map<string, number>();
  for (const entry of selected) {
    byStratum.set(entry.stratum, (byStratum.get(entry.stratum) ?? 0) + 1);
  }
  console.log(`Sampled ${selected.length} of ${filings.length} cached filings into ${samplePath}`);
  for (const [stratum, count] of [...byStratum].sort()) {
    console.log(`  item ${stratum}  ${count}`);
  }
  console.log("\nNext: npm run label -- 8k --calibration");
}

/** The gold file is committed, so it records a repo-relative card path. */
async function writeCard(entry: GoldEntry, filing: CachedFiling): Promise<string> {
  const relative = join("data/calibration/cards", `${entry.accession_path}.md`);
  const path = resolve(backendRoot, relative);
  const body = [
    `# ${entry.ticker} ${entry.accession_path}`,
    `Filed ${entry.filed_date} - items ${entry.items.join(", ")}`,
    "",
    "This is exactly the text the labeler saw. Judge the same input it did.",
    "",
    await readFilingText(filing),
  ].join("\n");
  await mkdir(cardsDir, { recursive: true });
  await writeFile(path, body);
  return relative;
}

async function runDraft(args: string[]): Promise<void> {
  const sample = await readSample();
  if (sample == null) {
    throw new Error(`No calibration sample at ${samplePath}; run "calibrate 8k sample" first.`);
  }
  if ((await readGold()) != null && !args.includes("--force")) {
    throw new Error(`${goldPath} already exists; pass --force to discard the reviews in it.`);
  }

  const { version } = labelerChoiceFromArgs(args);
  const seedFromLabels = optionValue(args, "--seed=", "labels") === "labels";
  const filingByAccession = new Map(
    (await listCachedFilings(cacheDir)).map((filing) => [filing.accession_path, filing]),
  );

  const entries: GoldEntry[] = [];
  for (const sampled of sample.filings) {
    const filing = filingByAccession.get(sampled.accession_path);
    if (filing == null) {
      throw new Error(`Sampled filing ${sampled.accession_path} is no longer in the cache.`);
    }
    const stored = seedFromLabels ? await readLabel(filing.dir, version) : null;
    const entry: GoldEntry = {
      ...sampled,
      reviewed: false,
      card: "",
      notes: "",
      labels: stored?.labels ?? [],
    };
    entry.card = await writeCard(entry, filing);
    entries.push(entry);
  }

  await writeGold({
    created_at: new Date().toISOString(),
    drafted_from: seedFromLabels ? version : "blank",
    filings: entries,
  });

  const seeded = entries.filter((entry) => entry.labels.length > 0).length;
  console.log(`Drafted ${entries.length} gold entries into ${goldPath} (${seeded} seeded with labels)`);
  console.log(`Filing text cards: ${cardsDir}`);
  console.log(
    [
      "",
      "Review each entry against its card, then set \"reviewed\": true:",
      "  - correct kind, direction, severity and guidance figures in place;",
      "  - delete labels the filing does not support;",
      "  - add labels the model missed - an empty array is a valid, common answer.",
      seedFromLabels
        ? "The draft is seeded from the labeler under test, so accepting an entry without reading" +
          " its card scores the model against itself and defeats the gate."
        : "The draft is blank, so every label is authored from the card.",
    ].join("\n"),
  );
}

async function runScore(args: string[]): Promise<void> {
  const gold = await readGold();
  if (gold == null) {
    throw new Error(`No gold file at ${goldPath}; run "calibrate 8k draft" first.`);
  }
  const unreviewed = gold.filings.filter((entry) => !entry.reviewed);
  if (unreviewed.length > 0) {
    throw new Error(
      `${unreviewed.length} of ${gold.filings.length} gold entries are not marked reviewed. ` +
        "An unreviewed entry is the model's own output, not ground truth.",
    );
  }

  const { version } = labelerChoiceFromArgs(args);
  const filingByAccession = new Map(
    (await listCachedFilings(cacheDir)).map((filing) => [filing.accession_path, filing]),
  );

  const scored: ScoredFiling[] = [];
  for (const entry of gold.filings) {
    const filing = filingByAccession.get(entry.accession_path);
    const stored = filing == null ? null : await readLabel(filing.dir, version);
    scored.push({
      accession_path: entry.accession_path,
      gold: entry.labels,
      predicted: stored?.labels ?? null,
    });
  }

  const score = scoreCalibration(scored);
  await writeResult({
    labeler_version: version,
    passed: score.passed,
    scored_at: new Date().toISOString(),
    filings_scored: score.filings_scored,
    metrics: {
      kind_f1: score.kind_f1,
      direction_accuracy: score.direction_accuracy,
      severity_within_one: score.severity_within_one,
      guidance_figure_f1: score.guidance_figure_f1,
      clean_filing_false_positive_rate: score.clean_filing_false_positive_rate,
    },
  });

  console.log(`Labeler version: ${version}`);
  console.log(`Filings scored: ${score.filings_scored} (${score.matched_labels} matched labels)`);
  console.log("\nPer kind:");
  for (const kind of score.kinds) {
    console.log(
      `  ${kind.kind.padEnd(26)} support=${String(kind.support).padStart(3)} ` +
        `P=${kind.precision.toFixed(2)} R=${kind.recall.toFixed(2)} F1=${kind.f1.toFixed(2)}`,
    );
  }
  console.log(
    `\nkind F1 ${score.kind_f1.toFixed(3)} (bar ${accuracyBar.minKindF1})\n` +
      `direction accuracy ${score.direction_accuracy.toFixed(3)} (bar ${accuracyBar.minDirectionAccuracy})\n` +
      `severity within 1 ${score.severity_within_one.toFixed(3)} (bar ${accuracyBar.minSeverityWithinOne})\n` +
      `guidance figure F1 ${score.guidance_figure_f1.toFixed(3)} (bar ${accuracyBar.minGuidanceFigureF1})\n` +
      `clean-filing false positives ${score.clean_filing_false_positives}/${score.clean_filings} ` +
      `(bar ${accuracyBar.maxCleanFilingFalsePositiveRate})`,
  );

  if (score.passed) {
    console.log(`\nPASSED. Recorded at ${resultPath(version)}; bulk labeling is unlocked.`);
    return;
  }
  console.log("\nFAILED:");
  for (const failure of score.failures) {
    console.log(`  ${failure}`);
  }
  throw new Error("Calibration failed; bulk labeling stays locked for this labeler version.");
}

export async function runCalibrateEightKCommand(args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;
  if (subcommand === "sample") {
    return runSample(rest);
  }
  if (subcommand === "draft") {
    return runDraft(rest);
  }
  if (subcommand === "score") {
    return runScore(rest);
  }
  throw new Error('Usage: npm run calibrate -- 8k <sample|draft|score> [--model=] [--force]');
}
