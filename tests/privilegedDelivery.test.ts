import assert from "node:assert/strict";
import test from "node:test";
import { acceptState, appliedSnapshot, confirmationStillCurrent } from "../src/utils/privilegedDelivery.ts";

test("pending desired never becomes the applied snapshot, even when history is truncated", () => {
  const desired = { revision: 22n } as any;
  assert.equal(appliedSnapshot({ desired, appliedRevision: 0n } as any), undefined);
  const applied = { revision: 1n } as any;
  assert.equal(appliedSnapshot({ desired, appliedRevision: 1n, applied } as any), applied);
  assert.equal(appliedSnapshot({ desired, appliedRevision: 2n, applied } as any), undefined);
});
test("confirmation is bound to the current approval target and state", () => {
  const revision = { revision: 1n, state: 1, configHash: "hash", approvalGeneration: 0n } as any;
  assert.equal(confirmationStillCurrent(revision, { ...revision }, 1), true);
  for (const changes of [{ revision: 2n }, { state: 6 }, { configHash: "other" }, { approvalGeneration: 1n }]) {
    assert.equal(confirmationStillCurrent(revision, { ...revision, ...changes }, 1), false);
  }
});
test("out-of-order polls cannot replace a newer summary", () => {
  assert.equal(acceptState({ updateSequence: 10n } as any, { updateSequence: 9n } as any), false);
  assert.equal(acceptState({ updateSequence: 10n } as any, { updateSequence: 11n } as any), true);
});
