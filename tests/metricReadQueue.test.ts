import assert from "node:assert/strict";
import test from "node:test";
import { Code, ConnectError } from "@connectrpc/connect";
import { MetricReadQueue, withMetricReadQueue } from "../src/api/connect/metricReadQueue.ts";

test("the observed 23-request burst runs one historical read at a time", async () => {
  const queue = new MetricReadQueue({ intervalMs: 0 });
  let active = 0;
  let maximum = 0;
  const reads = Array.from({ length: 23 }, (_, index) => queue.run(new AbortController().signal, async () => {
    active++;
    maximum = Math.max(maximum, active);
    await Promise.resolve();
    active--;
    return index;
  }));
  assert.deepEqual(await Promise.all(reads), Array.from({ length: 23 }, (_, index) => index));
  assert.equal(maximum, 1);
});

test("superseded queued reads never enter the network operation", async () => {
  const queue = new MetricReadQueue({ intervalMs: 0 });
  let release!: () => void;
  const first = queue.run(new AbortController().signal, () => new Promise<void>((resolve) => { release = resolve; }));
  const cancelled = new AbortController();
  let requested = false;
  const obsolete = queue.run(cancelled.signal, async () => { requested = true; });
  const rejected = assert.rejects(obsolete, { name: "AbortError" });
  cancelled.abort(new DOMException("New chart selection", "AbortError"));
  await rejected;
  release();
  await first;
  assert.equal(requested, false);
});

test("429 pauses every queued read, honors Retry-After and retries only once", async () => {
  const queue = new MetricReadQueue({ intervalMs: 0, maximumWaitMs: 5000 });
  const start = Date.now();
  let attempts = 0;
  const times: number[] = [];
  const read = queue.run(new AbortController().signal, async () => {
    times.push(Date.now());
    attempts++;
    if (attempts === 1) {
      const error = new ConnectError("busy", Code.ResourceExhausted);
      error.metadata.set("Retry-After", "2");
      throw error;
    }
    return "ready";
  });
  const follower = queue.run(new AbortController().signal, async () => { times.push(Date.now()); return "next"; });
  assert.deepEqual(await Promise.all([read, follower]), ["ready", "next"]);
  assert.equal(attempts, 2);
  assert.ok(times[1] - start >= 1900, String(times));
  assert.ok(times[2] - start >= 1900, String(times));
});

test("pending work is bounded and expires instead of waiting indefinitely", async () => {
  const queue = new MetricReadQueue({ intervalMs: 0, maximumQueued: 1, maximumWaitMs: 30 });
  let release!: () => void;
  const current = queue.run(new AbortController().signal, () => new Promise<void>((resolve) => { release = resolve; }));
  const waiting = queue.run(new AbortController().signal, async () => "obsolete");
  await assert.rejects(queue.run(new AbortController().signal, async () => "overflow"), (error) => ConnectError.from(error).code === Code.ResourceExhausted);
  await assert.rejects(waiting, (error) => ConnectError.from(error).code === Code.DeadlineExceeded);
  release();
  await current;
});

test("persistent 429 stops after two attempts", async () => {
  const queue = new MetricReadQueue({ intervalMs: 0, maximumWaitMs: 5000 });
  let attempts = 0;
  await assert.rejects(queue.run(new AbortController().signal, async () => {
    attempts++;
    throw new ConnectError("still busy", Code.ResourceExhausted);
  }), (error) => ConnectError.from(error).code === Code.ResourceExhausted);
  assert.equal(attempts, 2);
});

test("control and login RPCs bypass a busy history transport queue", async () => {
  let release!: () => void;
  const calls: string[] = [];
  const transport = withMetricReadQueue({
    unary: async (method: { name: string }) => {
      calls.push(method.name);
      if (method.name === "QueryMetrics") await new Promise<void>((resolve) => { release = resolve; });
      return { message: {} };
    },
  } as any, new MetricReadQueue({ intervalMs: 0 }));
  const invoke = (service: string, name: string) => transport.unary(
    { parent: { typeName: service }, name } as any, new AbortController().signal, undefined, undefined, {} as any,
  );
  const history = invoke("komari.metrics.v1.MetricsService", "QueryMetrics");
  await invoke("komari.credential.v1.PasswordLoginService", "BeginPasswordLogin");
  await invoke("komari.webssh.v1.WebSSHService", "SendInput");
  assert.deepEqual(calls, ["QueryMetrics", "BeginPasswordLogin", "SendInput"]);
  release();
  await history;
});
