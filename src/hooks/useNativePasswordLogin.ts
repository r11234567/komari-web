import { useEffect, useRef, useState } from "react";
import type { TrustedCredentialProvider } from "@komari/proto/komari/credential/v1/credential_pb";
import { connectClients } from "@/api/connect/client";
import { requestTrustedPasskey } from "@/utils/trustedPasskey";

const client = connectClients.passwordLogin;

export function useNativePasswordLogin(onAuthenticated: () => Promise<void> | void) {
  const [pending, setPending] = useState(false);
  const [providers, setProviders] = useState<TrustedCredentialProvider[]>([]);
  const [provider, setProvider] = useState("");
  const [challenge, setChallenge] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const active = useRef<AbortController | null>(null);
  const ownsFlow = useRef(false);
  const success = useRef(onAuthenticated); success.current = onAuthenticated;
  useEffect(() => () => {
    active.current?.abort();
    if (ownsFlow.current) void client.cancelPasswordLogin({}).catch(() => {});
  }, []);
  const options = (signal: AbortSignal) => ({ signal, timeoutMs: 30_000 });
  const run = async (operation: (signal: AbortSignal) => Promise<void>) => {
    active.current?.abort();
    const controller = new AbortController(); active.current = controller; setBusy(true); setError("");
    try { await operation(controller.signal); return true; }
    catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Login failed"); return false; }
    finally { if (active.current === controller) { active.current = null; setBusy(false); } }
  };
  const authenticated = async () => { ownsFlow.current = false; setPending(false); setChallenge(""); setCode(""); await success.current(); };
  const start = (username: string, password: string) => run(async (signal) => {
    const result = await client.beginPasswordLogin({ username, password }, options(signal));
    if (result.authenticated) { await authenticated(); return; }
    ownsFlow.current = true; setPending(true); setProviders(result.providers);
    setProvider(result.providers[0]?.id ?? ""); setChallenge(""); setCode("");
  });
  const beginFactor = () => run(async (signal) => {
    const result = await client.beginLoginVerification({ providerId: provider }, options(signal));
    setChallenge(""); setCode("");
    if (result.promptType === "webauthn") {
      const proof = await requestTrustedPasskey(result.prompt, signal);
      const completed = await client.completePasswordLogin({ challengeId: result.challengeId, proof }, options(signal));
      if (!completed.authenticated) throw new Error("Login was not completed");
      await authenticated();
    } else if (result.promptType === "otp" && result.challengeId) setChallenge(result.challengeId);
    else throw new Error("Unsupported credential prompt");
  });
  const verify = () => run(async (signal) => {
    if (!challenge || !/^[0-9]{6}$/.test(code)) throw new Error("Enter the six-digit verification code");
    const result = await client.completePasswordLogin({ challengeId: challenge, proof: { code } }, options(signal));
    if (!result.authenticated) throw new Error("Login was not completed");
    await authenticated();
  });
  const reset = () => run(async (signal) => {
    await client.cancelPasswordLogin({}, options(signal)); ownsFlow.current = false;
    setPending(false); setChallenge(""); setCode(""); setProviders([]); setProvider("");
  });
  return { pending, providers, provider, setProvider, challenge, code, setCode, busy, error, start, beginFactor, verify, reset };
}

export type NativePasswordLogin = ReturnType<typeof useNativePasswordLogin>;
