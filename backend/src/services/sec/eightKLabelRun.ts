import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import { backendRoot } from "../../config.ts";
import { runWithConcurrency } from "../concurrency.ts";
import { buildLabelPrompt, labelerVersion } from "./eightKLabelPrompt.ts";
import { createCodexRunner, defaultLabelModel, type LabelRunner } from "./eightKLabelRunner.ts";
import { isLabelParseError, parseLabelSet } from "./eightKLabelSchema.ts";
import {
  hasLabel,
  listCachedFilings,
  writeLabel,
  type CachedFiling,
} from "./eightKLabelStore.ts";
import { assembleFilingText, documentToText, type FilingTextPart } from "./eightKText.ts";

/** Each lane is one codex subprocess; the model provider owns the rate limit. */
const defaultConcurrency = 4;

/**
 * A misconfigured CLI or an unreachable model fails every filing identically,
 * so the run aborts rather than walking the whole cache to produce nothing.
 */
const maxConsecutiveFailures = 5;

export interface LabelRunSummary {
  filings_considered: number;
  filings_labeled: number;
  filings_cached: number;
  filings_without_text: number;
  filings_failed: number;
  labels_emitted: number;
  labels_by_kind: Record<string, number>;
  failures: Array<{ accession: string; reason: string }>;
  labeler_version: string;
}

export interface LabelRunOptions {
  cacheDir?: string;
  model?: string;
  items?: string[];
  limit?: number;
  /** Labeling spends money per filing, so an unbounded run must be explicit. */
  allowUnbounded?: boolean;
  concurrency?: number;
  runner?: LabelRunner;
  nowIso?: string;
  onProgress?: (message: string) => void;
}

export async function runLabelEightK(options: LabelRunOptions = {}): Promise<LabelRunSummary> {
  const cacheDir = options.cacheDir ?? resolve(backendRoot, "data/raw/sec8k");
  const model = options.model ?? defaultLabelModel;
  const version = labelerVersion(model);
  const notify = options.onProgress ?? (() => {});
  const runner = options.runner ?? createCodexRunner(model);
  const nowIso = options.nowIso ?? new Date().toISOString();

  const tickerByCik = await buildTickerMap(cacheDir);
  const summary = emptySummary(version);

  const pending: CachedFiling[] = [];
  for (const filing of await listCachedFilings(cacheDir)) {
    if (options.items != null && !filing.items.some((item) => options.items?.includes(item))) {
      continue;
    }
    summary.filings_considered += 1;
    if (hasLabel(filing.dir, version)) {
      summary.filings_cached += 1;
      continue;
    }
    pending.push(filing);
  }

  if (options.limit == null && !options.allowUnbounded && pending.length > 0) {
    throw new Error(
      `${pending.length} filings would be labeled and each one spends a model call. ` +
        "Pass a --limit, or --all to label every pending filing.",
    );
  }
  const selected = options.limit == null ? pending : pending.slice(0, options.limit);
  notify(
    `labeler ${version}: ${summary.filings_considered} filings considered, ` +
      `${summary.filings_cached} already labeled, ${selected.length} to label`,
  );

  let consecutiveFailures = 0;
  let aborted = false;
  await runWithConcurrency(selected, options.concurrency ?? defaultConcurrency, async (filing) => {
    if (aborted) {
      return;
    }
    const text = await readFilingText(filing);
    if (text.length === 0) {
      summary.filings_without_text += 1;
      return;
    }

    const prompt = buildLabelPrompt({
      ticker: tickerByCik.get(filing.cik) ?? `CIK${filing.cik}`,
      items: filing.items,
      filed_date: filing.filed_date,
      text,
    });

    try {
      const labels = parseLabelSet(await runner.run(prompt));
      await writeLabel(filing.dir, version, labels, nowIso);
      consecutiveFailures = 0;
      summary.filings_labeled += 1;
      summary.labels_emitted += labels.labels.length;
      for (const label of labels.labels) {
        summary.labels_by_kind[label.kind] = (summary.labels_by_kind[label.kind] ?? 0) + 1;
      }
      notify(
        `${filing.accession_path}: ${labels.labels.length} label(s)` +
          `${labels.labels.map((label) => ` ${label.kind}/${label.direction}/${label.severity}`).join("")}`,
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      summary.filings_failed += 1;
      summary.failures.push({
        accession: filing.accession_path,
        reason: `${isLabelParseError(error) ? "invalid label" : "runner"}: ${reason}`,
      });
      consecutiveFailures += 1;
      notify(`${filing.accession_path}: FAILED ${reason}`);
      if (consecutiveFailures >= maxConsecutiveFailures) {
        aborted = true;
      }
    }
  });

  if (aborted) {
    throw new Error(
      `Aborted after ${maxConsecutiveFailures} consecutive failures; last: ` +
        `${summary.failures.at(-1)?.reason ?? "unknown"}`,
    );
  }
  return summary;
}

async function readFilingText(filing: CachedFiling): Promise<string> {
  const readPart = async (filename: string): Promise<FilingTextPart | null> => {
    const path = join(filing.dir, filename.replaceAll("/", "_"));
    if (!existsSync(path)) {
      return null;
    }
    return { filename, text: documentToText(await readFile(path, "utf8")) };
  };

  const primary = filing.primary == null ? null : await readPart(filing.primary);
  const exhibits: FilingTextPart[] = [];
  for (const exhibit of filing.exhibits) {
    const part = await readPart(exhibit);
    if (part != null) {
      exhibits.push(part);
    }
  }
  return assembleFilingText(primary, exhibits);
}

async function buildTickerMap(cacheDir: string): Promise<Map<number, string>> {
  const listingsDir = join(cacheDir, "listings");
  const tickerByCik = new Map<number, string>();
  if (!existsSync(listingsDir)) {
    return tickerByCik;
  }
  for (const entry of await readdir(listingsDir)) {
    if (!entry.endsWith(".json")) {
      continue;
    }
    const listing = JSON.parse(await readFile(join(listingsDir, entry), "utf8")) as {
      ticker: string;
      cik: number;
    };
    if (!tickerByCik.has(listing.cik)) {
      tickerByCik.set(listing.cik, listing.ticker);
    }
  }
  return tickerByCik;
}

function emptySummary(version: string): LabelRunSummary {
  return {
    filings_considered: 0,
    filings_labeled: 0,
    filings_cached: 0,
    filings_without_text: 0,
    filings_failed: 0,
    labels_emitted: 0,
    labels_by_kind: {},
    failures: [],
    labeler_version: version,
  };
}
