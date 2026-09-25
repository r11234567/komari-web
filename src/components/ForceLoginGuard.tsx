import * as React from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

// Wraps a page that must always start with a fresh login.
// The caller opens the page with a ?t=<timestamp> query param (e.g. via window.open).
// On first entry (t present) we log out and redirect to /login with returnTo pointing
// at the bare pathname — no t param — so after login we land here without t, skip the
// logout, and render children normally. Without this guard the page falls into a loop:
// logout → login → back here → logout → ...
export default function ForceLoginGuard({ children }: { children?: React.ReactNode }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const hasToken = searchParams.has("t");

  React.useEffect(() => {
    if (!hasToken) return;
    let cancelled = false;
    const run = async () => {
      try {
        await fetch("/api/logout", { method: "GET", redirect: "manual" });
      } catch {
        // network errors are non-fatal
      }
      if (!cancelled) {
        // returnTo uses only pathname — strips ?t so the post-login redirect
        // lands here without t and does not re-trigger the guard.
        const returnTo = encodeURIComponent(window.location.pathname);
        navigate(`/login?returnTo=${returnTo}`, { replace: true });
      }
    };
    void run();
    return () => { cancelled = true; };
  }, [hasToken, navigate]);

  if (hasToken) return null;
  return <>{children}</>;
}
