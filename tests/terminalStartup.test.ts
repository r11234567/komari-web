import assert from "node:assert/strict";
import test from "node:test";
import { observeTerminalStartup, type TerminalStartupPhase } from "../src/utils/terminalStartup.ts";

test("cold terminal heartbeats distinguish attachment from real output without claiming a shell is ready", () => {
  let phase: TerminalStartupPhase = "creating";
  phase = observeTerminalStartup(phase, { agentAttached: false });
  assert.equal(phase, "waiting-agent");
  for (let i = 0; i < 8; i++) phase = observeTerminalStartup(phase, { agentAttached: false });
  assert.equal(phase, "waiting-agent");
  phase = observeTerminalStartup(phase, { agentAttached: true });
  assert.equal(phase, "waiting-output");
  phase = observeTerminalStartup(phase, { outputBytes: 0, agentAttached: true });
  assert.equal(phase, "waiting-output");
  phase = observeTerminalStartup(phase, { outputBytes: 2 });
  assert.equal(phase, "ready");
  phase = observeTerminalStartup(phase, { agentAttached: false });
  assert.equal(phase, "reconnecting");
  assert.equal(observeTerminalStartup(phase, { agentAttached: false }), "reconnecting");
  assert.equal(observeTerminalStartup(phase, { agentAttached: true }), "ready");
  phase = observeTerminalStartup(phase, { closed: true });
  assert.equal(observeTerminalStartup(phase, { agentAttached: true }), "closed");
});

test("a cold terminal still waits for first output after its Agent transport returns", () => {
  assert.equal(observeTerminalStartup("waiting-output", { agentAttached: false }), "waiting-agent");
  assert.equal(observeTerminalStartup("waiting-agent", { agentAttached: true }), "waiting-output");
});
