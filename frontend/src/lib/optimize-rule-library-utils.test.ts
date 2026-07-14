import assert from "node:assert/strict";
import { test } from "node:test";

import type { RuleLibraryResponse } from "@/lib/api-optimization-rule-library-types";
import type { SnapshotRule } from "@/lib/api-strategy-types";
import {
  buildEvolutionSettings,
  initialLibraryEdits,
  libraryIssue,
  librarySummary,
  toggleListEntry,
} from "./optimize-rule-library-utils.ts";

const rsiDip: SnapshotRule = {
  type: "rule",
  left: { type: "indicator", kind: "rsi", parameters: { period: 14 }, output: "rsi" },
  operator: "lt",
  right: { type: "value", value: 30 },
};

const volumeSpike: SnapshotRule = {
  type: "rule",
  left: { type: "indicator", kind: "rvol", parameters: { period: 20 }, output: "rvol" },
  operator: "gt",
  right: { type: "value", value: 1.5 },
};

function library(overrides?: Partial<RuleLibraryResponse>): RuleLibraryResponse {
  return {
    strategy_id: 1,
    templates: [
      { template: "oscillator_threshold", summary: "rsi(14).rsi lt 30", rule: rsiDip },
      { template: "volume_filter", summary: "rvol(20).rvol gt 1.5", rule: volumeSpike },
    ],
    insertion_points: [
      { id: "entry", side: "entry", operator: "and", size: 2 },
      { id: "entry.conditions.1", side: "entry", operator: "or", size: 2 },
    ],
    cap_defaults: {
      maxNewRulesPerSide: 2,
      maxActiveRulesPerSide: 6,
      maxUniqueIndicatorsPerSide: 4,
      maxTreeDepth: 3,
    },
    limits: {
      maxRuleLibrary: 24,
      maxNewRulesPerSide: 4,
      maxActiveRulesPerSide: 12,
      maxUniqueIndicatorsPerSide: 8,
      maxTreeDepth: 7,
    },
    ...overrides,
  };
}

test("initial edits approve nothing but allow every insertion point", () => {
  const edits = initialLibraryEdits(library());
  assert.deepEqual(edits.approved, []);
  assert.deepEqual(edits.insertionPoints, ["entry", "entry.conditions.1"]);
  assert.deepEqual(edits.caps, library().cap_defaults);
});

test("toggleListEntry adds then removes an entry", () => {
  const once = toggleListEntry([], "entry");
  assert.deepEqual(once, ["entry"]);
  assert.deepEqual(toggleListEntry(once, "entry"), []);
});

test("buildEvolutionSettings maps approved summaries back to rules", () => {
  const lib = library();
  const edits = {
    ...initialLibraryEdits(lib),
    approved: ["rvol(20).rvol gt 1.5"],
    insertionPoints: ["entry"],
  };
  const settings = buildEvolutionSettings(lib, edits);
  assert.deepEqual(settings.ruleLibrary, [volumeSpike]);
  assert.deepEqual(settings.insertionPoints, ["entry"]);
  assert.equal(settings.maxNewRulesPerSide, 2);
  assert.equal(settings.maxTreeDepth, 3);
});

test("libraryIssue flags approvals without anywhere to insert", () => {
  const lib = library();
  const edits = initialLibraryEdits(lib);
  assert.equal(libraryIssue(lib, edits), null);

  const noPoints = { ...edits, approved: ["rsi(14).rsi lt 30"], insertionPoints: [] };
  assert.match(libraryIssue(lib, noPoints) ?? "", /insertion point/);

  const bareStrategy = library({ insertion_points: [] });
  const bareEdits = { ...initialLibraryEdits(bareStrategy), approved: ["rsi(14).rsi lt 30"] };
  assert.match(libraryIssue(bareStrategy, bareEdits) ?? "", /no and\/or group/);
});

test("libraryIssue enforces cap bounds", () => {
  const lib = library();
  const edits = initialLibraryEdits(lib);
  assert.match(
    libraryIssue(lib, { ...edits, caps: { ...edits.caps, maxTreeDepth: 9 } }) ?? "",
    /maxTreeDepth/,
  );
  assert.match(
    libraryIssue(lib, { ...edits, caps: { ...edits.caps, maxActiveRulesPerSide: 0 } }) ?? "",
    /maxActiveRulesPerSide/,
  );
  assert.equal(
    libraryIssue(lib, { ...edits, caps: { ...edits.caps, maxNewRulesPerSide: 0 } }),
    null,
  );
});

test("librarySummary counts approvals and insertion points", () => {
  const lib = library();
  const edits = { ...initialLibraryEdits(lib), approved: ["rsi(14).rsi lt 30"] };
  assert.equal(librarySummary(lib, edits), "1 of 2 rules approved · 2 of 2 insertion points");
  const bare = library({ insertion_points: [] });
  assert.equal(
    librarySummary(bare, initialLibraryEdits(bare)),
    "0 of 2 rules approved · no insertion points available",
  );
});
