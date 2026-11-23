import React from "react";

import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { AccountProvider, useAccount } from "@/contexts/AccountContext";
import {
  Badge,
  Button,
  Dialog,
  Flex,
  Skeleton,
  TextField,
} from "@radix-ui/themes";
import { Github, Globe, User } from "lucide-react";
import AccountTwoFactorGate from "@/components/admin/AccountTwoFactorGate";
import Loading from "@/components/loading";
import TrustedCredentialVerification from "@/components/TrustedCredentialVerification";
import SensitiveActionDialog, { type SensitiveAction } from "@/components/SensitiveActionDialog";
import { CredentialPurpose } from "@komari/proto/komari/credential/v1/credential_pb";
import { credentialHeader } from "@/api/connect/trustedCredential";
import { restCredentialResource } from "@/utils/credentialAction";
import { buildEnableTwoFactorRequest } from "@/utils/accountTwoFactor";
import NativePasskeys from "@/components/admin/NativePasskeys";
import NativeCredentialContacts from "@/components/admin/NativeCredentialContacts";

const Account = () => {
  return (
    <AccountProvider>
      <InnerLayout />
    </AccountProvider>
  );
};

const InnerLayout = () => {
  const { t } = useTranslation();
  const { account, loading, error, refresh } = useAccount();
  const [usernameSaving, setUsernameSaving] = React.useState(false);
  const [passwordSaving, setPasswordSaving] = React.useState(false);
  const [passwordDraft, setPasswordDraft] = React.useState<{ password: string } | null>(null);
  const [sensitiveAction, setSensitiveAction] = React.useState<SensitiveAction | null>(null);
  const [twoFaVerified, setTwoFaVerified] = React.useState(false);
  if (loading) {
    return <Loading />;
  }
  if (error) {
    return <div>{error.message}</div>;
  }
  if ((account?.trusted_2fa_enabled ?? account?.["2fa_enabled"]) && !twoFaVerified) {
    return (
      <AccountTwoFactorGate
        onVerified={() => {
          setTwoFaVerified(true);
        }}
      />
    );
  }

  function handleSubmitUsernameChange(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextUsername = ((event.currentTarget as HTMLFormElement).username.value as string).trim();
    if (!account?.uuid || !nextUsername) return;
    setSensitiveAction({
      action: "account:update_username",
      targets: [account.uuid],
      resource: restCredentialResource("POST", "/api/admin/update/user"),
      title: t("account.change_username_title"),
      execute: async (token, signal) => {
        setUsernameSaving(true);
        try {
          const response = await fetch("/api/admin/update/user", {
            method: "POST",
            credentials: "same-origin",
            signal,
            headers: {
              "Content-Type": "application/json",
              [credentialHeader]: token,
            },
            body: JSON.stringify({
              uuid: account.uuid,
              username: nextUsername,
            }),
          });
          if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.message || "Failed to update username");
          }
          toast.success(t("common.updated_successfully"));
          refresh();
        } finally {
          setUsernameSaving(false);
        }
      },
    });
  }
  function changePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const password = form.password.value;
    const password_repeat = form.password_repeat.value;
    if (!password || !password_repeat) {
      toast.error(t("account.password_empty_error"));
      return;
    }
    if (password !== password_repeat) {
      toast.error(t("account.password_mismatch_error"));
      return;
    }
    if (password.length < 8) {
      toast.error(t("account.password_too_short_error"));
      return;
    }
    if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(password)) {
      toast.error(t("account.password_strength_error"));
      return;
    }
    setPasswordDraft({ password });
    form.reset();
  }
  async function savePassword(token: string, signal: AbortSignal) {
    if (!passwordDraft || !account) return;
    setPasswordSaving(true);
    try {
      const response = await fetch("/api/admin/update/user", {
        method: "POST", credentials: "same-origin", signal,
        headers: { "Content-Type": "application/json", [credentialHeader]: token },
        body: JSON.stringify({ uuid: account.uuid, password: passwordDraft.password }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || "Failed to update password");
      }
      setPasswordDraft(null);
      toast.success(t("common.updated_successfully"));
      setTimeout(() => { window.location.href = "/"; }, 2000);
    } finally { setPasswordSaving(false); }
  }
  
  // SSO 辅助函数
  function getSSOInfo() {
    if (!account?.sso_id) return null;
    
    const [platform, uniqueId] = account.sso_id.split('_', 2);
    return {
      platform: platform || '',
      uniqueId: uniqueId || '',
      isBound: !!account.sso_id
    };
  }
  
  function getSSOIcon(platform: string) {
    switch (platform.toLowerCase()) {
      case 'github':
        return <Github className="size-5" />;
      case 'google':
        return <Globe className="size-5" />;
      default:
        return <User className="size-5" />;
    }
  }
  
  function getSSODisplayName(platform: string) {
    switch (platform.toLowerCase()) {
      case 'github':
        return 'GitHub';
      case 'google':
        return 'Google';
      case 'gitlab':
        return 'GitLab';
      case 'discord':
        return 'Discord';
      default:
        return platform.charAt(0).toUpperCase() + platform.slice(1);
    }
  }
  
  const handleSSOAuth = () => {
    const ssoInfo = getSSOInfo();
    if (ssoInfo?.isBound) {
      setSensitiveAction({
        action: "account:unbind_sso",
        targets: [account?.uuid ?? ""],
        resource: restCredentialResource("POST", "/api/admin/oauth2/unbind"),
        title: t("account_settings.confirm_unbind"),
        execute: async (token, signal) => {
          const response = await fetch("/api/admin/oauth2/unbind", {
            method: "POST",
            credentials: "same-origin",
            signal,
            headers: { [credentialHeader]: token },
          });
          if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(
              t("account_settings.unbind_sso_failed", {
                provider: getSSODisplayName(ssoInfo.platform),
                error: error.message || t("common.unknownError"),
              }),
            );
          }
          toast.success(t("account_settings.unbind_sso_success", { provider: getSSODisplayName(ssoInfo.platform) }));
          refresh();
        },
      });
      return;
    }
    setSensitiveAction({
      action: "account:bind_sso",
      targets: [account?.uuid ?? ""],
      resource: restCredentialResource("POST", "/api/admin/oauth2/bind"),
      title: t("account_settings.bind_sso"),
      execute: async (token, signal) => {
        const response = await fetch("/api/admin/oauth2/bind", {
          method: "POST",
          credentials: "same-origin",
          signal,
          headers: { [credentialHeader]: token },
        });
        if (!response.ok) {
          const error = await response.json().catch(() => ({}));
          throw new Error(error.message || t("account_settings.sso_auth_failed"));
        }
        const payload = await response.json().catch(() => ({}));
        const redirectUrl = typeof payload?.data?.redirect_url === "string" ? payload.data.redirect_url : "/api/oauth";
        window.location.assign(redirectUrl);
      },
    });
  };
  return (
    <Flex gap="4" direction="column" align="start">
      <Flex gap="4" direction="row" className="km-page-admin-account p-4" wrap="wrap">
        <Flex gap="2" direction="column" className="w-full">
          <label className="text-2xl font-bold">{t("account.title")}</label>
          <label className="text-lg">
            {t("account.greeting", { username: account?.username })}
          </label>
          <form
            className="km-account-profile-form flex gap-2 flex-col"
            onSubmit={handleSubmitUsernameChange}
          >
            <label className="font-bold" htmlFor="username">
              {t("account.change_username_title")}
            </label>

            <TextField.Root
              className="max-w-128"
              id="username"
              name="username"
              defaultValue={account?.username}
            ></TextField.Root>
            <div>
              <Button disabled={usernameSaving} type="submit">
                {t("account.change_username_button")}
              </Button>
            </div>
          </form>
          <form onSubmit={changePassword} className="km-account-password-form flex flex-col gap-2">
            <label className="font-bold" htmlFor="old_password">
              {t("account.change_password_title")}
            </label>
            <label htmlFor="password">{t("account.new_password")}</label>
            <TextField.Root
              className="max-w-128"
              id="password"
              name="password"
              type="password"
            ></TextField.Root>
            <label htmlFor="password_repeat">
              {t("account.new_password_repeat")}
            </label>
            <TextField.Root
              className="max-w-128"
              id="password_repeat"
              name="password_repeat"
              type="password"
            ></TextField.Root>
            <div>
              <Button disabled={passwordSaving} type="submit">
                {t("account.change_password_button")}
              </Button>
            </div>
          </form>
          <Dialog.Root open={Boolean(passwordDraft)} onOpenChange={(open) => { if (!open && !passwordSaving) setPasswordDraft(null); }}>
            <Dialog.Content>
              <Dialog.Title>{t("account.change_password_button")}</Dialog.Title>
              <Dialog.Description>{t("login.two_factor")}</Dialog.Description>
              <TrustedCredentialVerification purpose={CredentialPurpose.SENSITIVE_OPERATION} resource={`account:password:${account?.uuid ?? ""}`} onAuthorized={savePassword} />
              <Button type="button" variant="soft" disabled={passwordSaving} onClick={() => setPasswordDraft(null)}>{t("common.cancel")}</Button>
            </Dialog.Content>
          </Dialog.Root>
        </Flex>
        <NativePasskeys key={account?.uuid} />
        <NativeCredentialContacts />
        <Flex direction="column" className="km-account-2fa gap-2">
          <label className="font-bold text-2xl">2FA</label>
          {account?.["2fa_enabled"] ? (
            <TwoFactorEnabled />
          ) : (
            <TwoFactorDisabled
              accountUuid={account?.uuid}
              requiresStepUp={Boolean(account?.trusted_2fa_enabled)}
              onRequestSensitiveAction={setSensitiveAction}
              onEnabled={() => setTwoFaVerified(true)}
            />
          )}
          <label className="font-bold text-2xl mt-2">
            {t("settings.sso.title")}
          </label>

          {/* SSO账户绑定/解绑 */}
          <div className="km-account-sso mb-8 flex flex-col gap-4 ">
            {(() => {
              const ssoInfo = getSSOInfo();
              const platform = ssoInfo?.platform || '';
              const displayName = getSSODisplayName(platform);
              const icon = getSSOIcon(platform);
              
              return (
                <>
                  <label className="text-xl font-semibold flex items-center gap-2">
                    {ssoInfo?.isBound ? icon : <User className="size-5" />}
                    {ssoInfo?.isBound ? t("account_settings.sso_account_bound", { name: displayName }) : t("account_settings.sso_account")}
                  </label>
                  <div className="p-4 bg-[var(--accent-2)] rounded-lg">
                    <p>
                      {ssoInfo?.isBound ? (
                        <div className="flex items-center gap-2">
                          <Badge color="green">
                            {t("account_settings.sso_bound")}
                          </Badge>
                          {displayName} ID: {ssoInfo.uniqueId}
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <Badge color="gray">
                            {t("account_settings.sso_not_bound")}
                          </Badge>
                          {t("account_settings.sso_not_bound")}
                        </div>
                      )}
                    </p>
                  </div>
                  <div>
                    {ssoInfo?.isBound ? (
                      <Dialog.Root>
                        <Dialog.Trigger>
                          <Button>{t("account_settings.unbind_sso", { provider: displayName })}</Button>
                        </Dialog.Trigger>
                        <Dialog.Content>
                          <Dialog.Title>
                            {t("account_settings.confirm_unbind")}
                          </Dialog.Title>
                          <Dialog.Description>
                            {t("account_settings.unbind_sso_warning", { provider: displayName })}
                          </Dialog.Description>
                          <Flex gap="2" justify="end" className="mt-4">
                            <Dialog.Close>
                              <Button variant="soft">
                                {t("common.cancel")}
                              </Button>
                            </Dialog.Close>
                            <Button color="red" onClick={handleSSOAuth}>
                              {t("account_settings.confirm_unbind")}
                            </Button>
                          </Flex>
                        </Dialog.Content>
                      </Dialog.Root>
                    ) : (
                      <Button onClick={handleSSOAuth}>
                        <User className="size-4" />
                        {t("account_settings.bind_sso")}
                      </Button>
                    )}
                  </div>
                </>
              );
            })()}
          </div>
          <Flex gap="4" align="center" justify="start">
            <label className="text-muted-foreground text-sm">
              {t("account_settings.looking_for_backup")}
            </label>
          </Flex>
        </Flex>
      </Flex>
      <SensitiveActionDialog request={sensitiveAction} onClose={() => setSensitiveAction(null)} />
    </Flex>
  );
};
const TwoFactorDisabled = ({
  accountUuid,
  requiresStepUp = false,
  onRequestSensitiveAction,
  onEnabled,
}: {
  accountUuid?: string;
  requiresStepUp?: boolean;
  onRequestSensitiveAction?: (request: SensitiveAction) => void;
  onEnabled?: () => void;
}) => {
  const { t } = useTranslation();
  const { refresh } = useAccount();
  const [saving, setSaving] = React.useState(false);
  const [isOpen, setIsOpen] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(true);
  const [qrcode, setQRCode] = React.useState<string | null>(null);
  const [code, setCode] = React.useState<string>("");

  React.useEffect(() => {
    if (!isOpen) {
      return;
    }
    let active = true;
    let createdUrl: string | null = null;
    setIsLoading(true);
    fetch("/api/admin/2fa/generate", {
      method: "POST",
      credentials: "same-origin",
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(t("account.qr_fetch_error"));
        }
        return response.blob();
      })
      .then((blob) => {
        createdUrl = URL.createObjectURL(blob);
        if (active) {
          setQRCode(createdUrl);
        } else {
          URL.revokeObjectURL(createdUrl);
        }
      })
      .catch((err) => {
        if (active) {
          toast.error(err.message);
        }
      })
      .finally(() => {
        if (active) {
          setIsLoading(false);
        }
      });
    return () => {
      active = false;
      if (createdUrl) {
        URL.revokeObjectURL(createdUrl);
      }
    };
  }, [isOpen, t]);

  const submitEnable = async (
    submittedCode: string,
    credentialToken?: string,
    signal?: AbortSignal,
  ) => {
    const { url, init } = buildEnableTwoFactorRequest(submittedCode, credentialToken, signal);
    const res = await fetch(url, init);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || `Failed to enable 2FA (${res.status})`);
    }
    await res.json().catch(() => ({}));
    toast.success(t("common.updated_successfully"));
    setIsOpen(false);
    setCode("");
    onEnabled?.();
    await refresh();
  };

  const handleEnable2fa = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedCode = code.trim();
    if (!trimmedCode) {
      toast.error(t("account.otp_empty_error"));
      return;
    }
    if (requiresStepUp && onRequestSensitiveAction) {
      setIsOpen(false);
      onRequestSensitiveAction({
        action: "account:enable_2fa",
        targets: [accountUuid ?? ""],
        resource: restCredentialResource("POST", "/api/admin/2fa/enable"),
        title: t("account.enable_2fa"),
        execute: (token, signal) => submitEnable(trimmedCode, token, signal),
      });
      return;
    }
    setSaving(true);
    void submitEnable(trimmedCode)
      .catch((err) => toast.error(err instanceof Error ? err.message : String(err)))
      .finally(() => setSaving(false));
  };

  return (
    <Flex direction="column" gap="2" className="km-account-2fa-enable">
      <label className="text-lg font-bold">{t("account.2fa_disabled")}</label>
      <Dialog.Root open={isOpen} onOpenChange={setIsOpen}>
        <Dialog.Trigger>
          <div>
            <Button className="w-full">{t("account.enable_2fa")}</Button>
          </div>
        </Dialog.Trigger>
        <Dialog.Content>
          <Dialog.Title>{t("account.enable_2fa")}</Dialog.Title>
          <Flex direction="column" gap="2">
            <label>{t("account.2fa_qr_code_hint")}</label>
            <div className="flex justify-center">
              {isLoading ? (
                <Skeleton width="200px" height="200px" />
              ) : (
                <img src={qrcode!} alt="2FA QR Code" width={200} height={200} />
              )}
            </div>
            <label>{t("account.2fa_otp_input_prompt")}</label>
            <form className="km-account-2fa-form flex flex-col gap-2" onSubmit={handleEnable2fa}>
              <TextField.Root
                type="number"
                name="code"
                placeholder="000000"
                value={code}
                onChange={(e) => setCode((e.target as HTMLInputElement).value)}
              />
              <Button disabled={saving} type="submit">
                {t("account.enable_2fa")}
              </Button>
            </form>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>
    </Flex>
  );
};

