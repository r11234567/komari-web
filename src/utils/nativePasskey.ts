import type { JsonObject } from "@bufbuild/protobuf";
import { connectClients } from "@/api/connect/client";
import { decodePasskeyField, encodePasskeyField, serializeTrustedPasskey } from "./trustedPasskey";

type Descriptor = { id: string; type: "public-key"; transports?: AuthenticatorTransport[] };
function descriptor(entry: Descriptor): PublicKeyCredentialDescriptor {
  return { ...entry, id: decodePasskeyField(entry.id) };
}

export async function loginWithPasskey(username: string, signal: AbortSignal) {
  const { options } = await connectClients.passkeyLogin.beginPasskeyLogin({ username }, { signal });
  const json = options?.publicKey as unknown as PublicKeyCredentialRequestOptionsJSON;
  if (!json || json.userVerification !== "required") throw new Error("Invalid Passkey request");
  const publicKey: PublicKeyCredentialRequestOptions = {
    ...json, userVerification: "required", challenge: decodePasskeyField(json.challenge), extensions: undefined,
    allowCredentials: (json.allowCredentials as Descriptor[] | undefined)?.map(descriptor),
  };
  const key = await navigator.credentials.get({ publicKey, signal });
  if (!(key instanceof PublicKeyCredential)) throw new Error("Passkey login cancelled");
  const result = await connectClients.passkeyLogin.completePasskeyLogin({ assertion: serializeTrustedPasskey(key) }, { signal });
  if (!result.authenticated) throw new Error("Passkey login failed");
}

export async function registerPasskey(displayName: string, token: string, password: string, signal: AbortSignal) {
  const { challengeId, options } = await connectClients.passkeyManagement.beginPasskeyRegistration({
    displayName, verification: token ? { case: "authorizationToken", value: token } : { case: "password", value: password },
  }, { signal });
  const json = options?.publicKey as unknown as PublicKeyCredentialCreationOptionsJSON;
  if (!json || json.authenticatorSelection?.userVerification !== "required") throw new Error("Invalid Passkey registration");
  const publicKey: PublicKeyCredentialCreationOptions = {
    ...json, challenge: decodePasskeyField(json.challenge), user: { ...json.user, id: decodePasskeyField(json.user.id) },
    pubKeyCredParams: json.pubKeyCredParams as PublicKeyCredentialParameters[],
    excludeCredentials: (json.excludeCredentials as Descriptor[] | undefined)?.map(descriptor),
    authenticatorSelection: json.authenticatorSelection as AuthenticatorSelectionCriteria,
    attestation: json.attestation as AttestationConveyancePreference, extensions: undefined,
  };
  const key = await navigator.credentials.create({ publicKey, signal });
  if (!(key instanceof PublicKeyCredential)) throw new Error("Passkey registration cancelled");
  const response = key.response as AuthenticatorAttestationResponse;
  const attestation: JsonObject = {
    id: key.id, rawId: encodePasskeyField(key.rawId), type: key.type, clientExtensionResults: {},
    response: { clientDataJSON: encodePasskeyField(response.clientDataJSON), attestationObject: encodePasskeyField(response.attestationObject),
      transports: response.getTransports?.() ?? [] },
  };
  const result = await connectClients.passkeyManagement.completePasskeyRegistration({ challengeId, attestation }, { signal });
  if (!result.passkey) throw new Error("Passkey registration did not complete");
  return result.passkey;
}
