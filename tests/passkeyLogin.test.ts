import assert from "node:assert/strict";
import test from "node:test";

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: { sessionStorage: new MemoryStorage() },
});

const passkeyLogin = await import("../src/utils/passkeyLogin.ts");

test("passkey marker is consumed once and survives an immediate reload", () => {
  passkeyLogin.markPasskeyLogin();
  assert.equal(passkeyLogin.consumePasskeyLoginMarker(), true);
  assert.equal(passkeyLogin.consumePasskeyLoginMarker(), false);
});

test("expired passkey marker is rejected", () => {
  const originalNow = Date.now;
  try {
    Date.now = () => 1_000;
    passkeyLogin.markPasskeyLogin();
    Date.now = () => 1_000 + 60_001;
    assert.equal(passkeyLogin.consumePasskeyLoginMarker(), false);
  } finally {
    Date.now = originalNow;
  }
});
