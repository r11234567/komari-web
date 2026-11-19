import assert from "node:assert/strict";
import test from "node:test";
import { apiTokenPolicyTargets, type ApiTokenInput } from "../src/utils/apiTokenPolicy.ts";
import { credentialActionResource } from "../src/utils/credentialAction.ts";

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
