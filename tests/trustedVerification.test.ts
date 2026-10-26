import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = ts.transpileModule(readFileSync(new URL("../src/hooks/useTrustedVerification.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

function harness(promptType = "otp") {
  const states: unknown[] = [], refs: { current: unknown }[] = [];
  let stateIndex = 0, refIndex = 0, mounted = false;
  let cleanup: (() => void) | undefined;
  const calls: { method: string; input: any }[] = [];
  const authorized: string[] = [];
  const client = {
    async listTrustedCredentialProviders(input: unknown) { calls.push({ method: "list", input }); return { providers: [{ id: promptType === "otp" ? "native:email_otp" : "plugin:komari-passkey", displayName: "Synthetic credential" }] }; },
    async beginVerification(input: unknown) { calls.push({ method: "begin", input }); return { promptType, challengeId: "synthetic-challenge", prompt: {} }; },
    async completeVerification(input: unknown) { calls.push({ method: "complete", input }); return { authorization: { grantToken: "synthetic-single-use-grant" } }; },
    async cancelVerification(input: unknown) { calls.push({ method: "cancel", input }); return { cancelled: true }; },
  };
  const exports: any = {};
  vm.runInNewContext(source, { exports, AbortController, require(name: string) {
    if (name === "react") return {
      useState(initial: unknown) { const index = stateIndex++; if (!(index in states)) states[index] = initial; return [states[index], (value: unknown) => { states[index] = value; }]; },
      useRef(initial: unknown) { const index = refIndex++; if (!refs[index]) refs[index] = { current: initial }; return refs[index]; },
      useEffect(effect: () => () => void) { if (!mounted) { mounted = true; cleanup = effect(); } },
    };
    if (name === "@/api/connect/trustedCredential") return { trustedCredentialClient: client };
    if (name === "@/utils/trustedPasskey") return { requestTrustedPasskey: async () => ({ id: "synthetic-public-credential", response: {} }) };
    throw new Error(`Unexpected test import ${name}`);
  } });
  return { calls, authorized, render() {
    stateIndex = refIndex = 0;
    return exports.useTrustedVerification(3, 'workspace:["synthetic-agent","alice"]', async (token: string, signal: AbortSignal) => {
      assert.equal(signal.aborted, false); authorized.push(token);
    });
  }, unmount() { cleanup?.(); } };
}

test("scoped native OTP delivers one completed token directly to the action", async () => {
  const h = harness(); h.render(); await settle();
  await h.render().begin();
  assert.equal(h.authorized.length, 0);
  assert.equal(h.calls[1].input.purpose, 3);
  assert.equal(h.calls[1].input.resource, 'workspace:["synthetic-agent","alice"]');
  assert.equal(h.calls[1].input.providerId, "native:email_otp");
  h.render().setCode("123456"); await h.render().verify();
  assert.deepEqual(h.authorized, ["synthetic-single-use-grant"]);
  assert.equal(h.calls[2].input.proof.code, "123456");
  assert.equal(h.render().code, ""); assert.equal(h.render().challenge, "");
  h.unmount();
});

test("trusted Passkey uses the challenge verifier before invoking the action", async () => {
  const h = harness("webauthn"); h.render(); await settle();
  await h.render().begin();
  assert.deepEqual(h.calls.map((call) => call.method), ["list", "begin", "complete"]);
  assert.equal(h.calls[2].input.proof.id, "synthetic-public-credential");
  assert.deepEqual(h.authorized, ["synthetic-single-use-grant"]);
  h.unmount();
});

test("closing a pending form cancels its server challenge without authorizing", async () => {
  const h = harness(); h.render(); await settle(); await h.render().begin();
  h.unmount();
  assert.equal(h.calls.at(-1)?.method, "cancel");
  assert.equal(h.calls.at(-1)?.input.challengeId, "synthetic-challenge");
  assert.equal(h.authorized.length, 0);
});
