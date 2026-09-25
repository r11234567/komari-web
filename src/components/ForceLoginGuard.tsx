import * as React from "react";
import { useNavigate } from "react-router-dom";

export default function ForceLoginGuard() {
  const navigate = useNavigate();

  React.useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        await fetch("/api/logout", { method: "GET", redirect: "manual" });
      } catch {
        // network errors are non-fatal
      }
      if (!cancelled) {
        const returnTo = encodeURIComponent(window.location.pathname + window.location.search);
        navigate(`/login?returnTo=${returnTo}`, { replace: true });
      }
    };
    void run();
    return () => { cancelled = true; };
  }, [navigate]);

  return null;
}
