import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  assertPasskeySupport,
  nativePasskeyLoginOptions,
  nativePasskeyRegistrationOptions,
  serializePasskeyRegistration,
} from "../src/utils/nativePasskeyOptions.ts";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("nativePasskeyLoginOptions accepts discoverable and account-first options and enforces strict validation", () => {
  const discoverable = nativePasskeyLoginOptions({
    publicKey: {
      challenge: "Y2hhbGxlbmdl",
      rpId: "panel.example.test",
      timeout: 999_999,
      userVerification: "required",
    },
  });
  assert.equal(discoverable.rpId, "panel.example.test");
  assert.equal(discoverable.timeout, 120_000);
  assert.equal(discoverable.userVerification, "required");
  assert.equal(discoverable.allowCredentials, undefined);

  const accountFirst = nativePasskeyLoginOptions({
    publicKey: {
      challenge: "Y2hhbGxlbmdl",
      rpId: "panel.example.test",
      timeout: 500,
      userVerification: "required",
      allowCredentials: [{ id: "Y3JlZDE", type: "public-key", transports: ["usb"] }],
    },
  });
  assert.equal(accountFirst.timeout, 1_000);
  assert.equal(accountFirst.allowCredentials?.length, 1);
  assert.equal(accountFirst.allowCredentials?.[0].type, "public-key");

  // Reject missing rpId, relaxed UV, or non-public-key descriptor.
  assert.throws(() =>
    nativePasskeyLoginOptions({
      publicKey: { challenge: "Y2hhbGxlbmdl", rpId: "", userVerification: "required" },
    }),
  );
  assert.throws(() =>
    nativePasskeyLoginOptions({
      publicKey: { challenge: "Y2hhbGxlbmdl", rpId: "panel.example.test", userVerification: "preferred" },
    }),
  );
  assert.throws(() =>
    nativePasskeyLoginOptions({
      publicKey: {
        challenge: "Y2hhbGxlbmdl",
        rpId: "panel.example.test",
        userVerification: "required",
        allowCredentials: [{ id: "Y3JlZDE", type: "invalid" }],
      },
    }),
  );
});

test("nativePasskeyRegistrationOptions validates required fields and excludes descriptors", () => {
  const created = nativePasskeyRegistrationOptions({
    publicKey: {
      challenge: "Y2hhbGxlbmdl",
      rp: { id: "panel.example.test", name: "Komari" },
      user: { id: "dXNlci0x", name: "admin", displayName: "admin" },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }],
      timeout: 60_000,
      excludeCredentials: [{ id: "ZXhjbHVkZQ", type: "public-key" }],
      authenticatorSelection: { userVerification: "required", residentKey: "required" },
      attestation: "none",
    },
  });
  assert.equal(created.rp.id, "panel.example.test");
  assert.equal(created.user.name, "admin");
  assert.equal(created.excludeCredentials?.length, 1);
  assert.equal(created.pubKeyCredParams[0].alg, -7);

  assert.throws(() =>
    nativePasskeyRegistrationOptions({
      publicKey: {
        challenge: "Y2hhbGxlbmdl",
        rp: { id: "", name: "Komari" },
        user: { id: "dXNlci0x", name: "admin", displayName: "admin" },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }],
        authenticatorSelection: { userVerification: "required" },
      },
    }),
  );
  assert.throws(() =>
    nativePasskeyRegistrationOptions({
      publicKey: {
        challenge: "Y2hhbGxlbmdl",
        rp: { id: "panel.example.test", name: "Komari" },
        user: { id: "dXNlci0x", name: "admin", displayName: "admin" },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }],
        authenticatorSelection: { userVerification: "discouraged" },
      },
    }),
  );
});

test("serializePasskeyRegistration encodes attestation fields and rejects non-attestation objects", () => {
  const rawId = new Uint8Array([1, 2, 3]).buffer;
  const clientDataJSON = new Uint8Array([4, 5, 6]).buffer;
  const attestationObject = new Uint8Array([7, 8, 9]).buffer;
  const serialized = serializePasskeyRegistration({
    id: "AQID",
    rawId,
    type: "public-key",
    response: {
      clientDataJSON,
      attestationObject,
      getTransports: () => ["usb", "internal"],
    },
  } as unknown as PublicKeyCredential);
  assert.equal(serialized.id, "AQID");
  assert.equal(serialized.type, "public-key");
  assert.deepEqual((serialized.response as { transports: string[] }).transports, ["usb", "internal"]);

  assert.throws(() =>
    serializePasskeyRegistration({
      id: "AQID",
      rawId,
      type: "public-key",
      response: { clientDataJSON: "not-array-buffer" },
    } as unknown as PublicKeyCredential),
  );
});

test("assertPasskeySupport rejects non-secure context before RPC calls", () => {
  const prevSecure = Object.getOwnPropertyDescriptor(globalThis, "isSecureContext");
  Object.defineProperty(globalThis, "isSecureContext", { value: false, configurable: true });
  try {
    assert.throws(() => assertPasskeySupport(), /secure browser context/);
  } finally {
    if (prevSecure) {
      Object.defineProperty(globalThis, "isSecureContext", prevSecure);
    } else {
      delete (globalThis as { isSecureContext?: unknown }).isSecureContext;
    }
  }
});

test("Login and NativePasskeys components enforce preflight, single status query, Enter submit, and account refresh", () => {
  const nativePasskeySource = readFileSync(path.join(rootDir, "src/utils/nativePasskey.ts"), "utf8");
  assert.match(nativePasskeySource, /assertPasskeySupport\(\);[\s\S]*beginPasskeyLogin/);
  assert.match(nativePasskeySource, /assertPasskeySupport\(\);[\s\S]*beginPasskeyRegistration/);

  const loginSource = readFileSync(path.join(rootDir, "src/components/Login.tsx"), "utf8");
  assert.match(loginSource, /nativePasskey=\{nativePasskey\}/);
  assert.match(loginSource, /!passwordLoginEnabled && nativePasskey\) void startPasskey\(\)/);

  const manageSource = readFileSync(path.join(rootDir, "src/components/admin/NativePasskeys.tsx"), "utf8");
  assert.match(manageSource, /useAccount\(\)/);
  assert.match(manageSource, /await refresh\(\)/);
  assert.match(manageSource, /k\.createdAt/);
  assert.match(manageSource, /k\.lastUsedAt/);
});
