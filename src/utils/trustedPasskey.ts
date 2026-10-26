import type { JsonObject } from "@bufbuild/protobuf";

function decode(value: string): ArrayBuffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length > 16_384) throw new Error("Invalid WebAuthn binary field");
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0)).buffer;
}

function encode(value: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(value))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function trustedPasskeyOptions(prompt: unknown): PublicKeyCredentialRequestOptions {
  const data = prompt as { publicKey?: { challenge?: string; rpId?: string; timeout?: number; userVerification?: string; allowCredentials?: { id: string; type: string; transports?: AuthenticatorTransport[] }[] } };
  const options = data?.publicKey;
  if (!options || typeof options.challenge !== "string" || typeof options.rpId !== "string" || options.userVerification !== "required" || !Array.isArray(options.allowCredentials) || !options.allowCredentials.length) throw new Error("Invalid trusted Passkey options");
  return {
    challenge: decode(options.challenge), rpId: options.rpId, userVerification: "required",
    timeout: Math.min(Math.max(options.timeout ?? 60_000, 1_000), 120_000),
    allowCredentials: options.allowCredentials.map((credential) => {
      if (credential.type !== "public-key") throw new Error("Invalid Passkey credential type");
      return { id: decode(credential.id), type: "public-key", transports: credential.transports };
    }),
  };
}

export function serializeTrustedPasskey(credential: PublicKeyCredential): JsonObject {
  const response = credential.response as AuthenticatorAssertionResponse;
  if (!(response.authenticatorData instanceof ArrayBuffer) || !(response.signature instanceof ArrayBuffer)) throw new Error("Expected a Passkey assertion");
  return {
    id: credential.id, rawId: encode(credential.rawId), type: "public-key", clientExtensionResults: {},
    response: { clientDataJSON: encode(response.clientDataJSON), authenticatorData: encode(response.authenticatorData), signature: encode(response.signature), userHandle: response.userHandle ? encode(response.userHandle) : null },
  };
}

export async function requestTrustedPasskey(prompt: unknown, signal: AbortSignal): Promise<JsonObject> {
  if (!globalThis.isSecureContext || !navigator.credentials) throw new Error("Passkey requires a secure browser context");
  const credential = await navigator.credentials.get({ publicKey: trustedPasskeyOptions(prompt), signal });
  if (!credential || credential.type !== "public-key") throw new Error("Passkey verification cancelled");
  return serializeTrustedPasskey(credential as PublicKeyCredential);
}
