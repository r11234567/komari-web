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
import { useNativePasswordLogin } from "@/hooks/useNativePasswordLogin";
import PasswordCredentialStep from "@/components/PasswordCredentialStep";
import {
  clearConsolePasskeyIntent,
  consumeConsolePasskeyIntent,
  markConsolePasskeyIntent,
} from "@/utils/consolePasskeyIntent";

type LoginDialogProps = {
  trigger?: React.ReactNode | string;
  autoOpen?: boolean;
  showSettings?: boolean;
  info?: string | React.ReactNode;
  onLoginSuccess?: () => void;
};

type LoginFormProps = {
  onLoginSuccess?: () => void;
  oauthReturnTo?: string;
  passwordMode?: "inline" | "handoff" | "resume";
  onPasswordLoginStart?: () => void;
  onOAuthLoginStart?: () => void;
  onPasskeyLoginStart?: () => void;
};

function oauthLoginURL(returnTo: string = "/admin/dashboard"): string {
  return `/api/oauth?returnTo=${encodeURIComponent(returnTo)}`;
}

export const LoginForm = ({
  onLoginSuccess,
  oauthReturnTo,
  passwordMode = "inline",
  onPasswordLoginStart,
  onOAuthLoginStart,
  onPasskeyLoginStart,
}: LoginFormProps) => {
  const { refresh } = useAccount();
  const { publicInfo } = usePublicInfo();
  const [t] = useTranslation();
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [errorMsg, setErrorMsg] = React.useState("");
  const login = useNativePasswordLogin(async () => {
    await refresh();
    if (onLoginSuccess) onLoginSuccess();
    else window.location.assign("/admin/dashboard");
  }, passwordMode);
  const isLoading = login.busy;
  const fieldId = React.useId().replace(/:/g, "");
  const passwordLoginEnabled = !publicInfo?.disable_password_login;
  const isFormValid =
    passwordLoginEnabled && username.trim() !== "" && password.trim() !== "";

  const handleLogin = async () => {
    if (!isFormValid) {
      setErrorMsg("Username and password are required");
      return;
    }

    onPasswordLoginStart?.();
    setErrorMsg("");
    if (await login.start(username, password)) setPassword("");
  };

  return (
    <form
      className={`km-login-form${login.pending ? " km-password-factor-pending" : ""}`}
      onClickCapture={(event) => {
        const target = event.target;
        if (target instanceof Element && target.closest(".km-passkey-login")) {
          if (login.pending) { event.preventDefault(); event.stopPropagation(); return; }
          onPasskeyLoginStart?.();
        }
      }}
      onSubmit={(event) => {
        event.preventDefault();
        if (!isLoading) {
          if (login.pending) void (login.challenge ? login.verify() : login.beginFactor());
          else if (isFormValid) void handleLogin();
        }
      }}
    >
      <Flex direction="column" gap="3">
        {passwordLoginEnabled && (
          <>
            <label hidden={login.pending}>
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
            <label hidden={login.pending}>
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
            {login.pending && <PasswordCredentialStep login={login} />}
            {login.pending && login.error && <Button type="button" variant="soft" disabled={isLoading} onClick={() => void login.reset()}>{t("login.restart", "重新登录")}</Button>}
            {(errorMsg || login.error) && (
              <Text
                as="div"
                size="2"
                color="red"
                className="km-login-error"
              >
                {errorMsg || login.error}
              </Text>
            )}
            {!login.pending && <Button
              type="submit"
              disabled={isLoading || !isFormValid}
              style={{ opacity: isLoading || !isFormValid ? 0.6 : 1 }}
            >
              {isLoading ? t("loading") : t("login.continue", "Continue")}
            </Button>}
          </>
        )}
        {!login.pending && publicInfo?.oauth_enable && (
          <Button
            onClick={() => {
              onOAuthLoginStart?.();
              window.location.href = oauthLoginURL(oauthReturnTo);
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

  const finishLogin = React.useCallback(() => {
    clearConsolePasskeyIntent();
    setOpen(false);
    if (onLoginSuccess) {
      onLoginSuccess();
    } else {
      window.location.assign("/admin/dashboard");
    }
  }, [onLoginSuccess]);

  React.useEffect(() => {
    if (loading || error || account?.logged_in !== true) return;
    // The plugin reloads after login. LoginForm is no longer mounted at that
    // point, so the dialog must restore this page's pending navigation itself.
    if (consumeConsolePasskeyIntent(window.location.pathname + window.location.search)) {
      finishLogin();
    }
  }, [account?.logged_in, loading, error, finishLogin]);

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
      <a href="/admin/dashboard">
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
      clearConsolePasskeyIntent();
      window.location.href = oauthLoginURL();
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
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) clearConsolePasskeyIntent();
      }}
    >
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
          passwordMode="handoff"
          onPasskeyLoginStart={() => {
            markConsolePasskeyIntent(window.location.pathname + window.location.search);
          }}
          onOAuthLoginStart={() => clearConsolePasskeyIntent()}
          onPasswordLoginStart={() => clearConsolePasskeyIntent()}
          onLoginSuccess={finishLogin}
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
