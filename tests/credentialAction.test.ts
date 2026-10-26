import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { credentialActionResource } from "../src/utils/credentialAction.ts";

test("public target scopes match the backend's fixed JSON-array vector", async () => {
  assert.equal(await credentialActionResource("example", []), "action:example:4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945");
  const targets = ["node\u2028name", "<alice&>"];
  // Exact UTF-8 bytes emitted by Go's encoding/json with SetEscapeHTML(false).
  const expected = createHash("sha256").update('["node\\u2028name","<alice&>"]').digest("hex");
  assert.equal(await credentialActionResource("example", targets), `action:example:${expected}`);
});

test("execution batch scopes remain bounded and preserve target order", async () => {
  const batch = Array.from({ length: 128 }, (_, index) => `synthetic-node-${index}`);
  const resource = await credentialActionResource("execution:create", batch);
  assert.equal(resource.length, "action:execution:create:".length + 64);
  assert.notEqual(resource, await credentialActionResource("execution:create", [...batch].reverse()));
});
