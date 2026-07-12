import assert from "node:assert/strict";
import test from "node:test";

import type {
  HoldoutEvaluation,
  OptimizationExperimentRecord,
  OptimizationTrialDetail,
} from "@/lib/api-optimization-experiment-types";
import type { StrategyRecord } from "@/lib/api-strategy-types";
import { detailReducer, initialDetailState, type DetailState } from "./optimize-detail-state.ts";

function detail(trialIndex: number): OptimizationTrialDetail {
  return {
    experiment_id: 1,
    trial_index: trialIndex,
    hash: `hash-${trialIndex}`,
    phase: "search",
    status: "scored",
    rejection_reason: null,
    stage_reached: 2,
    rank: 1,
    eligible: true,
    score: null,
    values: {},
    complexity: { activeRules: 1, uniqueIndicators: 1, maxDepth: 1 },
    metrics: null,
    strategy: null,
    fold_results: [],
  };
}

test("selecting a trial highlights it and re-selecting it clears the selection", () => {
  const selected = detailReducer(initialDetailState, { type: "trialSelected", trialIndex: 3 });
  assert.equal(selected.selectedTrialIndex, 3);

  const switched = detailReducer(selected, { type: "trialSelected", trialIndex: 5 });
  assert.equal(switched.selectedTrialIndex, 5);

  const cleared = detailReducer(switched, { type: "trialSelected", trialIndex: 5 });
  assert.equal(cleared.selectedTrialIndex, null);
});

test("changing the leaderboard filter keeps the selected trial", () => {
  const selected = detailReducer(initialDetailState, { type: "trialSelected", trialIndex: 3 });
  const filtered = detailReducer(selected, { type: "filterChanged", filter: "eligible" });
  assert.equal(filtered.selectedTrialIndex, 3);
  assert.equal(filtered.filter, "eligible");
});

test("loaded trial details are cached by trial index", () => {
  const loading = detailReducer(initialDetailState, { type: "trialDetailRequested" });
  assert.equal(loading.trialDetailLoading, true);

  const first = detailReducer(loading, { type: "trialDetailLoaded", detail: detail(3) });
  const second = detailReducer(first, { type: "trialDetailLoaded", detail: detail(5) });
  assert.equal(second.trialDetailLoading, false);
  assert.deepEqual(Object.keys(second.trialDetails), ["3", "5"]);
});

test("saving a candidate tracks progress and stores the created strategy", () => {
  const saving = detailReducer(
    { ...initialDetailState, error: "old error" },
    { type: "saveStarted", trialIndex: 3 },
  );
  assert.equal(saving.savingIndex, 3);
  assert.equal(saving.error, null);

  const record = { id: 42, name: "Saved" } as StrategyRecord;
  const saved = detailReducer(saving, { type: "saveSucceeded", trialIndex: 3, record });
  assert.equal(saved.savingIndex, null);
  assert.equal(saved.savedStrategies[3], record);

  const failed = detailReducer(saving, { type: "saveFailed", message: "nope" });
  assert.deepEqual(
    { savingIndex: failed.savingIndex, error: failed.error },
    { savingIndex: null, error: "nope" },
  );
});

test("a failed load surfaces the message and stops the spinner", () => {
  const state: DetailState = { ...initialDetailState, loading: true };
  const failed = detailReducer(state, { type: "loadFailed", message: "boom" });
  assert.deepEqual({ loading: failed.loading, error: failed.error }, { loading: false, error: "boom" });
});

test("opening the holdout patches the experiment record once it succeeds", () => {
  const experiment = { id: 1, holdout: null } as OptimizationExperimentRecord;
  const loaded = detailReducer(initialDetailState, { type: "loaded", experiment, trials: [] });

  const opening = detailReducer(
    { ...loaded, holdoutError: "old error" },
    { type: "holdoutOpenStarted" },
  );
  assert.deepEqual(
    { opening: opening.holdoutOpening, error: opening.holdoutError },
    { opening: true, error: null },
  );

  const holdout: HoldoutEvaluation = {
    trial_index: 3,
    opened_at: "2026-07-11T00:00:00.000Z",
    candidate: [],
    baseline: [],
    buy_hold: [],
  };
  const opened = detailReducer(opening, { type: "holdoutOpened", holdout });
  assert.equal(opened.holdoutOpening, false);
  assert.deepEqual(opened.experiment?.holdout, holdout);

  const failed = detailReducer(opening, { type: "holdoutOpenFailed", message: "already opened" });
  assert.deepEqual(
    { opening: failed.holdoutOpening, error: failed.holdoutError, holdout: failed.experiment?.holdout },
    { opening: false, error: "already opened", holdout: null },
  );
});
