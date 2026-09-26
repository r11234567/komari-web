import * as React from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

// Enroll pages require a fresh login every time they are opened.
// The caller (index.tsx) generates a random nonce, stores it in sessionStorage
// with a 3-minute TTL, and opens the page as /admin/enroll?nonce=<uuid>.
//
// On mount, this guard reads the nonce from the URL, checks sessionStorage for
// a matching entry that hasn't expired, deletes it immediately (single-use),
// and if valid triggers logout → redirect to /login?returnTo=/admin/enroll.
// After the user logs in, they land back here WITHOUT a nonce, so the guard
// renders children normally.
//
// An attacker cannot forge a valid nonce because it is a random UUID that was
// never transmitted over the network — it only ever exists in sessionStorage of
// the same browser session that opened the tab.

const NONCE_TTL_MS = 3 * 60 * 1000; // 3 minutes

export function generateEnrollNonce(): string {
  const nonce = crypto.randomUUID();
  const key = `enroll_nonce_${nonce}`;
  sessionStorage.setItem(key, JSON.stringify({ expires: Date.now() + NONCE_TTL_MS }));
  return nonce;
}

function consumeNonce(nonce: string): boolean {
  const key = `enroll_nonce_${nonce}`;
  const raw = sessionStorage.getItem(key);
  if (!raw) return false;
  sessionStorage.removeItem(key);
  try {
    const { expires } = JSON.parse(raw) as { expires: number };
    return Date.now() < expires;
  } catch {
    return false;
  }
}

export default function ForceLoginGuard({ children }: { children?: React.ReactNode }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const nonce = searchParams.get("nonce");

  // valid is tri-state: null = not yet checked, true/false = result.
  const [valid, setValid] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    if (!nonce) {
      setValid(false);
      return;
    }
    const ok = consumeNonce(nonce);
    setValid(ok);
    if (ok) {
      let cancelled = false;
      const run = async () => {
        try {
          await fetch("/api/logout", { method: "GET", redirect: "manual" });
        } catch {
          // non-fatal
        }
        if (!cancelled) {
          const returnTo = encodeURIComponent(window.location.pathname);
          navigate(`/login?returnTo=${returnTo}`, { replace: true });
        }
      };
      void run();
      return () => { cancelled = true; };
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);  // run once on mount — nonce is consumed and must not re-run

  // Still checking, or valid nonce triggered logout redirect — render nothing.
  if (valid === null || valid === true) return null;
  // No nonce or expired nonce — render the page normally (post-login landing).
  return <>{children}</>;
}
