import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildLabelPrompt, labelerVersion, promptTemplate } from "../src/services/sec/eightKLabelPrompt.ts";
import { runLabelEightK } from "../src/services/sec/eightKLabelRun.ts";
import type { LabelRunner } from "../src/services/sec/eightKLabelRunner.ts";
import { parseLabelSet } from "../src/services/sec/eightKLabelSchema.ts";
import { listCachedFilings, readLabel } from "../src/services/sec/eightKLabelStore.ts";

const validResponse = JSON.stringify({
  labels: [
    {
      kind: "guidance",
      direction: "up",
      severity: 4,
      rationale: "Raised full-year revenue outlook.",
      guidance: [
        { metric: "revenue", period: "FY 2025", unit: "USD billions", low: 5.1, high: 5.3, point: null },
      ],
    },
  ],
});

function makeCache(): string {
  const cacheDir = mkdtempSync(join(tmpdir(), "geridon-8k-label-"));
  const filingDir = join(cacheDir, "filings", "1111", "000111124000001");
  mkdirSync(filingDir, { recursive: true });
  mkdirSync(join(cacheDir, "listings"), { recursive: true });
  writeFileSync(
    join(cacheDir, "listings", "ABCD.json"),
    JSON.stringify({ ticker: "ABCD", cik: 1111, from_ms: 0, to_ms: 1, filings: [] }),
  );
  writeFileSync(
    join(filingDir, "documents.json"),
    JSON.stringify({
      form: "8-K",
      items: ["2.02"],
      filed_date: "2024-02-01",
      acceptance_ts_ms: 1_706_800_000_000,
      primary: "body.htm",
      exhibits: ["press.htm"],
      missing: [],
    }),
  );
  writeFileSync(join(filingDir, "body.htm"), "<html><body><p>Item 2.02 Results.</p></body></html>");
  writeFileSync(
    join(filingDir, "press.htm"),
    "<html><body><p>We now expect revenue of $5.1 to $5.3 billion.</p></body></html>",
  );
  return cacheDir;
}

function fixedRunner(response: string, prompts: string[] = []): LabelRunner {
  return {
    async run(prompt: string) {
      prompts.push(prompt);
      return response;
    },
  };
}

test("parseLabelSet accepts a well-formed response", () => {
  const parsed = parseLabelSet(validResponse);
  assert.equal(parsed.labels.length, 1);
  assert.equal(parsed.labels[0].kind, "guidance");
  assert.equal(parsed.labels[0].guidance[0].high, 5.3);
  assert.equal(parsed.labels[0].guidance[0].point, null);
});

test("parseLabelSet accepts an empty label set", () => {
  assert.deepEqual(parseLabelSet('{"labels":[]}'), { labels: [] });
});

test("parseLabelSet rejects malformed model output", () => {
  const cases: Array<[string, string]> = [
    ["not json", "not JSON"],
    ['{"foo":1}', "missing a labels array"],
    ['{"labels":[{"kind":"merger","direction":"up","severity":3,"rationale":"x","guidance":[]}]}', "unknown label kind"],
    ['{"labels":[{"kind":"guidance","direction":"sideways","severity":3,"rationale":"x","guidance":[]}]}', "unknown label direction"],
    ['{"labels":[{"kind":"guidance","direction":"up","severity":9,"rationale":"x","guidance":[]}]}', "severity"],
    ['{"labels":[{"kind":"guidance","direction":"up","severity":3,"rationale":"","guidance":[]}]}', "rationale"],
    ['{"labels":[{"kind":"guidance","direction":"up","severity":3,"rationale":"x","guidance":[{"metric":"revenue","period":"FY25","unit":"USD billions","low":"lots","high":null,"point":null}]}]}', "finite number"],
  ];
  for (const [raw, expected] of cases) {
    assert.throws(() => parseLabelSet(raw), new RegExp(expected), `expected "${expected}" for ${raw}`);
  }
});

test("labelerVersion changes when the prompt changes", () => {
  const version = labelerVersion("gpt-5.5");
  assert.match(version, /^gpt-5\.5-[0-9a-f]{12}$/);
  assert.equal(version, labelerVersion("gpt-5.5"));
  assert.notEqual(version, labelerVersion("gpt-5.6"));
});

test("buildLabelPrompt carries the filing context and the template", () => {
  const prompt = buildLabelPrompt({
    ticker: "ABCD",
    items: ["2.02", "9.01"],
    filed_date: "2024-02-01",
    text: "Filing body",
  });
  assert.ok(prompt.startsWith(promptTemplate));
  assert.ok(prompt.includes("Ticker: ABCD"));
  assert.ok(prompt.includes("8-K items: 2.02, 9.01"));
  assert.ok(prompt.includes("Filing body"));
});

test("listCachedFilings reads completed filings from the cache", async () => {
  const cacheDir = makeCache();
  try {
    const filings = await listCachedFilings(cacheDir);
    assert.equal(filings.length, 1);
    assert.equal(filings[0].cik, 1111);
    assert.deepEqual(filings[0].items, ["2.02"]);
    assert.equal(filings[0].primary, "body.htm");
  } finally {
    rmSync(cacheDir, { recursive: true, force: true });
  }
});

test("listCachedFilings ignores filings without documents.json", async () => {
  const cacheDir = makeCache();
  try {
    mkdirSync(join(cacheDir, "filings", "1111", "000111124000002"), { recursive: true });
    assert.equal((await listCachedFilings(cacheDir)).length, 1);
  } finally {
    rmSync(cacheDir, { recursive: true, force: true });
  }
});

