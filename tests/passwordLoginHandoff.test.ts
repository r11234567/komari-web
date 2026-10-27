import assert from "node:assert/strict";
import test from "node:test";
import { PASSWORD_LOGIN_HANDOFF_KEY as key, readPasswordLoginHandoff, savePasswordLoginHandoff, clearPasswordLoginHandoff } from "../src/utils/passwordLoginHandoff.ts";

test("handoff stores only non-secret UI metadata and rejects missing, malformed and expired flows", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const values = new Map<string, string>();
  const sessionStorage = {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => values.set(k, v),
    removeItem: (k: string) => { values.delete(k); },
  };
  Object.defineProperty(globalThis, "window", { configurable: true, value: { sessionStorage } });
  try {
    const expiresAt = Date.now() + 170_000;
    savePasswordLoginHandoff([{ id: "native:email_otp", displayName: "Email OTP", password: "do-not-store", token: "do-not-store" } as any], expiresAt);
    assert.doesNotMatch(values.get(key)!, /password|token|do-not-store/);
    assert.deepEqual(readPasswordLoginHandoff(), { expiresAt, providers: [{ id: "native:email_otp", displayName: "Email OTP" }] });
    clearPasswordLoginHandoff(); assert.equal(readPasswordLoginHandoff(), null);
    for (const raw of ["broken", "null", "{}", JSON.stringify({ expiresAt: Date.now() - 1, providers: [{ id: "native:email_otp", displayName: "Email OTP" }] }), JSON.stringify({ expiresAt: Date.now() + 10_000_000, providers: [] }), JSON.stringify({ expiresAt, providers: [{ id: 1 }] })]) {
      values.set(key, raw); assert.equal(readPasswordLoginHandoff(), null);
    }
    Object.defineProperty(globalThis, "window", { configurable: true, value: { get sessionStorage() { throw new Error("storage disabled"); } } });
    assert.equal(readPasswordLoginHandoff(), null);
    assert.doesNotThrow(clearPasswordLoginHandoff);
    assert.throws(() => savePasswordLoginHandoff([], expiresAt));
  } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
