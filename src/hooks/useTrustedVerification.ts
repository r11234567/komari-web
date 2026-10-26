import { useEffect, useRef, useState } from "react";
import type { JsonObject } from "@bufbuild/protobuf";
import { CredentialPurpose, type TrustedCredentialProvider } from "@komari/proto/komari/credential/v1/credential_pb";
import { trustedCredentialClient as client } from "@/api/connect/trustedCredential";
import { requestTrustedPasskey } from "@/utils/trustedPasskey";
import { otpFormat, validOTP } from "@/utils/otpInput";

// Each mounted form owns one action/challenge. A completed token is passed
// directly to that action and never cached or persisted for another request.
export function useTrustedVerification(purpose: CredentialPurpose, resource: string, onAuthorized: (token: string, signal: AbortSignal) => Promise<void>) {
  const [providers, setProviders] = useState<TrustedCredentialProvider[]>([]);
  const [provider, setProvider] = useState("");
  const [challenge, setChallenge] = useState("");
  const [code, setCode] = useState("");
  const [format, setFormat] = useState(otpFormat(undefined));
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const active = useRef<AbortController | null>(null);
  const pending = useRef("");
  const complete = useRef(onAuthorized); complete.current = onAuthorized;
  const options = (signal: AbortSignal) => ({ signal, timeoutMs: 30_000 });
  const cancelChallenge = () => {
    const id = pending.current; pending.current = "";
    if (id) void client.cancelVerification({ challengeId: id }, { timeoutMs: 10_000 }).catch(() => {});
  };
  useEffect(() => {
    const controller = new AbortController(); active.current = controller;
    setBusy(true); setError(""); setChallenge(""); setCode("");
    void client.listTrustedCredentialProviders({ purpose }, options(controller.signal)).then((result) => {
      if (controller.signal.aborted) return;
      setProviders(result.providers); setProvider(result.providers[0]?.id ?? "");
      if (!result.providers.length) setError("No available credential. Configure TOTP, a verified email/Telegram contact, or Passkey.");
    }).catch((e: unknown) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Unable to load credentials"); })
      .finally(() => { if (active.current === controller && !controller.signal.aborted) { active.current = null; setBusy(false); } });
    return () => { controller.abort(); active.current?.abort(); cancelChallenge(); };
  }, [purpose, resource]);
  const run = async (operation: (signal: AbortSignal) => Promise<void>) => {
    if (active.current) return;
    const controller = new AbortController(); active.current = controller; setBusy(true); setError("");
    try { await operation(controller.signal); }
    catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Verification failed"); }
    finally { if (active.current === controller) { active.current = null; if (!controller.signal.aborted) setBusy(false); } }
  };
  const finish = async (id: string, proof: JsonObject, signal: AbortSignal) => {
    const result = await client.completeVerification({ challengeId: id, proof }, options(signal));
    if (signal.aborted) return;
    pending.current = ""; setChallenge(""); setCode("");
    const token = result.authorization?.grantToken;
    if (!token) throw new Error("Missing credential authorization");
    await complete.current(token, signal);
  };
  const begin = () => run(async (signal) => {
    cancelChallenge(); setChallenge(""); setCode("");
    const result = await client.beginVerification({ purpose, resource, providerId: provider }, options(signal));
    if (signal.aborted) {
      if (result.challengeId) void client.cancelVerification({ challengeId: result.challengeId }, { timeoutMs: 10_000 }).catch(() => {});
      return;
    }
    if (!result.challengeId) throw new Error("Missing verification challenge");
    pending.current = result.challengeId;
    if (result.promptType === "otp") { setFormat(otpFormat(result.prompt)); setChallenge(result.challengeId); }
    else if (result.promptType === "webauthn") {
      try { await finish(result.challengeId, await requestTrustedPasskey(result.prompt, signal), signal); }
      catch (e) { cancelChallenge(); throw e; }
    } else { cancelChallenge(); throw new Error("Unsupported credential prompt"); }
  });
  const verify = () => run(async (signal) => {
    if (!challenge || !validOTP(code, format)) throw new Error("Enter the complete verification code");
    try { await finish(challenge, { code }, signal); }
    catch (e) { setCode(""); throw e; }
  });
  const reset = () => { active.current?.abort(); active.current = null; cancelChallenge(); setChallenge(""); setCode(""); setBusy(false); setError(""); };
  return { providers, provider, setProvider, challenge, code, setCode, format, busy, error, begin, verify, reset };
}
