import { useEffect, useRef, useState } from "react";
import { Button, Flex, Heading, Text, TextField } from "@radix-ui/themes";
import { useTranslation } from "react-i18next";
import { CredentialPurpose } from "@komari/proto/komari/credential/v1/credential_pb";
import type { PasskeySummary } from "@komari/proto/komari/credential/v1/passkey_pb";
import { connectClients } from "@/api/connect/client";
import TrustedCredentialVerification from "@/components/TrustedCredentialVerification";
import { usePasskeyStatus } from "@/hooks/usePasskeyStatus";
import { registerPasskey } from "@/utils/nativePasskey";

type Action = { kind: "list" } | { kind: "register"; name: string } | { kind: "delete"; id: string };

export default function NativePasskeys() {
  const { t } = useTranslation();
  const enabled = usePasskeyStatus();
  const [rows, setRows] = useState<PasskeySummary[]>([]);
  const [listed, setListed] = useState(false);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [bootstrap, setBootstrap] = useState(false);
  const [action, setAction] = useState<Action | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const active = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    connectClients.credential.getCredentialContacts({}, { signal: controller.signal })
      .then(r => { if (!controller.signal.aborted) setBootstrap(r.passwordBootstrapAllowed); })
      .catch(() => {});
    return () => { controller.abort(); active.current?.abort(); };
  }, [enabled]);
  if (!enabled) return null;

  async function perform(op: Action, token: string, signal: AbortSignal) {
    const client = connectClients.passkeyManagement;
    if (op.kind === "list") {
      const result = await client.listPasskeys({ authorizationToken: token }, { signal });
      setRows(result.passkeys); setListed(true);
    } else if (op.kind === "register") {
      const key = await registerPasskey(op.name, token, password, signal);
      setBootstrap(false); setName(""); setPassword("");
      setRows(old => [...old, key]); setMessage(t("account.passkey.added", "Passkey added"));
    } else {
      await client.deletePasskey({ credentialId: op.id, authorizationToken: token }, { signal });
      setRows(old => old.filter(k => k.credentialId !== op.id));
      setMessage(t("account.passkey.deleted", "Passkey deleted"));
    }
    setAction(null);
  }
  async function startRegistration() {
    const op: Action = { kind: "register", name: name.trim() };
    setMessage("");
    if (!bootstrap) { setAction(op); return; }
    if (active.current) return;
    const abort = new AbortController(); active.current = abort; setBusy(true);
    try { await perform(op, "", abort.signal); }
    catch (e) { if (!abort.signal.aborted) setMessage(e instanceof Error ? e.message : "Registration failed"); }
    finally { active.current = null; if (!abort.signal.aborted) setBusy(false); }
  }
  const resource = action?.kind === "delete" ? "passkey:delete:" + action.id
    : action?.kind === "register" ? "passkey:register:" + action.name : "passkey:list";
  return <Flex direction="column" gap="3">
    <Heading size="4">{t("account.passkey.title", "Passkeys")}</Heading>
    {message && <Text role="status">{message}</Text>}
    <TextField.Root aria-label={t("account.passkey.name", "Passkey name")} placeholder={t("account.passkey.name", "Passkey name")} maxLength={80} value={name} disabled={!!action || busy} onChange={e => setName(e.target.value)} />
    {bootstrap && <TextField.Root type="password" autoComplete="current-password" aria-label={t("login.password")} placeholder={t("login.password")} value={password} onChange={e => setPassword(e.target.value)} />}
    <Flex gap="2"><Button type="button" disabled={!name.trim() || busy || !!action || (bootstrap && !password)} onClick={() => void startRegistration()}>{t("account.passkey.add", "Add passkey")}</Button>
      <Button type="button" variant="soft" disabled={bootstrap || !!action || busy} onClick={() => { setMessage(""); setAction({ kind: "list" }); }}>{t("account.passkey.show", "Show passkeys")}</Button></Flex>
    {listed && !rows.length && <Text>{t("account.passkey.empty", "No passkeys registered")}</Text>}
    {rows.map(k => <Flex key={k.credentialId} gap="2" align="center"><Text>{k.displayName}</Text><Button variant="soft" color="red" type="button" disabled={!!action || busy} onClick={() => { setMessage(""); setAction({ kind: "delete", id: k.credentialId }); }}>{t("common.delete", "Delete")}</Button></Flex>)}
    {action && <Flex direction="column" gap="2">
      <TrustedCredentialVerification key={resource} purpose={CredentialPurpose.MANAGE_CREDENTIALS} resource={resource} onAuthorized={(token, signal) => perform(action, token, signal)} />
      <Button type="button" variant="soft" onClick={() => setAction(null)}>{t("common.cancel", "Cancel")}</Button>
    </Flex>}
  </Flex>;
}
