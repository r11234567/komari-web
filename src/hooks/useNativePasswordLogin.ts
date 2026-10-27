import { useEffect, useRef, useState } from "react";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { clearPasswordLoginHandoff, readPasswordLoginHandoff, savePasswordLoginHandoff, type PasswordFactorProvider } from "@/utils/passwordLoginHandoff";
import { connectClients } from "@/api/connect/client";
import { requestTrustedPasskey } from "@/utils/trustedPasskey";
import { otpFormat, validOTP } from "@/utils/otpInput";

const client = connectClients.passwordLogin;

export function useNativePasswordLogin(onAuthenticated: () => Promise<void> | void, mode: "inline" | "handoff" | "resume" = "inline") {
  const [handoff] = useState(() => mode === "resume" ? readPasswordLoginHandoff() : null);
  const [pending, setPending] = useState(Boolean(handoff));
  const [providers, setProviders] = useState<PasswordFactorProvider[]>(handoff?.providers ?? []);
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
    if (ownsFlow.current) void client.cancelPasswordLogin({}).catch(() => {});
  }, []);
  const options = (signal: AbortSignal) => ({ signal, timeoutMs: 30_000 });
  const run = async (operation: (signal: AbortSignal) => Promise<void>) => {
    if (active.current) return false;
    const controller = new AbortController(); active.current = controller; setBusy(true); setError("");
    try { await operation(controller.signal); return true; }
    catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Login failed"); return false; }
    finally { if (active.current === controller) { active.current = null; setBusy(false); } }
  };
  const authenticated = async () => { clearPasswordLoginHandoff(); ownsFlow.current = false; setPending(false); setChallenge(""); setCode(""); await success.current(); };
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
    if (mode === "handoff") {
      if (!result.expiresAt) throw new Error("Missing login expiration");
      savePasswordLoginHandoff(result.providers, timestampDate(result.expiresAt).getTime());
      // The next document owns this server flow. Unmount must not cancel it.
      ownsFlow.current = false;
      window.location.assign("/login");
      return;
    }
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
    await client.cancelPasswordLogin({}, options(signal)); clearPasswordLoginHandoff(); ownsFlow.current = false;
    setPending(false); setChallenge(""); setCode(""); setProviders([]); setProvider("");
  });
  useEffect(() => {
    if (!handoff) return;
    let disposed = false;
    // Defer until effect setup settles: React StrictMode must not send two OTPs
    // or consume/cancel the handoff during its development-only effect replay.
    void Promise.resolve().then(() => {
      if (disposed) return;
      clearPasswordLoginHandoff();
      ownsFlow.current = true;
      const selected = handoff.providers.find((item) => item.id === "native:email_otp") ?? handoff.providers[0];
      setProvider(selected.id);
      void run((signal) => beginSelectedFactor(selected.id, signal));
    });
    return () => { disposed = true; };
    // A handoff is restored once per document, never on provider/input renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handoff]);
  return { pending, providers, provider, setProvider, challenge, code, setCode, format, busy, error, start, beginFactor, verify, reset };
}

export type NativePasswordLogin = ReturnType<typeof useNativePasswordLogin>;
