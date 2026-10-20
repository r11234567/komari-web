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

test("passkey marker is one-shot and expires deterministically", () => {
  const now = Date.now();

  passkeyLogin.markPasskeyLogin(now);
  assert.equal(passkeyLogin.consumePasskeyLoginMarker(now), true);
  assert.equal(passkeyLogin.consumePasskeyLoginMarker(now), false);

  passkeyLogin.markPasskeyLogin(now);
  assert.equal(
    passkeyLogin.consumePasskeyLoginMarker(now + 60_001),
    false,
  );
});
