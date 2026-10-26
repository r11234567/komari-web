import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as otpInput from "../src/utils/otpInput.ts";

const source = ts.transpileModule(readFileSync(new URL("../src/hooks/useNativePasswordLogin.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

function harness(immediate = false, legacy = false, failSend = false) {
  const states: unknown[] = [];
  const refs: { current: unknown }[] = [];
  let stateIndex = 0, refIndex = 0, completed = 0;
  let cleanup: (() => void) | undefined;
  const calls: { method: string; input: any }[] = [];
  const client = {
    async beginPasswordLogin(input: unknown) { calls.push({ method: "password", input }); return { authenticated: immediate, providers: legacy ? [{ id: "native:totp" }] : [{ id: "plugin:komari-passkey" }, { id: "native:email_otp", displayName: "Email OTP" }] }; },
    async beginLoginVerification(input: unknown) { calls.push({ method: "factor", input }); if (failSend) { failSend = false; throw new Error("Synthetic delivery unavailable"); } return { promptType: "otp", challengeId: "synthetic-challenge", prompt: legacy ? { digits: 6, method: "totp" } : { length: 8, charset: "alphanumeric" } }; },
    async completePasswordLogin(input: unknown) { calls.push({ method: "complete", input }); return { authenticated: true }; },
    async cancelPasswordLogin(input: unknown) { calls.push({ method: "cancel", input }); return { cancelled: true }; },
  };
  const exports: any = {};
  vm.runInNewContext(source, { exports, AbortController, require(name: string) {
    if (name === "@/utils/otpInput") return otpInput;
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
  assert.deepEqual(h.calls.map((call) => call.method), ["password", "factor"]);
  assert.equal(h.calls[1].input.providerId, "native:email_otp");
  flow = h.render();
  assert.equal(flow.challenge, "synthetic-challenge");
  flow.setCode("AB12CD34");
  await h.render().verify();
  flow = h.render();
  assert.equal(h.completed, 1);
  assert.equal(flow.pending, false);
  assert.equal(flow.code, "");
  assert.deepEqual(h.calls.map((call) => call.method), ["password", "factor", "complete"]);
  assert.equal(h.calls[2].input.proof.code, "AB12CD34");
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


test("accounts without email retain their configured six-digit TOTP", async () => {
  const h = harness(false, true);
  await h.render().start("synthetic-user", "synthetic-password");
  assert.equal(h.calls[1].input.providerId, "native:totp");
  assert.equal(h.render().format.length, 6);
  h.render().setCode("123456");
  await h.render().verify();
  assert.equal(h.completed, 1);
});

test("failed automatic delivery offers a Continue retry without repeating password login", async () => {
  const h = harness(false, false, true);
  assert.equal(await h.render().start("synthetic-user", "synthetic-password"), false);
  assert.equal(h.render().pending, true);
  assert.equal(h.render().challenge, "");
  await h.render().beginFactor();
  assert.equal(h.render().challenge, "synthetic-challenge");
  assert.deepEqual(h.calls.map((call) => call.method), ["password", "factor", "factor"]);
});
