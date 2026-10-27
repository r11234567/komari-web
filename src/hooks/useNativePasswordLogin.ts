import { useEffect, useRef, useState } from "react";
import { connectClients } from "@/api/connect/client";
import { requestTrustedPasskey } from "@/utils/trustedPasskey";
import { otpFormat, validOTP } from "@/utils/otpInput";

const client = connectClients.passwordLogin;

export function useNativePasswordLogin(onAuthenticated: () => Promise<void> | void, mode: "inline" | "verify" = "inline") {
  const [pending, setPending] = useState(mode === "verify");
  const [providers, setProviders] = useState<{ id: string; displayName: string }[]>([]);
  const [provider, setProvider] = useState("");
  const [challenge, setChallenge] = useState("");
  const [code, setCode] = useState("");
  const [format, setFormat] = useState(otpFormat(undefined));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const active = useRef<AbortController | null>(null);
  const ownsFlow = useRef(false);
  const success = useRef(onAuthenticated); success.current = onAuthenticated;
  useEffect(() => () => {
    active.current?.abort();
    if (mode === "inline" && ownsFlow.current) void client.cancelPasswordLogin({}).catch(() => {});
  }, [mode]);
  const options = (signal: AbortSignal) => ({ signal, timeoutMs: 30_000 });
  const run = async (operation: (signal: AbortSignal) => Promise<void>) => {
    if (active.current) return false;
    const controller = new AbortController(); active.current = controller; setBusy(true); setError("");
    try { await operation(controller.signal); return true; }
    catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Login failed"); return false; }
    finally { if (active.current === controller) { active.current = null; setBusy(false); } }
  };
  const authenticated = async () => { ownsFlow.current = false; setPending(false); setChallenge(""); setCode(""); await success.current(); };
  const beginSelectedFactor = async (providerId: string, signal: AbortSignal) => {
    const result = await client.beginLoginVerification({ providerId }, options(signal));
    if (signal.aborted) return;
    setChallenge(""); setCode("");
    if (result.promptType === "webauthn") {
      const proof = await requestTrustedPasskey(result.prompt, signal);
      const completed = await client.completePasswordLogin({ challengeId: result.challengeId, proof }, options(signal));
      if (!completed.authenticated) throw new Error("Login was not completed");
      await authenticated();
    } else if (result.promptType === "otp" && result.challengeId) { setFormat(otpFormat(result.prompt)); setChallenge(result.challengeId); }
    else throw new Error("Unsupported credential prompt");
  };
  const start = (username: string, password: string) => run(async (signal) => {
    const result = await client.beginPasswordLogin({ username, password }, options(signal));
    if (signal.aborted) return;
    if (result.authenticated) { await authenticated(); return; }
    ownsFlow.current = true; setPending(true); setProviders(result.providers);
    // Email is the default password second factor. Existing accounts without
    // email retain their configured factor; no factor is bypassed or removed.
    const selected = result.providers.find((item) => item.id === "native:email_otp") ?? result.providers[0];
    setProvider(selected?.id ?? ""); setChallenge(""); setCode("");
    if (!selected) throw new Error("No available second factor");
    await beginSelectedFactor(selected.id, signal);
  });
  const beginFactor = () => run((signal) => beginSelectedFactor(provider, signal));
  const verify = () => run(async (signal) => {
    if (!challenge || !validOTP(code, format)) throw new Error("Enter the complete verification code");
    const result = await client.completePasswordLogin({ challengeId: challenge, proof: { code } }, options(signal));
    if (!result.authenticated) throw new Error("Login was not completed");
    await authenticated();
  });
  const reset = () => run(async (signal) => {
    await client.cancelPasswordLogin({}, options(signal)); ownsFlow.current = false;
    setPending(false); setChallenge(""); setCode(""); setProviders([]); setProvider("");
  });
  useEffect(() => {
    if (mode !== "verify") return;
    let disposed = false;
    // StrictMode's initial effect replay settles before starting delivery.
    // The server cookie restores the ceremony; an empty provider asks the
    // server to resume its challenge or choose the configured default factor.
    void Promise.resolve().then(() => {
      if (!disposed) void run((signal) => beginSelectedFactor("", signal));
    });
    return () => { disposed = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);
  return { canBeginFactor: mode === "verify" || Boolean(provider), pending, providers, provider, setProvider, challenge, code, setCode, format, busy, error, start, beginFactor, verify, reset };
}

export type NativePasswordLogin = ReturnType<typeof useNativePasswordLogin>;
