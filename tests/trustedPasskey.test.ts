import assert from "node:assert/strict";
import test from "node:test";
import { serializeTrustedPasskey, trustedPasskeyOptions } from "../src/utils/trustedPasskey.ts";

test("trusted assertion options retain account credential IDs and require user verification", () => {
  const options = trustedPasskeyOptions({ publicKey: { challenge: "c3ludGhldGljLWNoYWxsZW5nZQ", rpId: "panel.example.test", userVerification: "required", allowCredentials: [{ id: "c3ludGhldGljLWlk", type: "public-key", transports: ["internal"] }], timeout: 60_000 } });
  assert.equal(new TextDecoder().decode(options.challenge), "synthetic-challenge");
  assert.equal(options.rpId, "panel.example.test");
  assert.equal(options.userVerification, "required");
  assert.equal(new TextDecoder().decode(options.allowCredentials![0].id), "synthetic-id");
});

test("assertions serialize binary fields without sessions or plugin success flags", () => {
  const binary = new Uint8Array([0, 255, 128]).buffer;
  const result = serializeTrustedPasskey({ id: "AP-A", rawId: binary, type: "public-key", response: { authenticatorData: binary, signature: binary, clientDataJSON: binary, userHandle: null } } as unknown as PublicKeyCredential);
  assert.deepEqual(result, { id: "AP-A", rawId: "AP-A", type: "public-key", clientExtensionResults: {}, response: { authenticatorData: "AP-A", signature: "AP-A", clientDataJSON: "AP-A", userHandle: null } });
});
