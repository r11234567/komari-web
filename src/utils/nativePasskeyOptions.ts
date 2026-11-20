import type { JsonObject } from "@bufbuild/protobuf";
import { decodePasskeyField, encodePasskeyField } from "./trustedPasskey.ts";

export type PasskeyDescriptorJSON = {
  id: string;
  type: string;
  transports?: AuthenticatorTransport[];
};

function parseDescriptor(entry: PasskeyDescriptorJSON): PublicKeyCredentialDescriptor {
  if (!entry || entry.type !== "public-key" || typeof entry.id !== "string") {
    throw new Error("Invalid Passkey credential descriptor");
  }
  return {
    id: decodePasskeyField(entry.id),
    type: "public-key",
    transports: Array.isArray(entry.transports) ? entry.transports : undefined,
  };
}

function clampTimeout(timeout: unknown): number {
  const numeric = typeof timeout === "number" && Number.isFinite(timeout) ? timeout : 60_000;
  return Math.min(Math.max(numeric, 1_000), 120_000);
}

export function assertPasskeySupport() {
  if (!globalThis.isSecureContext || !globalThis.navigator?.credentials) {
    throw new Error("Passkey requires a secure browser context");
  }
}

export function nativePasskeyLoginOptions(prompt: unknown): PublicKeyCredentialRequestOptions {
  const data = prompt as {
    publicKey?: {
      challenge?: string;
      rpId?: string;
      timeout?: number;
      userVerification?: string;
      allowCredentials?: PasskeyDescriptorJSON[];
    };
  };
  const json = data?.publicKey;
  if (
    !json ||
    typeof json.challenge !== "string" ||
    typeof json.rpId !== "string" ||
    !json.rpId.trim() ||
    json.userVerification !== "required"
  ) {
    throw new Error("Invalid Passkey request");
  }
  if (json.allowCredentials !== undefined && !Array.isArray(json.allowCredentials)) {
    throw new Error("Invalid Passkey request");
  }
  return {
    challenge: decodePasskeyField(json.challenge),
    rpId: json.rpId,
    timeout: clampTimeout(json.timeout),
    userVerification: "required",
    allowCredentials: json.allowCredentials?.map(parseDescriptor),
  };
}

export function nativePasskeyRegistrationOptions(prompt: unknown): PublicKeyCredentialCreationOptions {
  const data = prompt as {
    publicKey?: {
      challenge?: string;
      rp?: { id?: string; name?: string };
      user?: { id?: string; name?: string; displayName?: string };
      pubKeyCredParams?: { type?: string; alg?: number }[];
      timeout?: number;
      excludeCredentials?: PasskeyDescriptorJSON[];
      authenticatorSelection?: AuthenticatorSelectionCriteria;
      attestation?: AttestationConveyancePreference;
    };
  };
  const json = data?.publicKey;
  if (
    !json ||
    typeof json.challenge !== "string" ||
    !json.rp ||
    typeof json.rp.id !== "string" ||
    !json.rp.id.trim() ||
    typeof json.rp.name !== "string" ||
    !json.user ||
    typeof json.user.id !== "string" ||
    typeof json.user.name !== "string" ||
    typeof json.user.displayName !== "string" ||
    !Array.isArray(json.pubKeyCredParams) ||
    json.pubKeyCredParams.length === 0 ||
    json.authenticatorSelection?.userVerification !== "required"
  ) {
    throw new Error("Invalid Passkey registration");
  }
  if (json.excludeCredentials !== undefined && !Array.isArray(json.excludeCredentials)) {
    throw new Error("Invalid Passkey registration");
  }
  return {
    challenge: decodePasskeyField(json.challenge),
    rp: { id: json.rp.id, name: json.rp.name },
    user: {
      id: decodePasskeyField(json.user.id),
      name: json.user.name,
      displayName: json.user.displayName,
    },
    pubKeyCredParams: json.pubKeyCredParams.map((param) => {
      if (param.type !== "public-key" || typeof param.alg !== "number") {
        throw new Error("Invalid Passkey algorithm parameter");
      }
      return { type: "public-key", alg: param.alg };
    }),
    timeout: clampTimeout(json.timeout),
    excludeCredentials: json.excludeCredentials?.map(parseDescriptor),
    authenticatorSelection: json.authenticatorSelection,
    attestation: json.attestation,
  };
}

export function serializePasskeyRegistration(key: PublicKeyCredential): JsonObject {
  const response = key.response as AuthenticatorAttestationResponse;
  if (!(response.clientDataJSON instanceof ArrayBuffer) || !(response.attestationObject instanceof ArrayBuffer)) {
    throw new Error("Expected a Passkey attestation");
  }
  return {
    id: key.id,
    rawId: encodePasskeyField(key.rawId),
    type: key.type,
    clientExtensionResults: {},
    response: {
      clientDataJSON: encodePasskeyField(response.clientDataJSON),
      attestationObject: encodePasskeyField(response.attestationObject),
      transports: response.getTransports?.() ?? [],
    },
  };
}
