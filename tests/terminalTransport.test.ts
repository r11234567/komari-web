import assert from "node:assert/strict";
import test from "node:test";
import {
  createTerminalCommandQueue,
  createTerminalEventAcknowledger,
} from "../src/utils/terminalTransport.ts";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("terminal output: 5000 events proceed while one ACK is blocked, then ACK the latest cursor", { timeout: 3000 }, async () => {
  const controller = new AbortController();
  const started = deferred(), release = deferred(), finished = deferred();
  const requests: bigint[] = [];
  const acknowledger = createTerminalEventAcknowledger({
    signal: controller.signal,
    acknowledge: async (sequence) => {
      requests.push(sequence);
      if (requests.length === 1) { started.resolve(); await release.promise; }
      else finished.resolve();
    },
    onError: (error) => { throw error; },
  });
  try {
    acknowledger.accept(1n);
    await started.promise;
    for (let sequence = 2n; sequence <= 5000n; sequence++) acknowledger.accept(sequence);
    assert.deepEqual(requests, [1n], "one ACK in flight, regardless of output volume");
    release.resolve();
    await finished.promise;
    assert.deepEqual(requests, [1n, 5000n]);
  } finally {
    controller.abort();
    release.resolve();
    acknowledger.dispose();
  }
});

test("terminal ACK failure is surfaced and cancellation drops pending ACKs", { timeout: 3000 }, async () => {
  const controller = new AbortController();
  const failed = deferred();
  const failure = new Error("network failed");
  let count = 0;
  const acknowledger = createTerminalEventAcknowledger({
    signal: controller.signal,
    acknowledge: async () => { count++; throw failure; },
    onError: (error) => { assert.equal(error, failure); failed.resolve(); },
  });
  acknowledger.accept(8n);
  await failed.promise;
  acknowledger.accept(9n);
  controller.abort();
  await tick();
  assert.equal(count, 1);
});

test("terminal input: a slow first request batches a typing burst and preserves resize ordering", { timeout: 3000 }, async () => {
  const controller = new AbortController();
  const started = deferred(), release = deferred(), finished = deferred();
  const calls: Array<[bigint, string]> = [];
  const queue = createTerminalCommandQueue({
    signal: controller.signal,
    input: async (sequence, data) => {
      calls.push([sequence, new TextDecoder().decode(data)]);
      if (sequence === 1n) { started.resolve(); await release.promise; }
      if (sequence === 4n) finished.resolve();
    },
    resize: async (sequence, rows, columns) => { calls.push([sequence, `${rows}x${columns}`]); },
    onError: (error) => { throw error; },
  });
  try {
    queue.input(new TextEncoder().encode("first"));
    await started.promise;
    for (let index = 0; index < 1000; index++) queue.input(new Uint8Array([97]));
    queue.resize(24, 80);
    queue.resize(40, 120);
    queue.input(new TextEncoder().encode("中文\r"));
    assert.equal(calls.length, 1);
    release.resolve();
    await finished.promise;
    assert.deepEqual(calls, [[1n, "first"], [2n, "a".repeat(1000)], [3n, "40x120"], [4n, "中文\r"]]);
  } finally {
    controller.abort();
    release.resolve();
    queue.dispose();
  }
});

test("terminal input: bounded paste chunks preserve bytes", { timeout: 3000 }, async () => {
  const controller = new AbortController();
  const finished = deferred();
  const bytes = new Uint8Array(150_000).map((_, index) => index % 256);
  const received: Uint8Array[] = [];
  const queue = createTerminalCommandQueue({
    signal: controller.signal,
    input: async (sequence, data) => {
      assert.equal(sequence, BigInt(received.length + 1));
      assert.ok(data.length <= 64 << 10);
      received.push(data);
      if (received.length === 3) finished.resolve();
    },
    resize: async () => {},
    onError: (error) => { throw error; },
  });
  try {
    queue.input(bytes);
    await finished.promise;
    assert.deepEqual(Buffer.concat(received), Buffer.from(bytes));
  } finally { controller.abort(); queue.dispose(); }
});

test("terminal input: failed sequence stops later commands instead of silently skipping input", { timeout: 3000 }, async () => {
  const controller = new AbortController();
  const failed = deferred();
  let calls = 0;
  const queue = createTerminalCommandQueue({
    signal: controller.signal,
    input: async () => { calls++; throw new Error("request failed"); },
    resize: async () => { calls++; },
    onError: () => failed.resolve(),
  });
  queue.input(new Uint8Array([97]));
  queue.resize(20, 80);
  await failed.promise;
  queue.input(new Uint8Array([98]));
  await tick();
  assert.equal(calls, 1);
  controller.abort();
});

test("terminal input: lock discards queued commands; backlog overflow is explicit", () => {
  const controller = new AbortController();
  let calls = 0, errors = 0;
  const queue = createTerminalCommandQueue({
    signal: controller.signal,
    input: async () => { calls++; },
    resize: async () => { calls++; },
    onError: () => { errors++; },
  });
  queue.input(new Uint8Array((1 << 20) + 1));
  assert.equal(errors, 1);
  controller.abort();
  queue.input(new Uint8Array([97]));
  queue.resize(20, 80);
  assert.equal(calls, 0);
});
