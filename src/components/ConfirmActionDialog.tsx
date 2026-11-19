import { useEffect, useRef, useState } from "react";
import { AlertDialog, Button, Flex, Text } from "@radix-ui/themes";
import { useTranslation } from "react-i18next";

export type ConfirmAction = {
  title: string;
  description: string;
  label: string;
  execute: (signal: AbortSignal) => Promise<void>;
};

// Authority-reducing actions need an ordinary confirmation, not a credential.
export default function ConfirmActionDialog({ request, onClose }: { request: ConfirmAction | null; onClose: () => void }) {
  const { t } = useTranslation();
  const controller = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setError(""); setBusy(false);
    return () => { controller.current?.abort(); controller.current = null; };
  }, [request]);
  const confirm = async () => {
    if (!request || busy) return;
    const task = new AbortController(); controller.current = task;
    setBusy(true); setError("");
    try { await request.execute(task.signal); if (!task.signal.aborted) onClose(); }
    catch (cause) { if (!task.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (!task.signal.aborted) setBusy(false); }
  };
  return <AlertDialog.Root open={!!request} onOpenChange={open => { if (!open && !busy) onClose(); }}><AlertDialog.Content maxWidth="400px">
    <AlertDialog.Title>{request?.title}</AlertDialog.Title><AlertDialog.Description>{request?.description}</AlertDialog.Description>
    {error && <Text as="p" size="2" color="red" role="alert">{error}</Text>}
    <Flex justify="end" gap="2" mt="4"><AlertDialog.Cancel><Button variant="soft" disabled={busy}>{t("common.cancel")}</Button></AlertDialog.Cancel><Button color="red" disabled={busy} loading={busy} onClick={() => void confirm()}>{request?.label}</Button></Flex>
  </AlertDialog.Content></AlertDialog.Root>;
}
