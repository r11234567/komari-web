import { Card, Flex, Heading, Text } from "@radix-ui/themes";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import Loading from "@/components/loading";
import { LoginForm } from "@/components/Login";
import { AccountProvider, useAccount } from "@/contexts/AccountContext";
import { usePublicInfo } from "@/contexts/PublicInfoContext";
import { safeLoginReturnTo } from "@/utils/loginRedirect";

const LoginPageContent = () => {
  const { account, loading } = useAccount();
  const { publicInfo } = usePublicInfo();
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const returnTo = safeLoginReturnTo(
    new URLSearchParams(location.search).get("returnTo"),
  );

  if (loading) {
    return <Loading />;
  }
  if (account?.logged_in) {
    return <Navigate to={returnTo} replace />;
  }

  return (
    <Flex
      align="center"
      justify="center"
      p="4"
      style={{ minHeight: "100vh" }}
    >
      <Card size="3" style={{ width: "100%", maxWidth: "26rem" }}>
        <Flex direction="column" gap="4">
          <Flex direction="column" gap="1">
            <Heading size="5">{publicInfo?.sitename || "Komari"}</Heading>
            <Text size="2" color="gray">
              {t("login.desc")}
            </Text>
          </Flex>
          <LoginForm
            onLoginSuccess={() => navigate(returnTo, { replace: true })}
          />
        </Flex>
      </Card>
    </Flex>
  );
};

const LoginPage = () => (
  <AccountProvider>
    <LoginPageContent />
  </AccountProvider>
);

export default LoginPage;
