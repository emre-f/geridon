import assert from "node:assert/strict";
import test from "node:test";

import type { OptimizationExperimentListItem } from "@/lib/api-optimization-experiment-types";
import type { OptimizationExperimentStatus } from "@/lib/api-optimization-types";
import {
  experimentsReducer,
  initialExperimentsState,
  type OptimizeExperimentsState,
} from "./optimize-experiments-state.ts";

function experiment(
  id: number,
  status: OptimizationExperimentStatus = "completed",
): OptimizationExperimentListItem {
  return {
    id,
    status,
    strategy_id: 1,
    strategy_name: "Test",
    tickers: ["TEST"],
    timeframe: "1d",
    method: "random",
    max_trials: 10,
    max_runtime_ms: 120_000,
    progress: null,
    created_at: "",
    updated_at: "",
  };
}

function stateWithSelection(id: number): OptimizeExperimentsState {
  return {
    ...initialExperimentsState,
    experiments: [experiment(id)],
    total: 1,
    selectedId: id,
  };
}

test("selecting an experiment opens it and re-selecting it closes the card", () => {
  const selected = experimentsReducer(initialExperimentsState, { type: "selected", id: 7 });
  assert.equal(selected.selectedId, 7);

  const switched = experimentsReducer(selected, { type: "selected", id: 9 });
  assert.equal(switched.selectedId, 9);

  const toggledOff = experimentsReducer(switched, { type: "selected", id: 9 });
  assert.equal(toggledOff.selectedId, null);

  const closed = experimentsReducer(selected, { type: "selected", id: null });
  assert.equal(closed.selectedId, null);
});

test("deleting the selected experiment clears the selection", () => {
  const deleted = experimentsReducer(stateWithSelection(7), { type: "deleted", id: 7 });
  assert.deepEqual(
    { selectedId: deleted.selectedId, experiments: deleted.experiments, total: deleted.total },
    { selectedId: null, experiments: [], total: 0 },
  );
});

test("deleting another experiment keeps the selection", () => {
  const state: OptimizeExperimentsState = {
    ...stateWithSelection(7),
    experiments: [experiment(7), experiment(8)],
    total: 2,
  };
  const deleted = experimentsReducer(state, { type: "deleted", id: 8 });
  assert.equal(deleted.selectedId, 7);
});

test("resuming the selected experiment keeps it selected for the progress view", () => {
  const resumed = experimentsReducer(stateWithSelection(7), {
    type: "updated",
    experiment: experiment(7, "queued"),
  });
  assert.equal(resumed.selectedId, 7);
  assert.equal(resumed.experiments[0].status, "queued");
});

test("an update that leaves the experiment finished keeps the selection", () => {
  const updated = experimentsReducer(stateWithSelection(7), {
    type: "updated",
    experiment: experiment(7, "cancelled"),
  });
  assert.equal(updated.selectedId, 7);
});

test("a created experiment is prepended and selected for the progress view", () => {
  const created = experimentsReducer(stateWithSelection(7), {
    type: "created",
    experiment: experiment(9, "queued"),
  });
  assert.deepEqual(
    { ids: created.experiments.map((entry) => entry.id), total: created.total, selectedId: created.selectedId },
    { ids: [9, 7], total: 2, selectedId: 9 },
  );
});
