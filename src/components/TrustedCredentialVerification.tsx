import { useTranslation } from "react-i18next";
import { Button, Flex, Select, Text, TextField } from "@radix-ui/themes";
import { CredentialPurpose } from "@komari/proto/komari/credential/v1/credential_pb";
import { useTrustedVerification } from "@/hooks/useTrustedVerification";
import { normalizeOTP, validOTP } from "@/utils/otpInput";

export default function TrustedCredentialVerification({ purpose, resource, onAuthorized }: {
  purpose: CredentialPurpose;
  resource: string;
  onAuthorized: (token: string, signal: AbortSignal) => Promise<void>;
}) {
  const { t } = useTranslation();
  const flow = useTrustedVerification(purpose, resource, onAuthorized);
  return <Flex direction="column" gap="3" className="km-trusted-credential-verification">
    {flow.error && <Text size="2" color="red" role="alert">{flow.error}</Text>}
    {!flow.challenge ? <>
      <Flex direction="column" gap="2">
        <Text size="2" weight="medium">{t("account.native_otp.provider")}</Text>
        <Select.Root value={flow.provider} disabled={flow.busy || !flow.providers.length} onValueChange={flow.setProvider}>
          <Select.Trigger aria-label={t("account.native_otp.provider")} placeholder={t("account.native_otp.no_provider")} style={{ width: "100%" }} />
          <Select.Content position="popper" style={{ zIndex: 200010 }}>
            {flow.providers.map((provider) => <Select.Item key={provider.id} value={provider.id}>{provider.displayName}</Select.Item>)}
          </Select.Content>
        </Select.Root>
      </Flex>
      <Button type="button" loading={flow.busy} disabled={flow.busy || !flow.provider} onClick={() => void flow.begin()}>{t("account.native_otp.begin")}</Button>
    </> : <>
      <Flex direction="column" gap="2">
        <Text size="2" weight="medium">{t("account.native_otp.enter_code")}</Text>
        <TextField.Root autoFocus aria-label={t("account.native_otp.enter_code")} autoComplete="one-time-code" autoCapitalize="characters" spellCheck={false} inputMode={flow.format.alphanumeric ? "text" : "numeric"} maxLength={flow.format.length} value={flow.code} disabled={flow.busy} placeholder={flow.format.alphanumeric ? "AB12CD34" : "000000"} onChange={(event) => flow.setCode(normalizeOTP(event.target.value, flow.format))} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void flow.verify(); } }} />
      </Flex>
      <Button type="button" loading={flow.busy} disabled={flow.busy || !validOTP(flow.code, flow.format)} onClick={() => void flow.verify()}>{t("account.native_otp.verify")}</Button>
      <Button type="button" variant="soft" color="gray" disabled={flow.busy} onClick={flow.reset}>{t("account.native_otp.cancel")}</Button>
    </>}
  </Flex>;
}
