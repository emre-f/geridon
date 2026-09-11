import { assertCalibrationPassed, readSample, samplePath } from "./eightKCalibrationSet.ts";
import { labelerChoiceFromArgs } from "./eightKLabelRunner.ts";
import { runLabelEightK, type LabelRunSummary } from "./eightKLabelRun.ts";

/** The two items the fetcher collects; labeling anything else is unfetched. */
const defaultItems = ["2.02", "5.02"];

function optionValue(args: string[], prefix: string, fallback: string): string {
  const option = args.find((arg) => arg.startsWith(prefix));
  return option ? option.slice(prefix.length) : fallback;
}

function parsePositiveInteger(raw: string, label: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer, got "${raw}".`);
  }
  return value;
}

/**
 * The calibration sample is a fixed list, so labeling it is bounded by
 * construction and stays open before the gate - it is how a version earns its
 * score in the first place.
 */
async function calibrationAccessions(): Promise<string[]> {
  const sample = await readSample();
  if (sample == null) {
    throw new Error(`No calibration sample at ${samplePath}; run "npm run calibrate -- 8k sample" first.`);
  }
  return sample.filings.map((filing) => filing.accession_path);
}

export async function runLabelEightKCommand(args: string[]): Promise<void> {
  const limitRaw = optionValue(args, "--limit=", "");
  const itemsRaw = optionValue(args, "--items=", defaultItems.join(","));
  const { model, effort, version } = labelerChoiceFromArgs(args);
  const calibrationOnly = args.includes("--calibration");

  if (args.includes("--all")) {
    await assertCalibrationPassed(version);
  }

  const skipRaw = optionValue(args, "--skip-labeled-by=", "");
  const summary = await runLabelEightK({
    model,
    effort,
    items: itemsRaw === "all" ? undefined : itemsRaw.split(",").map((item) => item.trim()),
    accessions: calibrationOnly ? await calibrationAccessions() : undefined,
    skipVersions: skipRaw === "" ? undefined : skipRaw.split(",").map((entry) => entry.trim()),
    limit: limitRaw === "" ? undefined : parsePositiveInteger(limitRaw, "--limit"),
    allowUnbounded: args.includes("--all") || calibrationOnly,
    concurrency: (() => {
      const raw = optionValue(args, "--concurrency=", "");
      return raw === "" ? undefined : parsePositiveInteger(raw, "--concurrency");
    })(),
    onProgress: (message) => console.log(message),
  });
  printReport(summary);
}

function printReport(summary: LabelRunSummary): void {
  console.log(`\nLabeler version: ${summary.labeler_version}`);
  console.log(
    `Filings: ${summary.filings_considered} considered, ${summary.filings_labeled} labeled, ` +
      `${summary.filings_cached} already cached, ` +
      `${summary.filings_covered_elsewhere} covered by another version, ` +
      `${summary.filings_without_text} without text, ${summary.filings_failed} failed`,
  );
  console.log(`Labels: ${summary.labels_emitted} emitted`);
  for (const kind of Object.keys(summary.labels_by_kind).sort()) {
    console.log(`  ${kind}  ${summary.labels_by_kind[kind]}`);
  }
  if (summary.failures.length > 0) {
    console.log("\nFailures:");
    for (const failure of summary.failures.slice(0, 20)) {
      console.log(`  ${failure.accession}  ${failure.reason}`);
    }
  }
}
