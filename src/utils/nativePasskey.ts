import { connectClients } from "@/api/connect/client";
import { serializeTrustedPasskey } from "./trustedPasskey";
import {
  assertPasskeySupport,
  nativePasskeyLoginOptions,
  nativePasskeyRegistrationOptions,
  serializePasskeyRegistration,
} from "./nativePasskeyOptions";

export {
  assertPasskeySupport,
  nativePasskeyLoginOptions,
  nativePasskeyRegistrationOptions,
  serializePasskeyRegistration,
};

export async function loginWithPasskey(username: string, signal: AbortSignal) {
  assertPasskeySupport();
  const { options } = await connectClients.passkeyLogin.beginPasskeyLogin({ username }, { signal });
  const publicKey = nativePasskeyLoginOptions(options);
  const key = await navigator.credentials.get({ publicKey, signal });
  if (!key || key.type !== "public-key") throw new Error("Passkey login cancelled");
  const result = await connectClients.passkeyLogin.completePasskeyLogin(
    { assertion: serializeTrustedPasskey(key as PublicKeyCredential) },
    { signal },
  );
  if (!result.authenticated) throw new Error("Passkey login failed");
}

export async function registerPasskey(displayName: string, token: string, password: string, signal: AbortSignal) {
  assertPasskeySupport();
  const { challengeId, options } = await connectClients.passkeyManagement.beginPasskeyRegistration(
    {
      displayName,
      verification: token ? { case: "authorizationToken", value: token } : { case: "password", value: password },
    },
    { signal },
  );
  const publicKey = nativePasskeyRegistrationOptions(options);
  const key = await navigator.credentials.create({ publicKey, signal });
  if (!key || key.type !== "public-key") throw new Error("Passkey registration cancelled");
  const attestation = serializePasskeyRegistration(key as PublicKeyCredential);
  const result = await connectClients.passkeyManagement.completePasskeyRegistration(
    { challengeId, attestation },
    { signal },
  );
  if (!result.passkey) throw new Error("Passkey registration did not complete");
  return result.passkey;
}
