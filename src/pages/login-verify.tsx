import { Button, Card, Flex, Heading, Text } from "@radix-ui/themes";
import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import PasswordCredentialStep from "@/components/PasswordCredentialStep";
import { useNativePasswordLogin } from "@/hooks/useNativePasswordLogin";
import { usePublicInfo } from "@/contexts/PublicInfoContext";
import { safeLoginReturnTo } from "@/utils/loginRedirect";

// A separate document for legacy theme password handoffs. This page never
// mounts LoginForm/AccountProvider or interprets browser storage as authority.
export default function LoginVerificationPage() {
  const { t } = useTranslation();
  const { publicInfo } = usePublicInfo();
  const location = useLocation();
  const returnTo = safeLoginReturnTo(new URLSearchParams(location.search).get("returnTo"));
  const login = useNativePasswordLogin(() => {
    const destination = new URL(returnTo, window.location.origin);
    if (destination.origin === window.location.origin) {
      window.location.replace(destination.href);
    } else {
      window.location.replace("/admin/dashboard");
    }
  }, "verify");

  return <Flex align="center" justify="center" p="4" style={{ minHeight: "100vh" }}>
    <Card className="km-login-verification" size="3" style={{ width: "100%", maxWidth: "26rem" }}>
      <Flex direction="column" gap="4">
        <Heading size="5">{publicInfo?.sitename || "Komari"}</Heading>
        <PasswordCredentialStep login={login} />
        {login.error && <Text color="red" role="alert">{login.error}</Text>}
        <Button variant="ghost" disabled={login.busy} onClick={async () => {
          if (await login.reset()) window.location.replace(`/login?returnTo=${encodeURIComponent(returnTo)}`);
        }}>{t("login.restart", "Restart login")}</Button>
      </Flex>
    </Card>
  </Flex>;
}
