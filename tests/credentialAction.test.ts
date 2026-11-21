import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  credentialActionResource,
  DEFAULT_EXECUTION_MAX_OUTPUT_BYTES,
  DEFAULT_EXECUTION_TIMEOUT_SECONDS,
  DEFAULT_RESCUE_MAX_OUTPUT_BYTES,
  DEFAULT_RESCUE_TIMEOUT_SECONDS,
  executionCredentialTargets,
  executionSpecDigest,
  rescueCredentialTargets,
  rescueSpecDigest,
  resolveExecutionDefaults,
  restCredentialResource,
} from "../src/utils/credentialAction.ts";

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

test("execution spec digest binds command, args, sorted env, cwd, limits and root deterministically", async () => {
  const base = {
    command: "echo <ok&>",
    arguments: ["-n", "a\u2028b"],
    environment: { Z_VAR: "2", A_VAR: "1" },
    workingDirectory: "/srv/app",
    timeoutSeconds: 30,
    maxOutputBytes: 4096,
    runAsRoot: true,
  };
  const expectedPayload = '["v1","echo <ok&>",["-n","a\\u2028b"],[["A_VAR","1"],["Z_VAR","2"]],"/srv/app",30,4096,true]';
  const expectedDigest = `spec:${createHash("sha256").update(expectedPayload).digest("hex")}`;
  assert.equal(await executionSpecDigest(base), expectedDigest);
  assert.equal(
    await executionSpecDigest({ ...base, environment: { A_VAR: "1", Z_VAR: "2" } }),
    expectedDigest,
  );
  assert.notEqual(
    await executionSpecDigest({ ...base, command: "rm -rf /" }),
    expectedDigest,
  );
  assert.deepEqual(await executionCredentialTargets(["agent-a"], base), [
    "agent-a",
    "run-as:root",
    expectedDigest,
  ]);
  assert.equal(restCredentialResource("post", "/api/admin/update/user"), "rest:POST:/api/admin/update/user");

  // Execution page default parameters must match the RPC payload sent by createRemoteExecutions.
  const resolved = resolveExecutionDefaults({ command: "uname -a", runAsRoot: false });
  assert.equal(resolved.timeoutMs, DEFAULT_EXECUTION_TIMEOUT_SECONDS * 1000);
  assert.equal(resolved.timeoutSeconds, 300);
  assert.equal(resolved.maxOutputBytes, BigInt(DEFAULT_EXECUTION_MAX_OUTPUT_BYTES));
  const defaultTargets = await executionCredentialTargets(["agent-1"], resolved.credentialSpec);
  const explicitTargets = await executionCredentialTargets(["agent-1"], {
    command: "uname -a",
    timeoutSeconds: 300,
    maxOutputBytes: 1 << 20,
    runAsRoot: false,
  });
  assert.deepEqual(defaultTargets, explicitTargets);
  assert.notDeepEqual(
    defaultTargets,
    await executionCredentialTargets(["agent-1"], { command: "uname -a", runAsRoot: false }),
  );
});

test("rescue spec digest binds arguments, timeout, maxOutputBytes and sshPort deterministically", async () => {
  const spec = {
    arguments: ["--dry-run"],
    timeoutSeconds: DEFAULT_RESCUE_TIMEOUT_SECONDS,
    maxOutputBytes: DEFAULT_RESCUE_MAX_OUTPUT_BYTES,
    sshPort: 2222,
  };
  const expectedPayload = '["v1",["--dry-run"],300,262144,2222]';
  const expectedDigest = `spec:${createHash("sha256").update(expectedPayload).digest("hex")}`;
  assert.equal(await rescueSpecDigest(spec), expectedDigest);
  assert.deepEqual(await rescueCredentialTargets("agent-1", 4, spec), [
    "agent-1",
    "4",
    "2222",
    expectedDigest,
  ]);
  assert.notEqual(
    await rescueSpecDigest({ ...spec, arguments: ["--force"] }),
    expectedDigest,
  );
});