test("a labeling run writes a versioned label and never re-runs a cached filing", async () => {
  const cacheDir = makeCache();
  try {
    const prompts: string[] = [];
    const first = await runLabelEightK({
      cacheDir,
      allowUnbounded: true,
      runner: fixedRunner(validResponse, prompts),
      nowIso: "2026-07-20T00:00:00.000Z",
    });

    assert.equal(first.filings_considered, 1);
    assert.equal(first.filings_labeled, 1);
    assert.equal(first.labels_emitted, 1);
    assert.deepEqual(first.labels_by_kind, { guidance: 1 });
    assert.equal(prompts.length, 1);
    assert.ok(prompts[0].includes("Ticker: ABCD"));
    assert.ok(prompts[0].includes("revenue of $5.1 to $5.3 billion"));

    const filingDir = join(cacheDir, "filings", "1111", "000111124000001");
    const stored = await readLabel(filingDir, first.labeler_version);
    assert.equal(stored?.labeler_version, first.labeler_version);
    assert.equal(stored?.labeled_at, "2026-07-20T00:00:00.000Z");
    assert.equal(stored?.labels[0].kind, "guidance");
    assert.ok(existsSync(join(filingDir, "labels", `${first.labeler_version}.json`)));

    const second = await runLabelEightK({
      cacheDir,
      allowUnbounded: true,
      runner: fixedRunner(validResponse, prompts),
      nowIso: "2026-07-20T00:00:00.000Z",
    });
    assert.equal(second.filings_cached, 1);
    assert.equal(second.filings_labeled, 0);
    assert.equal(prompts.length, 1);
  } finally {
    rmSync(cacheDir, { recursive: true, force: true });
  }
});

test("a new labeler version relabels without overwriting the old labels", async () => {
  const cacheDir = makeCache();
  try {
    const base = await runLabelEightK({
      cacheDir,
      allowUnbounded: true,
      runner: fixedRunner(validResponse),
    });
    const next = await runLabelEightK({
      cacheDir,
      allowUnbounded: true,
      model: "gpt-5.6",
      runner: fixedRunner('{"labels":[]}'),
    });

    assert.notEqual(base.labeler_version, next.labeler_version);
    assert.equal(next.filings_labeled, 1);
    const filingDir = join(cacheDir, "filings", "1111", "000111124000001");
    assert.equal((await readLabel(filingDir, base.labeler_version))?.labels.length, 1);
    assert.equal((await readLabel(filingDir, next.labeler_version))?.labels.length, 0);
  } finally {
    rmSync(cacheDir, { recursive: true, force: true });
  }
});

test("an item filter skips filings the run does not target", async () => {
  const cacheDir = makeCache();
  try {
    const summary = await runLabelEightK({
      cacheDir,
      allowUnbounded: true,
      items: ["5.02"],
      runner: fixedRunner(validResponse),
    });
    assert.equal(summary.filings_considered, 0);
    assert.equal(summary.filings_labeled, 0);
  } finally {
    rmSync(cacheDir, { recursive: true, force: true });
  }
});

test("an invalid model response fails the filing without writing a label", async () => {
  const cacheDir = makeCache();
  try {
    const summary = await runLabelEightK({
      cacheDir,
      allowUnbounded: true,
      runner: fixedRunner('{"labels":[{"kind":"nope"}]}'),
    });

    assert.equal(summary.filings_failed, 1);
    assert.equal(summary.filings_labeled, 0);
    assert.match(summary.failures[0].reason, /invalid label/);
    const filingDir = join(cacheDir, "filings", "1111", "000111124000001");
    assert.equal(await readLabel(filingDir, summary.labeler_version), null);
    assert.ok(!existsSync(join(filingDir, "labels")));
  } finally {
    rmSync(cacheDir, { recursive: true, force: true });
  }
});

test("a run aborts once failures pile up instead of walking the whole cache", async () => {
  const cacheDir = makeCache();
  try {
    const filingsRoot = join(cacheDir, "filings", "1111");
    const template = readFileSync(join(filingsRoot, "000111124000001", "documents.json"), "utf8");
    for (let index = 2; index <= 12; index += 1) {
      const dir = join(filingsRoot, `00011112400000${index}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "documents.json"), template);
      writeFileSync(join(dir, "body.htm"), "<p>Item 2.02 Results.</p>");
      writeFileSync(join(dir, "press.htm"), "<p>Results.</p>");
    }

    let calls = 0;
    await assert.rejects(
      runLabelEightK({
        cacheDir,
        allowUnbounded: true,
        concurrency: 1,
        runner: {
          async run() {
            calls += 1;
            throw new Error("codex exec exited 1");
          },
        },
      }),
      /consecutive failures/,
    );
    assert.equal(calls, 5);
  } finally {
    rmSync(cacheDir, { recursive: true, force: true });
  }
});

test("an unbounded run refuses to spend without an explicit opt-in", async () => {
  const cacheDir = makeCache();
  try {
    let calls = 0;
    await assert.rejects(
      runLabelEightK({
        cacheDir,
        runner: {
          async run() {
            calls += 1;
            return validResponse;
          },
        },
      }),
      /Pass a --limit, or --all/,
    );
    assert.equal(calls, 0);

    const bounded = await runLabelEightK({
      cacheDir,
      limit: 1,
      runner: fixedRunner(validResponse),
    });
    assert.equal(bounded.filings_labeled, 1);
  } finally {
    rmSync(cacheDir, { recursive: true, force: true });
  }
});

test("guidance figures keep a unit so section 1b can compare across filings", () => {
  const parsed = parseLabelSet(validResponse);
  assert.equal(parsed.labels[0].guidance[0].unit, "USD billions");
  assert.throws(
    () =>
      parseLabelSet(
        '{"labels":[{"kind":"guidance","direction":"up","severity":3,"rationale":"x",' +
          '"guidance":[{"metric":"revenue","period":"FY25","low":1,"high":2,"point":null}]}]}',
      ),
    /unit/,
  );
});
