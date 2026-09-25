import * as React from "react";
import { useNavigate } from "react-router-dom";
import Loading from "@/components/loading";

/**
 * ForceLoginGuard — navigates to the login page unconditionally on every mount.
 *
 * Used to wrap /admin/enroll so that opening the page in a new tab always
 * demands a fresh authentication, even if the browser already has a valid
 * session. The guard hits /api/logout first (which invalidates the current
 * session cookie server-side), then sends the user to the login page with a
 * returnTo pointing back here.
 */
export default function ForceLoginGuard({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = React.useState(false);
  const navigate = useNavigate();

  React.useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        // Invalidate any existing session. /api/logout clears the session_token
        // cookie server-side and returns a redirect; we do not follow it.
        await fetch("/api/logout", { method: "GET", redirect: "manual" });
      } catch {
        // network errors are non-fatal — the login page will handle auth state
      }
      if (!cancelled) {
        // Redirect to login with returnTo pointing at the current path.
        const returnTo = encodeURIComponent(window.location.pathname + window.location.search);
        navigate(`/login?returnTo=${returnTo}`, { replace: true });
      }
    };
    void run();
    return () => { cancelled = true; };
  }, [navigate]);

  // Show a loading indicator while the logout/redirect is in flight.
  if (!ready) return <Loading />;
  return <>{children}</>;
}
