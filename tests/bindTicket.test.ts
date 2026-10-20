import assert from "node:assert/strict";
import test from "node:test";

class MemoryStorage {
  private values = new Map<string, string>();
  failWrites = false;
  truncateWrites = false;

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    if (this.failWrites) throw new Error("storage blocked");
    this.values.set(key, this.truncateWrites ? value.slice(0, 8) : value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  keys() {
    return [...this.values.keys()];
  }
}

const storage = new MemoryStorage();
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: { sessionStorage: storage },
});

const bindTicket = await import("../src/utils/bindTicket.ts");

test("stores the bind ticket as one atomically readable record", () => {
  storage.failWrites = false;
  storage.truncateWrites = false;
  assert.equal(bindTicket.setStoredBindTicket("signed-ticket", 120), true);
  assert.deepEqual(storage.keys(), ["komari:bind-ticket"]);
  assert.equal(bindTicket.getStoredBindTicket()?.ticket, "signed-ticket");
  assert.ok(bindTicket.getBindTicketRemainingSeconds() > 0);
});

test("rejects blocked, partial, and corrupt writes", () => {
  bindTicket.clearStoredBindTicket();
  storage.failWrites = true;
  assert.equal(bindTicket.setStoredBindTicket("blocked-ticket", 120), false);
  assert.equal(bindTicket.getStoredBindTicket(), null);

  storage.failWrites = false;
  storage.truncateWrites = true;
  assert.equal(bindTicket.setStoredBindTicket("partial-ticket", 120), false);
  assert.equal(bindTicket.getStoredBindTicket(), null);

  storage.truncateWrites = false;
  storage.setItem("komari:bind-ticket", "{not-json");
  assert.equal(bindTicket.getStoredBindTicket(), null);
});

test("expired tickets are rejected and cleared explicitly", () => {
  storage.setItem(
    "komari:bind-ticket",
    JSON.stringify({
      version: 1,
      ticket: "expired-ticket",
      expiresAt: Date.now() - 1,
    }),
  );
  assert.equal(bindTicket.getStoredBindTicket(), null);
  assert.equal(bindTicket.getBindTicketRemainingSeconds(), 0);
  bindTicket.clearStoredBindTicket();
  assert.equal(storage.getItem("komari:bind-ticket"), null);
});
