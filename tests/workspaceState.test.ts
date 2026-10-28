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
  assert.equal(state.pending.has("a"), false);
  assert.equal(state.revision("a"), 2);
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


test("workspace: SJC expiry/cancel never locks FRA or automatically prompts", async () => {
  let now = 0;
  const state = new WorkspaceState(() => now);
  const sjc = grant("SJC", now);
  const fra = grant("FRA", now);
  fra.idleExpiresAt += 60_000;
  state.install(sjc);
  state.install(fra);
  now = sjc.idleExpiresAt;
  state.expire();
  assert.equal(state.promptAgent, undefined);
  assert.equal(state.pending.size, 0);
  assert.equal(sjc.controller.signal.aborted, true);
  assert.equal(fra.controller.signal.aborted, false);
  state.requestUnlock("SJC");
  assert.equal(state.promptAgent, "SJC");
  state.cancel("SJC");
  assert.equal(await state.authorize("FRA"), fra);
  assert.equal(state.revision("FRA"), 1);
  assert.equal(state.promptAgent, undefined);
});

test("workspace: closing one waiter leaves sibling alive; closing last cancels verification", async () => {
  const state = new WorkspaceState(() => 0);
  const one = new AbortController(), two = new AbortController();
  const a = state.authorize("SJC", one.signal);
  const b = state.authorize("SJC", two.signal);
  const pending = state.pending.get("SJC")!;
  one.abort();
  await assert.rejects(a, { name: "AbortError" });
  assert.equal(pending.controller.signal.aborted, false);
  two.abort();
  await assert.rejects(b, { name: "AbortError" });
  assert.equal(pending.controller.signal.aborted, true);
  assert.equal(state.pending.size, 0);
  assert.equal(state.promptAgent, undefined);
  await assert.rejects(state.authorize("FRA", one.signal), { name: "AbortError" });
  assert.equal(state.pending.size, 0);
});

test("workspace: slow renewal is single-flight per machine, never globally", async () => {
  const state = new WorkspaceState(() => 0);
  const sjc = grant("SJC", 0), fra = grant("FRA", 0);
  state.install(sjc); state.install(fra);
  let finish!: (grant: WorkspaceGrant) => void;
  const waiting = state.touch("SJC", () => new Promise((resolve) => { finish = resolve; }));
  let fraCalls = 0;
  await state.touch("FRA", async (value) => { fraCalls++; return value; });
  await state.touch("SJC", async () => { throw new Error("duplicate renewal"); });
  assert.equal(fraCalls, 1);
  state.invalidate("SJC");
  finish(sjc);
  await waiting;
  assert.equal(state.grants.has("SJC"), false, "late renewal must not resurrect locked credentials");
  assert.equal(state.grants.get("FRA"), fra);
});

test("workspace: cleanup waits 60 seconds after final consumer and cancels on reopen", () => {
  let now = 0;
  const state = new WorkspaceState(() => now);
  const terminal = state.retain("SJC"), files = state.retain("SJC");
  const revoked: string[] = [];
  terminal();
  now = 70_000;
  state.collectUnused((agent) => revoked.push(agent));
  assert.deepEqual(revoked, []);
  files(); files();
  now += 59_999;
  state.collectUnused((agent) => revoked.push(agent));
  assert.deepEqual(revoked, []);
  const reopened = state.retain("SJC");
  now += 60_000;
  state.collectUnused((agent) => revoked.push(agent));
  assert.deepEqual(revoked, []);
  reopened(); now += 60_000;
  state.collectUnused((agent) => revoked.push(agent));
  assert.deepEqual(revoked, ["SJC"]);
});

test("workspace: renewal updates existing session references without replacing their cancellation scope", async () => {
  let now = 0;
  const state = new WorkspaceState(() => now);
  const original = grant("SJC", now);
  state.install(original);
  now = 120_000;
  await state.touch("SJC", async (value) => ({ ...value, idleExpiresAt: now + 180_000 }));
  now = 180_001;
  assert.equal(state.grants.get("SJC"), original);
  assert.equal(state.valid(original), true, "terminal's retained grant must receive the renewed deadline");
  assert.equal(original.idleExpiresAt, 300_000);
  assert.equal(state.revision("SJC"), 1);
  state.invalidate("SJC");
  assert.equal(original.controller.signal.aborted, true);
});
