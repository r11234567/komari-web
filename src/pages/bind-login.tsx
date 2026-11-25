import * as React from "react";
import { Callout, Card, Flex, Heading, Text } from "@radix-ui/themes";
import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import Loading from "@/components/loading";
import { LoginForm } from "@/components/Login";
import { AccountProvider, useAccount } from "@/contexts/AccountContext";
import { usePublicInfo } from "@/contexts/PublicInfoContext";
import { safeBindReturnTo } from "@/utils/loginRedirect";

const BIND_LOGIN_INTENT_KEY = "komari:bind-login-intent";
const BIND_LOGIN_INTENT_MAX_AGE_MS = 120_000;

function markBindLoginIntent() {
  try {
    sessionStorage.setItem(BIND_LOGIN_INTENT_KEY, String(Date.now()));
  } catch {
    // The password path can continue without an intent marker.
  }
}

function consumeBindLoginIntent(): boolean {
  try {
    const startedAt = Number(sessionStorage.getItem(BIND_LOGIN_INTENT_KEY));
    sessionStorage.removeItem(BIND_LOGIN_INTENT_KEY);
    return (
      Number.isFinite(startedAt) &&
      Date.now() - startedAt >= 0 &&
      Date.now() - startedAt <= BIND_LOGIN_INTENT_MAX_AGE_MS
    );
  } catch {
    return false;
  }
}

type TicketResponse = {
  status?: string;
  message?: string;
  data?: {
    expires_in?: number;
  };
};

const BindLoginPageContent = () => {
  const { account, loading } = useAccount();
  const { publicInfo } = usePublicInfo();
  const { t } = useTranslation();
  const location = useLocation();
  const returnTo = safeBindReturnTo(
    new URLSearchParams(location.search).get("returnTo"),
  );
  const currentLocation = `${location.pathname}${location.search}`;

  const [issuing, setIssuing] = React.useState(false);
  const [ticketError, setTicketError] = React.useState<string | null>(null);
  const issuingRef = React.useRef(false);

  const issueTicket = React.useCallback(async () => {
    if (issuingRef.current) return;
    issuingRef.current = true;
    setIssuing(true);
    setTicketError(null);
    try {
      const response = await fetch("/api/public/bind/ticket", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const payload = (await response.json().catch(() => ({}))) as TicketResponse;
      if (
        !response.ok ||
        payload.status !== "success" ||
        !(Number(payload.data?.expires_in) > 0)
      ) {
        throw new Error(payload.message || "Failed to create bind authorization");
      }
      const destination = new URL(returnTo, window.location.origin);
      window.location.replace(
        destination.origin === window.location.origin ? destination.href : "/bind",
      );
    } catch (error) {
      setTicketError(
        error instanceof Error ? error.message : "Failed to create bind authorization",
      );
    } finally {
      issuingRef.current = false;
      setIssuing(false);
    }
  }, [returnTo]);

  React.useEffect(() => {
    if (
      !loading &&
      account?.logged_in === true &&
      consumeBindLoginIntent()
    ) {
      void issueTicket();
    }
  }, [account, issueTicket, loading]);

  if (loading) {
    return <Loading />;
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

          {issuing ? (
            <Flex direction="column" gap="3">
              <Text size="2">{t("loading")}</Text>
            </Flex>
          ) : (
            <>
              {account?.logged_in && (
                <Callout.Root color="orange" size="1">
                  <Callout.Text>
                    {t(
                      "login.bind_fresh_login_required",
                      "现有控制台会话不能续签绑定授权，请重新完成登录。",
                    )}
                  </Callout.Text>
                </Callout.Root>
              )}
              {ticketError && (
                <Callout.Root color="red" size="1">
                  <Callout.Text>{ticketError}</Callout.Text>
                </Callout.Root>
              )}
              <LoginForm
                oauthReturnTo={currentLocation}
                onOAuthLoginStart={markBindLoginIntent}
                onPasskeyLoginStart={markBindLoginIntent}
                onLoginSuccess={() => void issueTicket()}
              />
            </>
          )}
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
