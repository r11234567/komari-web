import { Button, Flex, Text, TextField } from "@radix-ui/themes";
import { useTranslation } from "react-i18next";
import type { NativePasswordLogin } from "@/hooks/useNativePasswordLogin";

export default function PasswordCredentialStep({ login }: { login: NativePasswordLogin }) {
  const { t } = useTranslation();
  return <Flex direction="column" gap="3" className="km-password-credential-step">
    <Text>{t("login.two_factor")}</Text>
    {!login.challenge ? <>
      <select aria-label={t("account.native_otp.provider")} value={login.provider} disabled={login.busy} onChange={(e) => login.setProvider(e.target.value)}>
        {login.providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.displayName}</option>)}
      </select>
      <Button type="button" disabled={login.busy || !login.provider} onClick={() => void login.beginFactor()}>{t("account.native_otp.begin")}</Button>
    </> : <>
      <TextField.Root aria-label={t("account.native_otp.enter_code")} value={login.code} autoComplete="one-time-code" inputMode="numeric" maxLength={6} disabled={login.busy} onChange={(e) => login.setCode(e.target.value.replace(/[^0-9]/g, ""))} placeholder="000000" />
      <Button type="button" disabled={login.busy || login.code.length !== 6} onClick={() => void login.verify()}>{t("account.native_otp.verify")}</Button>
    </>}
    <Button type="button" variant="soft" disabled={login.busy} onClick={() => void login.reset()}>{t("account.native_otp.cancel")}</Button>
  </Flex>;
}
