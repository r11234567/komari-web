import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = ts.transpileModule(readFileSync(new URL("../src/hooks/useNativePasswordLogin.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

function harness(immediate = false) {
  const states: unknown[] = [];
  const refs: { current: unknown }[] = [];
  let stateIndex = 0, refIndex = 0, completed = 0;
  let cleanup: (() => void) | undefined;
  const calls: { method: string; input: any }[] = [];
  const client = {
    async beginPasswordLogin(input: unknown) { calls.push({ method: "password", input }); return { authenticated: immediate, providers: [{ id: "native:email_otp", displayName: "Email OTP" }] }; },
    async beginLoginVerification(input: unknown) { calls.push({ method: "factor", input }); return { promptType: "otp", challengeId: "synthetic-challenge" }; },
    async completePasswordLogin(input: unknown) { calls.push({ method: "complete", input }); return { authenticated: true }; },
    async cancelPasswordLogin(input: unknown) { calls.push({ method: "cancel", input }); return { cancelled: true }; },
  };
  const exports: any = {};
  vm.runInNewContext(source, { exports, AbortController, require(name: string) {
    if (name === "react") return {
      useState(initial: unknown) { const index = stateIndex++; if (!(index in states)) states[index] = initial; return [states[index], (value: unknown) => { states[index] = value; }]; },
      useRef(initial: unknown) { const index = refIndex++; if (!refs[index]) refs[index] = { current: initial }; return refs[index]; },
      useEffect(effect: () => () => void) { if (!cleanup) cleanup = effect(); },
    };
    if (name === "@/api/connect/client") return { connectClients: { passwordLogin: client } };
    if (name === "@/utils/trustedPasskey") return { requestTrustedPasskey: async () => { throw new Error("Unexpected browser call in OTP test"); } };
    throw new Error(`Unexpected test import ${name}`);
  } });
  return { calls, get completed() { return completed; }, render() { stateIndex = refIndex = 0; return exports.useNativePasswordLogin(async () => { completed++; }); }, unmount() { cleanup?.(); } };
}

test("password confirmation waits for native OTP before completing login", async () => {
  const h = harness();
  await h.render().start("synthetic-user", "synthetic-password");
  let flow = h.render();
  assert.equal(flow.pending, true);
  assert.equal(h.completed, 0);
  assert.deepEqual(h.calls.map((call) => call.method), ["password"]);
  await flow.beginFactor();
  flow = h.render();
  assert.equal(flow.challenge, "synthetic-challenge");
  flow.setCode("123456");
  await h.render().verify();
  flow = h.render();
  assert.equal(h.completed, 1);
  assert.equal(flow.pending, false);
  assert.equal(flow.code, "");
  assert.deepEqual(h.calls.map((call) => call.method), ["password", "factor", "complete"]);
  assert.equal(h.calls[2].input.proof.code, "123456");
});

test("existing no-factor installations finish directly and pending forms cancel on unmount", async () => {
  const direct = harness(true);
  await direct.render().start("synthetic-user", "synthetic-password");
  assert.equal(direct.completed, 1);
  assert.equal(direct.render().pending, false);
  const pending = harness();
  await pending.render().start("synthetic-user", "synthetic-password");
  pending.unmount();
  assert.equal(pending.calls.at(-1)?.method, "cancel");
});
