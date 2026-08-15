import * as React from "react";
import {
  Button,
  Dialog,
  Flex,
  IconButton,
  Text,
  TextField,
} from "@radix-ui/themes";
import { useTranslation } from "react-i18next";
import { TablerSettings } from "./Icones/Tabler";
import { AccountProvider, useAccount } from "@/contexts/AccountContext";
import { usePublicInfo } from "@/contexts/PublicInfoContext";

type LoginDialogProps = {
  trigger?: React.ReactNode | string;
  autoOpen?: boolean;
  showSettings?: boolean;
  info?: string | React.ReactNode;
  onLoginSuccess?: () => void;
};

type LoginFormProps = {
  onLoginSuccess?: () => void;
};

export const LoginForm = ({ onLoginSuccess }: LoginFormProps) => {
  const { account, refresh } = useAccount();
  const { publicInfo } = usePublicInfo();
  const [t] = useTranslation();
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [twoFac, setTwoFac] = React.useState("");
  const [errorMsg, setErrorMsg] = React.useState("");
  const [isLoading, setIsLoading] = React.useState(false);
  const [require2FA, setRequire2FA] = React.useState(false);
  const fieldId = React.useId().replace(/:/g, "");
  const passwordLoginEnabled = !publicInfo?.disable_password_login;
  const isFormValid =
    passwordLoginEnabled && username.trim() !== "" && password.trim() !== "";

  const handleLogin = async () => {
    if (!isFormValid) {
      setErrorMsg("Username and password are required");
      return;
    }

    setErrorMsg("");
    setIsLoading(true);
    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          password,
          ...(twoFac && !account?.["2fa_enabled"]
            ? { "2fa_code": twoFac }
            : {}),
        }),
      });
      const data = (await response.json()) as { message?: string };
      if (response.ok) {
        await refresh();
        if (onLoginSuccess) {
          onLoginSuccess();
        } else {
          window.location.assign("/admin/dashboard");
        }
        return;
      }
      if (data.message === "2FA code is required") {
        setRequire2FA(true);
        return;
      }
      setErrorMsg(data.message || "Login failed");
    } catch (error) {
      setErrorMsg("Network error");
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form
      className="km-login-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (isFormValid && !isLoading) {
          void handleLogin();
        }
      }}
    >
      <Flex direction="column" gap="3">
        {passwordLoginEnabled && (
          <>
            <label>
              <Text as="div" size="2" mb="1" weight="bold">
                {t("login.username")}
              </Text>
              <TextField.Root
                className="km-login-input"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                id={`login-username-${fieldId}`}
                name="username"
                autoComplete="username"
                placeholder="admin"
                disabled={isLoading}
                autoFocus
              />
            </label>
            <label>
              <Text as="div" size="2" mb="1" weight="bold">
                {t("login.password")}
              </Text>
              <TextField.Root
                className="km-login-input"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                id={`login-password-${fieldId}`}
                name="password"
                type="password"
                autoComplete="current-password"
                placeholder={t("login.password_placeholder")}
                disabled={isLoading}
              />
            </label>
            <label hidden={!require2FA}>
              <Text as="div" size="2" mb="1" weight="bold">
                {t("login.two_factor")}
              </Text>
              <TextField.Root
                className="km-login-input"
                value={twoFac}
                onChange={(event) => setTwoFac(event.target.value)}
                id={`login-2fa-code-${fieldId}`}
                name="2fa_code"
                type="text"
                autoComplete="one-time-code"
                inputMode="numeric"
                placeholder="000000"
                disabled={isLoading}
              />
            </label>
            {errorMsg && (
              <Text
                as="div"
                size="2"
                color="red"
                className="km-login-error"
              >
                {errorMsg}
              </Text>
            )}
            <Button
              type="submit"
              disabled={isLoading || !isFormValid}
              style={{ opacity: isLoading || !isFormValid ? 0.6 : 1 }}
            >
              {isLoading ? "Logging in..." : t("login.title")}
            </Button>
          </>
        )}
        {publicInfo?.oauth_enable && (
          <Button
            onClick={() => {
              window.location.href = "/api/oauth";
            }}
            variant={passwordLoginEnabled ? "soft" : "solid"}
            disabled={isLoading}
            type="button"
          >
            {t("login.login_with", {
              provider:
                publicInfo.oauth_provider === "generic"
                  ? "OAuth"
                  : publicInfo.oauth_provider
                    ? publicInfo.oauth_provider.charAt(0).toUpperCase() +
                      publicInfo.oauth_provider.slice(1)
                    : "",
            })}
          </Button>
        )}
      </Flex>
    </form>
  );
};

const LoginDialogContent = ({
  trigger,
  autoOpen = false,
  showSettings = true,
  info,
  onLoginSuccess,
}: LoginDialogProps) => {
  const { account, loading, error } = useAccount();
  const { publicInfo } = usePublicInfo();
  const [t] = useTranslation();
  const [open, setOpen] = React.useState(autoOpen);
  const passwordLoginEnabled = !publicInfo?.disable_password_login;
  const onlyOAuthLogin = !!publicInfo?.oauth_enable && !passwordLoginEnabled;

  React.useEffect(() => {
    if (autoOpen) {
      setOpen(true);
    }
  }, [autoOpen]);

  if (loading) {
    return <Button disabled>{t("loading")}</Button>;
  }
  if (error || !account) {
    return (
      <Button disabled color="red">
        Error
      </Button>
    );
  }
  if (account.logged_in) {
    if (!showSettings) {
      return null;
    }
    return (
      <a href="/admin/dashboard" target="_blank">
        <IconButton
          title={t("settings.title", "Settings")}
          aria-label={t("settings.title", "Settings")}
        >
          <TablerSettings />
        </IconButton>
      </a>
    );
  }

  if (onlyOAuthLogin && !autoOpen) {
    const redirect = () => {
      window.location.href = "/api/oauth";
    };
    if (typeof trigger === "string") {
      return <Button onClick={redirect}>{trigger}</Button>;
    }
    if (trigger) {
      return (
        <span
          onClick={redirect}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") redirect();
          }}
          role="button"
          tabIndex={0}
          style={{ cursor: "pointer", display: "inline-flex" }}
        >
          {trigger}
        </span>
      );
    }
    return <Button onClick={redirect}>{t("login.title")}</Button>;
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger>
        {trigger ? trigger : <Button>{t("login.title")}</Button>}
      </Dialog.Trigger>
      <Dialog.Content maxWidth="450px" className="km-login-dialog">
        <Dialog.Title>{t("login.title")}</Dialog.Title>
        <Dialog.Description size="2" mb="4">
          <Flex direction="column" gap="2">
            <Text>{t("login.desc")}</Text>
            {info && <Text>{info}</Text>}
          </Flex>
        </Dialog.Description>
        <LoginForm
          onLoginSuccess={() => {
            setOpen(false);
            if (onLoginSuccess) {
              onLoginSuccess();
            } else {
              window.location.assign("/admin/dashboard");
            }
          }}
        />
      </Dialog.Content>
    </Dialog.Root>
  );
};

const LoginDialog = (props: LoginDialogProps) => (
  <AccountProvider>
    <LoginDialogContent {...props} />
  </AccountProvider>
);

export default LoginDialog;
