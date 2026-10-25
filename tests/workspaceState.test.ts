import assert from "node:assert/strict";
import test from "node:test";
import { WorkspaceState, type WorkspaceGrant } from "../src/utils/workspaceState.ts";

const grant = (agentId: string, now: number): WorkspaceGrant => ({ agentId, systemUser: "alice", token: `token-${agentId}`,
  expiresAt: now + 30 * 60_000, idleExpiresAt: now + 3 * 60_000, controller: new AbortController() });

test("workspace: prompt is deduplicated and grants stay isolated per machine", async () => {
  const state = new WorkspaceState(() => 1000);
  const first = state.authorize("a");
  assert.equal(first, state.authorize("a"));
  const other = state.authorize("b");
  state.install(grant("a", 1000));
  assert.equal((await first).agentId, "a");
  assert.equal(state.pending.size, 1);
  state.cancel("b");
  await assert.rejects(other, { name: "AbortError" });
});

test("workspace: polling does not renew idle and lock cancels active operations", async () => {
  let now = 1000;
  const state = new WorkspaceState(() => now);
  const value = grant("a", now);
  state.install(value);
  now = value.idleExpiresAt - 1;
  assert.equal(await state.authorize("a"), value);
  now++;
  state.expire();
  assert.equal(value.controller.signal.aborted, true);
  assert.equal(state.grants.size, 0);
  assert.equal(state.pending.has("a"), true);
  assert.equal(state.revision("a"), 1);
  state.cancel("a");
});

test("workspace: active user cannot extend the fixed 30 minute deadline", () => {
  let now = 1000;
  const state = new WorkspaceState(() => now);
  const value = grant("a", now);
  state.install(value);
  now = value.expiresAt;
  value.idleExpiresAt = now + 60_000;
  assert.equal(state.valid(value), false);
  state.expire();
  assert.equal(value.controller.signal.aborted, true);
  state.cancel("a");
});

test("workspace: account replacement aborts the original account context", () => {
  const state = new WorkspaceState(() => 1000);
  const old = grant("a", 1000);
  state.install(old);
  state.install({ ...grant("a", 1000), token: "new", systemUser: "bob" });
  assert.equal(old.controller.signal.aborted, true);
  assert.equal(state.grants.get("a")?.systemUser, "bob");
});
