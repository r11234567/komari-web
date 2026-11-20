import { useEffect, useState } from "react";
import { connectClients } from "@/api/connect/client";

export function usePasskeyStatus() {
  const [enabled, setEnabled] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    const abort = new AbortController();
    connectClients.passkeyLogin.getPasskeyStatus({}, { signal: abort.signal })
      .then(({ enabled }) => { if (!abort.signal.aborted) setEnabled(enabled); })
      .catch(() => { if (!abort.signal.aborted) setEnabled(false); });
    return () => abort.abort();
  }, []);
  return enabled;
}
