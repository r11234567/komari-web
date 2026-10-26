import { Button, Flex, Text, TextField } from "@radix-ui/themes";
import { useTranslation } from "react-i18next";
import type { NativePasswordLogin } from "@/hooks/useNativePasswordLogin";
import { normalizeOTP, validOTP } from "@/utils/otpInput";

export default function PasswordCredentialStep({ login }: { login: NativePasswordLogin }) {
  const { t } = useTranslation();
  return <Flex direction="column" gap="3" className="km-password-credential-step">
    <Text>{t("login.two_factor")}</Text>
    {login.challenge && <TextField.Root autoFocus aria-label={t("account.native_otp.enter_code")} value={login.code} autoComplete="one-time-code" autoCapitalize="characters" spellCheck={false} inputMode={login.format.alphanumeric ? "text" : "numeric"} maxLength={login.format.length} disabled={login.busy} onChange={(e) => login.setCode(normalizeOTP(e.target.value, login.format))} placeholder={login.format.alphanumeric ? "AB12CD34" : "000000"} />}
    <Button type="button" disabled={login.busy || (login.challenge ? !validOTP(login.code, login.format) : !login.provider)} onClick={() => void (login.challenge ? login.verify() : login.beginFactor())}>{t("login.continue", "Continue")}</Button>
  </Flex>;
}
