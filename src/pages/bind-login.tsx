import { Card, Flex, Heading, Text } from "@radix-ui/themes";
import { Navigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import Loading from "@/components/loading";
import { LoginForm } from "@/components/Login";
import { AccountProvider, useAccount } from "@/contexts/AccountContext";
import { usePublicInfo } from "@/contexts/PublicInfoContext";
import { safeBindReturnTo } from "@/utils/loginRedirect";
import { getStoredBindTicket } from "@/utils/bindTicket";

const BindLoginPageContent = () => {
  const { loading } = useAccount();
  const { publicInfo } = usePublicInfo();
  const { t } = useTranslation();
  const location = useLocation();
  const returnTo = safeBindReturnTo(
    new URLSearchParams(location.search).get("returnTo"),
  );

  if (loading) {
    return <Loading />;
  }

  if (getStoredBindTicket()) {
    return <Navigate to={returnTo} replace />;
  }

  return (
    <Flex
      align="center"
      justify="center"
      p="4"
      style={{ minHeight: "100vh" }}
    >
      <Card
        className="km-login-dialog"
        size="3"
        style={{ width: "100%", maxWidth: "26rem" }}
      >
        <Flex direction="column" gap="4">
          <Flex direction="column" gap="1">
            <Heading size="5">{publicInfo?.sitename || "Komari"}</Heading>
            <Text size="2" color="gray">
              {t("login.bind_desc", "登录到授权面板")}
            </Text>
          </Flex>
          <LoginForm
            mode="bind"
            onLoginSuccess={() => {
              const destination = new URL(returnTo, window.location.origin);
              if (destination.origin === window.location.origin) {
                window.location.replace(destination.href);
              } else {
                window.location.replace("/bind");
              }
            }}
          />
        </Flex>
      </Card>
    </Flex>
  );
};

const BindLoginPage = () => (
  <AccountProvider>
    <BindLoginPageContent />
  </AccountProvider>
);

export default BindLoginPage;
