import { useEffect, useRef, useState } from "react";
import { Badge, Button, Flex, Select, Text, TextField } from "@radix-ui/themes";
import { useTranslation } from "react-i18next";
import { CredentialPurpose, type GetCredentialContactsResponse, type TrustedCredentialProvider } from "@komari/proto/komari/credential/v1/credential_pb";
import { connectClients } from "@/api/connect/client";
import { deleteContactResource, nativeContactResource, normalizeNativeContact, type ContactKind, type NativeContactDraft } from "@/utils/nativeContacts";
import { toast } from "sonner";
import { requestTrustedPasskey } from "@/utils/trustedPasskey";
import { normalizeOTP, otpFormat, validOTP } from "@/utils/otpInput";

type Action = { type: "bind"; draft: NativeContactDraft; resource: string } | { type: "delete"; kind: ContactKind; resource: string };
type Stage = "edit" | "authorize" | "destination";
const client = connectClients.credential;

export default function NativeCredentialContacts() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<GetCredentialContactsResponse>();
  const [kind, setKind] = useState<ContactKind>("email");
  const [address, setAddress] = useState("");
  const [transport, setTransport] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [format, setFormat] = useState(otpFormat(undefined));
  const [stage, setStage] = useState<Stage>("edit");
  const [action, setAction] = useState<Action>();
  const [providers, setProviders] = useState<TrustedCredentialProvider[]>([]);
  const [provider, setProvider] = useState("");
  const [challenge, setChallenge] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const active = useRef<AbortController | null>(null);
  const challengeRef = useRef("");
  const available = settings?.transports.filter((item) => item.kinds.includes(kind)) ?? [];
  const chosenTransport = available.some((item) => item.id === transport) ? transport : available[0]?.id ?? "";
  const options = (signal: AbortSignal) => ({ signal, timeoutMs: 30_000 });

  useEffect(() => {
    const controller = new AbortController();
    void client.getCredentialContacts({}, { signal: controller.signal, timeoutMs: 30_000 }).then(setSettings).catch((e: unknown) => {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Unable to load contacts");
    });
    return () => {
      controller.abort(); active.current?.abort();
      if (challengeRef.current) void client.cancelVerification({ challengeId: challengeRef.current }).catch(() => {});
    };
  }, []);

  const rememberChallenge = (id: string) => { challengeRef.current = id; setChallenge(id); setCode(""); };
  const reset = () => {
    active.current?.abort();
    if (challengeRef.current) void client.cancelVerification({ challengeId: challengeRef.current }).catch(() => {});
    rememberChallenge(""); setStage("edit"); setAction(undefined); setPassword(""); setError("");
  };
  const run = async (operation: (signal: AbortSignal) => Promise<void>) => {
    active.current?.abort();
    const controller = new AbortController(); active.current = controller; setBusy(true); setError("");
    try { await operation(controller.signal); }
    catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Verification failed"); }
    finally { if (active.current === controller) { active.current = null; setBusy(false); } }
  };
  const refresh = async (signal: AbortSignal) => { setSettings(await client.getCredentialContacts({}, options(signal))); };
  const startDestination = async (draft: NativeContactDraft, token: string, signal: AbortSignal) => {
    const result = await client.beginContactBinding({ ...draft, authorizationToken: token, password: token ? "" : password }, options(signal));
    if (result.promptType !== "otp" || !result.challengeId) throw new Error("Unsupported verification prompt");
    setFormat(otpFormat(result.prompt)); setPassword(""); rememberChallenge(result.challengeId); setStage("destination");
  };
  const authorize = async (pending: Action, signal: AbortSignal) => {
    const result = await client.listTrustedCredentialProviders({ purpose: CredentialPurpose.MANAGE_CREDENTIALS }, options(signal));
    if (!result.providers.length) throw new Error(t("account.native_otp.no_provider"));
    setProviders(result.providers); setProvider(result.providers[0].id); setAction(pending); setStage("authorize");
  };
  const startBinding = () => void run(async (signal) => {
    const draft = normalizeNativeContact(kind, address, chosenTransport);
    const pending: Action = { type: "bind", draft, resource: nativeContactResource(draft) }; setAction(pending);
    if (settings?.passwordBootstrapAllowed) await startDestination(draft, "", signal);
    else await authorize(pending, signal);
  });
  const startVerification = () => void run(async (signal) => {
    if (!action) return;
    const result = await client.beginVerification({ providerId: provider, purpose: CredentialPurpose.MANAGE_CREDENTIALS, resource: action.resource }, options(signal));
    if (!result.challengeId || !["otp", "webauthn"].includes(result.promptType)) throw new Error("Unsupported verification prompt");
    setFormat(otpFormat(result.prompt)); rememberChallenge(result.challengeId);
    if (result.promptType === "webauthn") {
      let token: string | undefined;
      try {
        const proof = await requestTrustedPasskey(result.prompt, signal);
        const completed = await client.completeVerification({ challengeId: result.challengeId, proof }, options(signal));
        token = completed.authorization?.grantToken;
      } catch (error) {
        void client.cancelVerification({ challengeId: result.challengeId }).catch(() => {});
        if (challengeRef.current === result.challengeId) rememberChallenge("");
        throw error;
      }
      await finish(token, signal);
    }
  });
  const finish = async (token: string | undefined, signal: AbortSignal) => {
    if (!action || !token) throw new Error("Missing credential authorization");
    rememberChallenge("");
    if (stage === "authorize" && action.type === "bind") { await startDestination(action.draft, token, signal); return; }
    if (action.type === "delete") await client.deleteCredentialContact({ kind: action.kind, grantToken: token }, options(signal));
    else await client.saveCredentialContact({ ...action.draft, grantToken: token }, options(signal));
    await refresh(signal); setStage("edit"); setAction(undefined); setAddress(""); setPassword("");
    toast.success(t("account.native_otp.saved"));
  };
  const verify = () => void run(async (signal) => {
    if (!action || !challenge || !validOTP(code, format)) throw new Error(t("account.native_otp.enter_code"));
    const result = await client.completeVerification({ challengeId: challenge, proof: { code } }, options(signal));
    await finish(result.authorization?.grantToken, signal);
  });

  return <Flex direction="column" gap="3" className="km-account-native-otp w-full max-w-xl">
    <Text size="5" weight="bold">{t("account.native_otp.title")}</Text>
    <Text size="2" color="gray">{t("account.native_otp.description")}</Text>
    {error && <Text role="alert" color="red">{error}</Text>}
    {settings?.contacts.map((contact) => <Flex key={contact.kind} gap="2" align="center" wrap="wrap">
      <Badge color="green">{contact.kind === "email" ? t("account.native_otp.email") : "Telegram"}</Badge>
      <Text>{contact.maskedAddress}</Text><Text color="gray">{contact.transport}</Text>
      <Button size="1" variant="soft" color="red" disabled={busy || stage !== "edit"} onClick={() => void run((signal) => authorize({ type: "delete", kind: contact.kind as ContactKind, resource: deleteContactResource(contact.kind as ContactKind) }, signal))}>{t("account.native_otp.remove")}</Button>
    </Flex>)}
    {stage === "edit" ? <>
      <label className="grid gap-1 text-sm">{t("account.native_otp.contact_type")}
        <Select.Root value={kind} disabled={busy} onValueChange={(value) => { setKind(value as ContactKind); setAddress(""); }}>
          <Select.Trigger aria-label={t("account.native_otp.contact_type")} style={{ width: "100%" }} />
          <Select.Content position="popper">
            <Select.Item value="email">{t("account.native_otp.email")}</Select.Item><Select.Item value="telegram">Telegram</Select.Item>
          </Select.Content>
        </Select.Root>
      </label>
      <TextField.Root aria-label={kind === "email" ? t("account.native_otp.email") : t("account.native_otp.telegram_id")} type={kind === "email" ? "email" : "text"} inputMode={kind === "telegram" ? "numeric" : "email"} autoComplete="off" value={address} disabled={busy} onChange={(e) => setAddress(e.target.value)} placeholder={kind === "email" ? "you@example.com" : t("account.native_otp.telegram_id")} />
      <label className="grid gap-1 text-sm">{t("account.native_otp.transport")}
        <Select.Root value={chosenTransport} disabled={busy || !available.length} onValueChange={setTransport}>
          <Select.Trigger aria-label={t("account.native_otp.transport")} placeholder={t("account.native_otp.no_transport")} style={{ width: "100%" }} />
          <Select.Content position="popper">
            {available.map((item) => <Select.Item key={item.id} value={item.id}>{item.id}</Select.Item>)}
          </Select.Content>
        </Select.Root>
      </label>
      {kind === "telegram" && <Text size="2" color="gray">{t("account.native_otp.telegram_hint")}</Text>}
      {settings?.passwordBootstrapAllowed && <TextField.Root aria-label={t("account.native_otp.password")} type="password" autoComplete="current-password" value={password} disabled={busy} onChange={(e) => setPassword(e.target.value)} placeholder={t("account.native_otp.password")} />}
      <Button disabled={busy || !settings || !chosenTransport || !address || (settings.passwordBootstrapAllowed && !password)} onClick={startBinding}>{t("account.native_otp.bind")}</Button>
    </> : <>
      <Text>{t(stage === "authorize" ? "account.native_otp.verify_existing" : "account.native_otp.verify_new")}</Text>
      {stage === "authorize" && !challenge && <>
        <Select.Root value={provider} disabled={busy || !providers.length} onValueChange={setProvider}>
          <Select.Trigger aria-label={t("account.native_otp.provider")} placeholder={t("account.native_otp.no_provider")} style={{ width: "100%" }} />
          <Select.Content position="popper">
            {providers.map((item) => <Select.Item key={item.id} value={item.id}>{item.displayName}</Select.Item>)}
          </Select.Content>
        </Select.Root>
        <Button disabled={busy || !provider} onClick={startVerification}>{t("account.native_otp.begin")}</Button>
      </>}
      {challenge && <>
        <TextField.Root aria-label={t("account.native_otp.enter_code")} value={code} inputMode={format.alphanumeric ? "text" : "numeric"} autoComplete="one-time-code" autoCapitalize="characters" spellCheck={false} maxLength={format.length} disabled={busy} onChange={(e) => setCode(normalizeOTP(e.target.value, format))} placeholder={format.alphanumeric ? "AB12CD34" : "000000"} />
        <Button disabled={busy || !validOTP(code, format)} onClick={verify}>{t("account.native_otp.verify")}</Button>
      </>}
      <Button variant="soft" onClick={reset}>{t("account.native_otp.cancel")}</Button>
    </>}
  </Flex>;
}
