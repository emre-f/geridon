import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { backendRoot } from "../../config.ts";
import type { FilingLabel } from "./eightKLabelSchema.ts";
import type { CachedFiling } from "./eightKLabelStore.ts";

/**
 * The calibration artifacts live outside `data/` because they are hand-made and
 * must survive a cache wipe: the sample is the frozen list of filings, the gold
 * file is the human's verdict on them, and a results file is the audit trail of
 * a labeler version clearing the bar.
 */
export const calibrationRoot = resolve(backendRoot, "calibration");
export const samplePath = join(calibrationRoot, "eightk-sample.json");
export const goldPath = join(calibrationRoot, "eightk-gold.json");

export const calibrationSize = 100;

/** Strata are the two item families the fetcher collects, kept proportional. */
const strata = [
  { name: "2.02", matches: (items: string[]) => items.includes("2.02") },
  { name: "5.02", matches: (items: string[]) => !items.includes("2.02") && items.includes("5.02") },
];

export interface SampleEntry {
  cik: number;
  accession_path: string;
  ticker: string;
  filed_date: string;
  items: string[];
  stratum: string;
}

export interface CalibrationSample {
  size: number;
  created_at: string;
  filings: SampleEntry[];
}

export interface GoldEntry extends SampleEntry {
  /** Scoring refuses to run until a human has flipped every one of these. */
  reviewed: boolean;
  card: string;
  notes: string;
  labels: FilingLabel[];
}

export interface CalibrationGold {
  created_at: string;
  drafted_from: string;
  filings: GoldEntry[];
}

/**
 * Sampling is a seeded hash of the accession rather than a shuffle, so the set
 * is reproducible from the cache alone and adding filings to the cache never
 * reshuffles the ones already reviewed.
 */
function sampleRank(accession: string): number {
  return Number.parseInt(createHash("sha256").update(accession).digest("hex").slice(0, 12), 16);
}

export function selectCalibrationSample(
  filings: CachedFiling[],
  tickerByCik: Map<number, string>,
  size = calibrationSize,
): SampleEntry[] {
  const pools = strata.map((stratum) => ({
    name: stratum.name,
    filings: filings
      .filter((filing) => stratum.matches(filing.items))
      .sort((left, right) => sampleRank(left.accession_path) - sampleRank(right.accession_path)),
  }));

  const eligible = pools.reduce((total, pool) => total + pool.filings.length, 0);
  if (eligible === 0) {
    return [];
  }

  const selected: SampleEntry[] = [];
  for (const [index, pool] of pools.entries()) {
    const isLast = index === pools.length - 1;
    const share = isLast
      ? Math.min(size - selected.length, pool.filings.length)
      : Math.min(Math.round((size * pool.filings.length) / eligible), pool.filings.length);
    for (const filing of pool.filings.slice(0, share)) {
      selected.push({
        cik: filing.cik,
        accession_path: filing.accession_path,
        ticker: tickerByCik.get(filing.cik) ?? `CIK${filing.cik}`,
        filed_date: filing.filed_date,
        items: filing.items,
        stratum: pool.name,
      });
    }
  }
  return selected.sort((left, right) => left.filed_date.localeCompare(right.filed_date));
}

async function readJson<T>(path: string): Promise<T | null> {
  return existsSync(path) ? (JSON.parse(await readFile(path, "utf8")) as T) : null;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function readSample(): Promise<CalibrationSample | null> {
  return readJson<CalibrationSample>(samplePath);
}

export function writeSample(sample: CalibrationSample): Promise<void> {
  return writeJson(samplePath, sample);
}

export function readGold(): Promise<CalibrationGold | null> {
  return readJson<CalibrationGold>(goldPath);
}

export function writeGold(gold: CalibrationGold): Promise<void> {
  return writeJson(goldPath, gold);
}

export function resultPath(labelerVersion: string): string {
  return join(calibrationRoot, "results", `${labelerVersion}.json`);
}

export interface CalibrationResult {
  labeler_version: string;
  passed: boolean;
  scored_at: string;
  filings_scored: number;
  metrics: Record<string, number>;
}

export function readResult(labelerVersion: string): Promise<CalibrationResult | null> {
  return readJson<CalibrationResult>(resultPath(labelerVersion));
}

export function writeResult(result: CalibrationResult): Promise<void> {
  return writeJson(resultPath(result.labeler_version), result);
}

/**
 * The gate the ticket exists for: bulk labeling walks thousands of filings and
 * spends a model call on each, so it may not start until this exact labeler
 * version has been scored against the hand-checked set and passed.
 */
export async function assertCalibrationPassed(labelerVersion: string): Promise<void> {
  const result = await readResult(labelerVersion);
  if (result == null) {
    throw new Error(
      `Labeler ${labelerVersion} has no calibration result. Run the calibration flow ` +
        "(npm run calibrate -- 8k sample / draft / score) before bulk labeling.",
    );
  }
  if (!result.passed) {
    throw new Error(
      `Labeler ${labelerVersion} failed calibration on ${result.scored_at}; ` +
        "fix the prompt (which mints a new version) and re-score before bulk labeling.",
    );
  }
}
