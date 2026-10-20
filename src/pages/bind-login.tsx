import * as React from "react";
import { Button, Callout, Card, Flex, Heading, Text } from "@radix-ui/themes";
import { Navigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import Loading from "@/components/loading";
import { LoginForm } from "@/components/Login";
import { AccountProvider, useAccount } from "@/contexts/AccountContext";
import { usePublicInfo } from "@/contexts/PublicInfoContext";
import { safeBindReturnTo } from "@/utils/loginRedirect";
import { getStoredBindTicket, setStoredBindTicket } from "@/utils/bindTicket";

type TicketResponse = {
  status?: string;
  message?: string;
  data?: {
    ticket?: string;
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
  const requestedRef = React.useRef(false);
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
        !payload.data?.ticket
      ) {
        throw new Error(payload.message || "Failed to create bind authorization");
      }
      if (!setStoredBindTicket(payload.data.ticket, payload.data.expires_in ?? 120)) {
        throw new Error("Browser storage is unavailable; bind authorization was not saved");
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
      !getStoredBindTicket() &&
      !requestedRef.current
    ) {
      requestedRef.current = true;
      void issueTicket();
    }
  }, [account?.logged_in, issueTicket, loading]);

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

          {account?.logged_in ? (
            <Flex direction="column" gap="3">
              <Text size="2">
                {issuing ? t("loading") : t("login.bind_ticket_required", "需要重新获取绑定授权")}
              </Text>
              {ticketError && (
                <Callout.Root color="red" size="1">
                  <Callout.Text>{ticketError}</Callout.Text>
                </Callout.Root>
              )}
              <Button
                onClick={() => void issueTicket()}
                disabled={issuing}
              >
                {issuing ? t("loading") : t("login.bind_retry", "重新获取授权")}
              </Button>
            </Flex>
          ) : (
            <LoginForm
              oauthReturnTo={currentLocation}
              suppressPasskeyRedirect
              onLoginSuccess={() => void issueTicket()}
            />
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
