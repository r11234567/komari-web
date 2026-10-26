import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { CHUNK_SIZE, createChunkUploadTask } from "../src/lib/chunkUpload.ts";
import { normalizePluginCategory } from "../src/utils/pluginCategory.ts";

function uploadFixture(t: TestContext, failFirst = false, invalidConfig = false) {
  const previousFetch = globalThis.fetch;
  const previousXHR = globalThis.XMLHttpRequest;
  const chunks = new Map<number, Uint8Array>();
  const attempts = new Map<number, number>();
  const endpoints: string[] = [];
  let onSend: (() => void) | undefined;
  class XHR extends EventTarget {
    upload = new EventTarget();
    status = 0;
    responseText = "";
    timeout = 0;
    aborted = false;
    open() {}
    send(form: FormData) {
      const index = Number(form.get("chunk_index"));
      const chunk = form.get("chunk_data") as Blob;
      attempts.set(index, (attempts.get(index) ?? 0) + 1);
      void chunk.arrayBuffer().then((bytes) => {
        onSend?.();
        if (this.aborted) return;
        this.status = failFirst && attempts.get(index) === 1 ? 503 : 200;
        if (this.status === 200) chunks.set(index, new Uint8Array(bytes));
        this.responseText = JSON.stringify({ status: this.status === 200 ? "success" : "error", message: "temporary relay failure" });
        this.dispatchEvent(new Event("load"));
      });
    }
    abort() { this.aborted = true; this.dispatchEvent(new Event("abort")); }
  }
  globalThis.XMLHttpRequest = XHR as unknown as typeof XMLHttpRequest;
  globalThis.fetch = async (input) => {
    const path = String(input);
    endpoints.push(path);
    return Response.json({ status: "success", data: path.endsWith("/init")
      ? { upload_id: "synthetic-upload", chunk_size: invalidConfig ? 1 : CHUNK_SIZE }
      : { installed: true } });
  };
  t.after(() => { globalThis.fetch = previousFetch; globalThis.XMLHttpRequest = previousXHR; });
  return { chunks, attempts, endpoints, onSend: (callback: () => void) => { onSend = callback; } };
}

test("archive task retries chunks, preserves exact bytes and reports completion after merge", async (t) => {
  const fixture = uploadFixture(t, true);
  const bytes = new Uint8Array(CHUNK_SIZE + 7).fill(97);
  bytes[bytes.length - 1] = 98;
  const progress: number[] = [];
  const result = await createChunkUploadTask("/uploads").upload<{ installed: boolean }>("plugin", new File([bytes], "p.zip"), (value) => {
    if (value === 100) assert.equal(fixture.endpoints.at(-1), "/uploads/merge");
    progress.push(value);
  });
  assert.equal(result?.installed, true);
  assert.deepEqual([...fixture.attempts.values()], [2, 2]);
  const merged = new Uint8Array(bytes.length);
  merged.set(fixture.chunks.get(0)!, 0); merged.set(fixture.chunks.get(1)!, CHUNK_SIZE);
  assert.deepEqual(merged, bytes);
  assert.equal(progress.at(-1), 100);
  assert.ok(progress.every((value) => value >= 0 && value <= 100));
});

test("cancel aborts active requests, releases staging and prevents merge", async (t) => {
  const fixture = uploadFixture(t);
  const task = createChunkUploadTask("/uploads");
  fixture.onSend(() => task.cancel());
  await assert.rejects(task.upload("plugin", new File(["bytes"], "p.zip"), () => {}), { name: "AbortError" });
  assert.ok(fixture.endpoints.includes("/uploads/cancel"));
  assert.ok(!fixture.endpoints.includes("/uploads/merge"));
});

test("unsupported chunk configuration is rejected and its server staging is canceled", async (t) => {
  const fixture = uploadFixture(t, false, true);
  await assert.rejects(createChunkUploadTask("/uploads").upload("plugin", new File(["x"], "p.zip"), () => {}), /Invalid chunk upload configuration/);
  assert.deepEqual(fixture.endpoints, ["/uploads/init", "/uploads/cancel"]);
  assert.equal(fixture.chunks.size, 0);
});

test("empty archives fail before network activity", async (t) => {
  const fixture = uploadFixture(t);
  await assert.rejects(createChunkUploadTask("/uploads").upload("plugin", new File([], "p.zip"), () => {}), /Archive size/);
  assert.deepEqual(fixture.endpoints, []);
});

test("old and unknown plugin catalogs stay visible under Uncategorized", () => {
  assert.equal(normalizePluginCategory(undefined), "uncategorized");
  assert.equal(normalizePluginCategory("future-category"), "uncategorized");
  assert.equal(normalizePluginCategory("notification"), "notification");
});
