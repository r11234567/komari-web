import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { apiTokenPolicyTargets, type ApiTokenInput } from "../src/utils/apiTokenPolicy.ts";
import { credentialActionResource } from "../src/utils/credentialAction.ts";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("token creation proof binds every permission, resource, deadline, IP and rotation target", async () => {
  const input: ApiTokenInput = { name: "reader", scopes: ["nodes:read"], agentIds: ["node-a"], allAgents: false,
    expiresAt: { seconds: 1800000000n, nanos: 0 }, allowedCidrs: [], replacesTokenId: "" };
  const original = await credentialActionResource("api-token:create", apiTokenPolicyTargets(input));
  for (const change of [
    { name: "other" }, { scopes: ["nodes:read", "metrics:read"] }, { agentIds: ["node-b"] },
    { allAgents: true }, { expiresAt: { seconds: 1800000001n, nanos: 0 } },
    { allowedCidrs: ["192.0.2.8/32"] }, { replacesTokenId: "existing" },
  ]) assert.notEqual(await credentialActionResource("api-token:create", apiTokenPolicyTargets({ ...input, ...change })), original);
  assert.deepEqual(apiTokenPolicyTargets(input), ["reader", '["nodes:read"]', '["node-a"]', "false", "1800000000:0", "[]", ""]);
});

test("retired static admin API key controls and fields stay absent from Web UI", () => {
  const manager = readFileSync(path.join(rootDir, "src/components/admin/ApiTokenManager.tsx"), "utf8");
  assert.doesNotMatch(manager, /\bapi_key\b|legacy_key|settings\.api/);

  const settingsLib = readFileSync(path.join(rootDir, "src/lib/api.ts"), "utf8");
  assert.doesNotMatch(settingsLib, /\bapi_key\b/);

  for (const locale of ["en.json", "zh_CN.json", "id_ID.json", "ja_JP.json", "zh_TW.json"]) {
    const parsed = JSON.parse(readFileSync(path.join(rootDir, "src/i18n/locales", locale), "utf8"));
    assert.equal(parsed.settings?.api, undefined, `${locale} still contains retired settings.api keys`);
  }
});
