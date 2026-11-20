import { useEffect, useState } from "react";
import { connectClients } from "@/api/connect/client";

export function usePasskeyStatus(override?: boolean) {
  const [enabled, setEnabled] = useState<boolean | undefined>(override);
  useEffect(() => {
    if (override !== undefined) {
      setEnabled(override);
      return;
    }
    const abort = new AbortController();
    connectClients.passkeyLogin.getPasskeyStatus({}, { signal: abort.signal })
      .then(({ enabled }) => { if (!abort.signal.aborted) setEnabled(enabled); })
      .catch(() => { if (!abort.signal.aborted) setEnabled(false); });
    return () => abort.abort();
  }, [override]);
  return override !== undefined ? override : enabled;
}
