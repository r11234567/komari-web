import * as React from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AccountProvider, useAccount } from "@/contexts/AccountContext";

const NONCE_TTL_MS = 3 * 60 * 1000;
const AUTH_TTL_MS = 10 * 60 * 1000;
const NONCE_PREFIX = "komari:enroll:nonce:";
const TAB_ID_KEY = "komari:enroll:tab";

function tabStorageKey(prefix: string): string {
  let tabId = sessionStorage.getItem(TAB_ID_KEY);
  if (!tabId) {
    tabId = crypto.randomUUID();
    sessionStorage.setItem(TAB_ID_KEY, tabId);
  }
  return `${prefix}:${tabId}`;
}

export function generateEnrollNonce(): string {
  const nonce = crypto.randomUUID();
  // localStorage is shared with a newly opened tab; sessionStorage is not.
  localStorage.setItem(
    `${NONCE_PREFIX}${nonce}`,
    JSON.stringify({ expires: Date.now() + NONCE_TTL_MS }),
  );
  return nonce;
}

function consumeNonce(nonce: string): boolean {
  const key = `${NONCE_PREFIX}${nonce}`;
  const raw = localStorage.getItem(key);
  if (!raw) return false;
  localStorage.removeItem(key);
  try {
    const { expires } = JSON.parse(raw) as { expires: number };
    return Date.now() < expires;
  } catch {
    return false;
  }
}

function readAuth(): boolean {
  const authKey = tabStorageKey("komari:enroll:access");
  try {
    const raw = sessionStorage.getItem(authKey);
    if (!raw) return false;
    const value = JSON.parse(raw) as { token?: string; expires?: number };
    if (!value.token || !value.expires || Date.now() >= value.expires) {
      sessionStorage.removeItem(authKey);
      return false;
    }
    return true;
  } catch {
    sessionStorage.removeItem(authKey);
    return false;
  }
}

function writeAuth() {
  sessionStorage.setItem(
    tabStorageKey("komari:enroll:access"),
    JSON.stringify({ token: crypto.randomUUID(), expires: Date.now() + AUTH_TTL_MS }),
  );
}

function GuardContent({ children }: { children?: React.ReactNode }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { account, loading } = useAccount();
  const nonce = searchParams.get("nonce");
  const [state, setState] = React.useState<"checking" | "redirecting" | "allowed">("checking");
  const handledRef = React.useRef(false);

  React.useEffect(() => {
    if (loading || handledRef.current) return;
    handledRef.current = true;

    if (nonce) consumeNonce(nonce);
    const authenticated = readAuth();
    const pendingKey = tabStorageKey("komari:enroll:login-pending");
    if (nonce) sessionStorage.removeItem(pendingKey);
    const pendingLogin = sessionStorage.getItem(pendingKey) === "1";

    // The return from /login is the only path that can turn the short-lived
    // browser marker into an authorized enroll view.
    if (account?.logged_in && pendingLogin) {
      sessionStorage.removeItem(pendingKey);
      writeAuth();
      setState("allowed");
      return;
    }

    // An opener nonce, or an expired/missing ten-minute marker, always starts
    // a fresh login. This also handles direct navigation to the page.
    if (account?.logged_in && authenticated && !nonce) {
      setState("allowed");
      return;
    }

    if (sessionStorage.getItem(pendingKey) !== "1") {
      sessionStorage.setItem(pendingKey, "1");
      sessionStorage.removeItem(tabStorageKey("komari:enroll:access"));
      setState("redirecting");
      void fetch("/api/logout", { method: "GET", redirect: "manual" }).finally(() => {
        const next = new URL(window.location.href);
        next.searchParams.delete("nonce");
        navigate(`/login?returnTo=${encodeURIComponent(next.pathname + next.search)}`, { replace: true });
      });
    } else {
      setState("redirecting");
      navigate(`/login?returnTo=${encodeURIComponent(window.location.pathname + window.location.search)}`, { replace: true });
    }
  }, [account?.logged_in, loading, navigate, nonce]);

  if (state !== "allowed") return null;
  return <>{children}</>;
}

export default function ForceLoginGuard({ children }: { children?: React.ReactNode }) {
  return (
    <AccountProvider>
      <GuardContent>{children}</GuardContent>
    </AccountProvider>
  );
}
