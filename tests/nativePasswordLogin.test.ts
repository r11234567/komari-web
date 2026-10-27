import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { timestampDate, timestampFromDate } from "@bufbuild/protobuf/wkt";
import * as otpInput from "../src/utils/otpInput.ts";

const source = ts.transpileModule(readFileSync(new URL("../src/hooks/useNativePasswordLogin.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

function harness(immediate = false, legacy = false, failSend = false, mode = "inline", resumed: any = null, badPassword = false) {
  const states: unknown[] = [];
  const refs: { current: unknown }[] = [];
  let stateIndex = 0, refIndex = 0, effectIndex = 0, completed = 0;
  const effects: Array<{ deps: unknown[]; setup: () => (() => void) | undefined; cleanup?: () => void }> = [];
  let saved: any = resumed;
  const navigation: string[] = [];
  const calls: { method: string; input: any }[] = [];
  const client = {
    async beginPasswordLogin(input: unknown) { calls.push({ method: "password", input }); if (badPassword) throw new Error("Invalid credentials"); return { authenticated: immediate, expiresAt: timestampFromDate(new Date(Date.now() + 170_000)), providers: legacy ? [{ id: "native:totp" }] : [{ id: "plugin:komari-passkey" }, { id: "native:email_otp", displayName: "Email OTP" }] }; },
    async beginLoginVerification(input: unknown) { calls.push({ method: "factor", input }); if (failSend) { failSend = false; throw new Error("Synthetic delivery unavailable"); } return { promptType: "otp", challengeId: "synthetic-challenge", prompt: legacy ? { digits: 6, method: "totp" } : { length: 8, charset: "alphanumeric" } }; },
    async completePasswordLogin(input: unknown) { calls.push({ method: "complete", input }); return { authenticated: true }; },
    async cancelPasswordLogin(input: unknown) { calls.push({ method: "cancel", input }); return { cancelled: true }; },
  };
  const exports: any = {};
  vm.runInNewContext(source, { exports, AbortController, Error,
    window: { location: { assign: (path: string) => navigation.push(path) } },
    require(name: string) {
    if (name === "@bufbuild/protobuf/wkt") return { timestampDate };
    if (name === "@/utils/passwordLoginHandoff") return {
      savePasswordLoginHandoff(providers: any, expiresAt: number) { saved = { providers: providers.map(({ id, displayName = "" }: any) => ({ id, displayName })), expiresAt }; },
      readPasswordLoginHandoff: () => saved,
      clearPasswordLoginHandoff() { saved = null; },
    };
    if (name === "@/utils/otpInput") return otpInput;
    if (name === "react") return {
      useState(initial: unknown) { const index = stateIndex++; if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial; return [states[index], (value: unknown) => { states[index] = value; }]; },
      useRef(initial: unknown) { const index = refIndex++; if (!refs[index]) refs[index] = { current: initial }; return refs[index]; },
      useEffect(effect: () => (() => void) | undefined, deps: unknown[]) {
        const index = effectIndex++;
        if (effects[index]) return;
        effects[index] = { deps, setup: effect, cleanup: effect() };
      },
    };
    if (name === "@/api/connect/client") return { connectClients: { passwordLogin: client } };
    if (name === "@/utils/trustedPasskey") return { requestTrustedPasskey: async () => { throw new Error("Unexpected browser call in OTP test"); } };
    throw new Error(`Unexpected test import ${name}`);
  } });
  return { calls, navigation, get saved() { return saved; }, get completed() { return completed; }, render() { stateIndex = refIndex = effectIndex = 0; return exports.useNativePasswordLogin(async () => { completed++; }, mode); }, replayEffects() { effects.forEach(effect => effect.cleanup?.()); effects.forEach(effect => { effect.cleanup = effect.setup(); }); }, unmount() { effects.forEach(effect => effect.cleanup?.()); } };
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


test("popup Continue validates password then hands off without sending OTP or canceling flow", async () => {
  const h = harness(false, false, false, "handoff");
  h.render();
  assert.deepEqual(h.navigation, []);
  await h.render().start("synthetic-user", "synthetic-password");
  assert.deepEqual(h.calls.map(call => call.method), ["password"]);
  assert.deepEqual(h.navigation, ["/login"]);
  assert.doesNotMatch(JSON.stringify(h.saved), /synthetic|password|challenge|token/);
  h.unmount();
  assert.deepEqual(h.calls.map(call => call.method), ["password"]);
});

test("incorrect popup password never navigates or leaves handoff metadata", async () => {
  const h = harness(false, false, false, "handoff", null, true);
  assert.equal(await h.render().start("synthetic-user", "synthetic-password"), false);
  assert.deepEqual(h.navigation, []);
  assert.equal(h.saved, null);
  assert.equal(h.render().pending, false);
  assert.equal(h.render().error, "Invalid credentials");
});

test("factor-only page resumes, automatically sends once, and completes without password replay", async () => {
  const h = harness(false, false, false, "resume", { expiresAt: Date.now() + 170_000, providers: [{ id: "native:email_otp", displayName: "Email OTP" }] });
  assert.equal(h.render().pending, true, "first render must not flash password/OAuth inputs");
  await new Promise(resolve => setImmediate(resolve));
  const flow = h.render();
  assert.equal(flow.challenge, "synthetic-challenge");
  h.render();
  assert.deepEqual(h.calls.map(call => call.method), ["factor"]);
  assert.equal(h.saved, null);
  flow.setCode("AB12CD34");
  await h.render().verify();
  assert.equal(h.completed, 1);
  h.unmount();
  assert.deepEqual(h.calls.map(call => call.method), ["factor", "complete"]);
});

test("direct login with no handoff remains a normal password page", async () => {
  const h = harness(false, false, false, "resume");
  assert.equal(h.render().pending, false);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(h.calls, []);
});


test("StrictMode effect replay sends exactly one OTP without canceling handoff", async () => {
  const h = harness(false, false, false, "resume", { expiresAt: Date.now() + 170_000, providers: [{ id: "native:email_otp", displayName: "Email OTP" }] });
  h.render(); h.replayEffects();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(h.calls.map(call => call.method), ["factor"]);
  assert.equal(h.render().challenge, "synthetic-challenge");
});
