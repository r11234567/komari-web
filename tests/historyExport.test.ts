import test from "node:test";
import assert from "node:assert/strict";
import { phaseProgress, exportActions, exportPollDelay, type ExportJob } from "../src/utils/historyExport.ts";
const job = { status: "running", phase: "decoding_and_generating", progress_kind: "input_units", phase_completed: 8, phase_total: 10 } as ExportJob;
test("export percentages describe known input units only, never elapsed range", () => {
  assert.equal(phaseProgress(job), 80);
  assert.equal(phaseProgress({ ...job, phase: "planning", progress_kind: "indeterminate" }), undefined);
  assert.equal(phaseProgress({ ...job, phase: "publishing", phase_total: 0 }), undefined);
  assert.equal(phaseProgress({ ...job, phase_total: Number.NaN }), undefined);
  assert.equal(phaseProgress({ ...job, status: "done" }), 100);
});
test("background polling backs off and controls respect publication", () => {
  assert.equal(exportPollDelay(true, 0), 5000); assert.equal(exportPollDelay(false, 0), 30000);
  assert.equal(exportPollDelay(true, 8), 40000); assert.equal(exportPollDelay(false, 8), 60000);
  assert.deepEqual(exportActions(job), ["pause", "cancel"]);
  assert.deepEqual(exportActions({ ...job, status: "paused" }), ["resume", "cancel"]);
  assert.deepEqual(exportActions({ ...job, phase: "publishing" }), []);
});
