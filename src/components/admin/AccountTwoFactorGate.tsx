import { Button, Card, Flex, Heading } from "@radix-ui/themes";
import { ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { CredentialPurpose } from "@komari/proto/komari/credential/v1/credential_pb";
import TrustedCredentialVerification from "@/components/TrustedCredentialVerification";
import { credentialHeader } from "@/api/connect/trustedCredential";

export default function AccountTwoFactorGate({ onVerified, endpoint = "/api/admin/2fa/verify" }: {
  onVerified: () => void | Promise<void>;
  endpoint?: "/api/admin/2fa/verify" | "/api/admin/2fa/sign-on";
}) {
  const { t } = useTranslation();
  const signOn = endpoint === "/api/admin/2fa/sign-on";
  return <Flex direction="column" align="center" justify="center" className="km-account-2fa-gate w-full min-h-[60vh] p-4">
    <Card size="3" style={{ width: "100%", maxWidth: "28rem" }}>
      <Flex direction="column" gap="4">
        <Flex align="center" gap="3"><ShieldCheck className="size-5" /><Heading size="5">{t("login.two_factor")}</Heading></Flex>
        <TrustedCredentialVerification purpose={signOn ? CredentialPurpose.LOGIN_SETTINGS : CredentialPurpose.SENSITIVE_OPERATION} resource={signOn ? "login-settings:unlock" : "account:entry"} onAuthorized={async (token, signal) => {
          const response = await fetch(endpoint, { method: "POST", credentials: "same-origin", signal, headers: { [credentialHeader]: token } });
          if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.message || "Verification failed"); }
          await onVerified();
        }} />
        <Button type="button" variant="soft" onClick={() => window.history.back()}>{t("common.cancel")}</Button>
      </Flex>
    </Card>
  </Flex>;
}