const TwoFactorEnabled = () => {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const { refresh } = useAccount();
  const disable2fa = async (token: string, signal: AbortSignal) => {
    setSaving(true);
    try {
      const response = await fetch("/api/admin/2fa/disable", {
        method: "POST", credentials: "same-origin", signal, headers: { [credentialHeader]: token },
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || "Failed to disable 2FA");
      }
      toast.success(t("common.updated_successfully")); setIsOpen(false); await refresh();
    } finally { setSaving(false); }
  };
  return (
    <Flex direction="column" gap="2" className="km-account-2fa-disable">
      <label>{t("account.2fa_enabled")}</label>
      <div>
        <Dialog.Root open={isOpen} onOpenChange={setIsOpen}>
          <Dialog.Trigger>
            <Button className="ml-2" color="red">
              {t("account.disable_2fa")}
            </Button>
          </Dialog.Trigger>
          <Dialog.Content>
            <Dialog.Title>{t("account.disable_2fa")}</Dialog.Title>
            <Dialog.Description>
              {t("account.disable_2fa_confirmation")}
            </Dialog.Description>
            <TrustedCredentialVerification purpose={CredentialPurpose.SENSITIVE_OPERATION} resource="rest:POST:/api/admin/2fa/disable" onAuthorized={disable2fa} />
            <Button variant="soft" disabled={saving} onClick={() => setIsOpen(false)}>{t("common.cancel")}</Button>
          </Dialog.Content>
        </Dialog.Root>
      </div>
    </Flex>
  );
};

export default Account;
