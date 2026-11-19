import { useCallback, useEffect, useState } from "react";
import { Button, Callout, Container, Flex, Heading, Text } from "@radix-ui/themes";
import { LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import GuideHeader from "@/components/GuideHeader";
import RestrictedLoginDialog, { type RestrictedAuthStatus } from "@/components/RestrictedLoginDialog";

const base = "/api/admin/update/storage-v4";
type Status = {
  state: "pending" | "migrating" | "completed" | "failed";
  phase: string;
  current: number;
  total: number;
  elapsed_ms: number;
  error?: string;
};

export default function StorageUpdate() {
  const { t } = useTranslation();
  const [auth, setAuth] = useState<RestrictedAuthStatus | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const methods = await fetch(`${base}/auth`, { cache: "no-store", signal });
      if (methods.status === 404) {
        // The restricted listener disappears when startup hands over to the
        // ordinary router. Probe that router before navigating, including if
        // this page was reopened after completion.
        const probe = await fetch("/api/public", { cache: "no-store", signal });
        if (probe.ok) { window.location.replace("/admin"); return; }
      }
      if (!methods.ok) throw new Error(`HTTP ${methods.status}`);
      const payload = await methods.json();
      const me = await fetch("/api/me", { cache: "no-store", signal });
      if (!me.ok) throw new Error(`HTTP ${me.status}`);
      const identity = await me.json();
      setAuth({ ...payload.data, ...identity });
      if (!identity.logged_in) { setStatus(null); setError(""); return; }
      const response = await fetch(`${base}/status`, { cache: "no-store", signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json();
      if (result.status !== "success" || !result.data) throw new Error(result.message || "Invalid response");
      setStatus(result.data);
      setError("");
    } catch (e) {
      if (!signal?.aborted) setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      await load(controller.signal);
      if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 2500);
    };
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [load]);
  const retry = async () => {
    setBusy(true);
    try {
      const response = await fetch(`${base}/retry`, { method: "POST", cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  return <main className="km-storage-update min-h-screen p-6">
    <Container size="2">
      <GuideHeader />
      <Flex direction="column" gap="4" mt="8" aria-live="polite">
        <Heading>{t("storage_update.title")}</Heading>
        <Text>{t("storage_update.description")}</Text>
        <Callout.Root><Callout.Text>{t("storage_update.preserved")}</Callout.Text></Callout.Root>
        {error && <Callout.Root color="amber"><Callout.Text>{t("storage_update.network", { error })}</Callout.Text></Callout.Root>}
        {status && <>
          <Heading size="4">{t(`storage_update.states.${status.state}`)}</Heading>
          <Text>{t("storage_update.phase")}: {t(`storage_update.phases.${status.phase}`, { defaultValue: status.phase })}</Text>
          {status.state === "migrating" && <LoaderCircle className="animate-spin" aria-label={t("storage_update.working")} />}
          {status.total > 0
            ? <Text>{status.current.toLocaleString()} / {status.total.toLocaleString()}</Text>
            : <Text>{t("storage_update.processed", { count: status.current })}</Text>}
          <Text>{t("storage_update.elapsed", { seconds: Math.floor(status.elapsed_ms / 1000) })}</Text>
          {status.error && <Callout.Root color="red"><Callout.Text>{status.error}</Callout.Text></Callout.Root>}
          {status.state === "failed" && <Button disabled={busy} onClick={() => void retry()}>{t("storage_update.retry")}</Button>}
        </>}
      </Flex>
      <RestrictedLoginDialog auth={auth} onAuthenticated={() => load()} />
    </Container>
  </main>;
}
