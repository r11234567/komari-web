import { requestAdminData } from "@/lib/adminApi";
import type { SettingsResponse } from "@/lib/api";
import { Badge, Button, Dialog, Flex, Text, TextField } from "@radix-ui/themes";
import { KeyRound, Play, RefreshCw, Square, Trash2 } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { SettingCard } from "./SettingCard";

type CloudflaredStatus = {
  installed: boolean;
  running: boolean;
  message: string;
  errorMessage?: string;
  logs?: string[];
  pid?: number;
  binaryPath?: string;
  tokenStored: boolean;
  envTokenPresent: boolean;
};

export function CloudflaredCard({ settings }: { settings: SettingsResponse }) {
  const { t } = useTranslation();
  const [status, setStatus] = React.useState<CloudflaredStatus | null>(null);
  const [token, setToken] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirmText, setConfirmText] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [stopOpen, setStopOpen] = React.useState(false);

  const refresh = React.useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const next = await requestAdminData<CloudflaredStatus>(
        "/api/admin/settings/cloudflared",
        t("settings.lts_database.cloudflared_status_error"),
      );
      setStatus(next);
    } catch (error) {
      if (!quiet) {
        toast.error(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [t]);

  React.useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(true), 5000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const runAction = async (
    path: string,
    body?: Record<string, string>,
    successKey?: string,
  ) => {
    setBusy(true);
    try {
      const next = await requestAdminData<CloudflaredStatus>(
        path,
        t("settings.lts_database.cloudflared_action_error"),
        { method: "POST", body: body ? JSON.stringify(body) : undefined },
      );
      setStatus(next);
      if (successKey) toast.success(t(successKey));
      return true;
    } catch (error) {
      toast.error(t("settings.lts_database.cloudflared_action_error"), {
        description: error instanceof Error ? error.message : String(error),
      });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const start = async () => {
    const ok = await runAction(
      "/api/admin/settings/cloudflared/start",
      token.trim() ? { token: token.trim() } : {},
      "settings.lts_database.cloudflared_started",
    );
    if (ok) setToken("");
  };

  const stop = async () => {
    const body: Record<string, string> = settings.disable_password_login
      ? { confirm_text: confirmText }
      : { current_password: password };
    const ok = await runAction(
      "/api/admin/settings/cloudflared/stop",
      body,
      "settings.lts_database.cloudflared_stopped",
    );
    if (ok) {
      setStopOpen(false);
      setPassword("");
      setConfirmText("");
    }
  };

  const removeToken = async () => {
    await runAction(
      "/api/admin/settings/cloudflared/remove-token",
      {},
      "settings.lts_database.cloudflared_token_removed",
    );
  };

  return (
    <SettingCard
      title={t("settings.lts_database.cloudflared_title")}
      description={t("settings.lts_database.cloudflared_description")}
    >
      <Flex direction="column" className="w-full pt-3" gap="3">
        <Flex align="center" gap="2" wrap="wrap">
          <Badge color={status?.running ? "green" : "gray"}>
            {status?.running
              ? t("settings.lts_database.running")
              : t("settings.lts_database.stopped")}
          </Badge>
          <Text size="2" color="gray">
            {loading ? t("loading") : status?.message}
          </Text>
          {status?.pid ? <Text size="1" color="gray">PID {status.pid}</Text> : null}
        </Flex>

        {status && !status.installed ? (
          <Text size="2" color="red">
            {t("settings.lts_database.cloudflared_not_installed")}
          </Text>
        ) : null}
        {status?.errorMessage ? <Text size="2" color="red">{status.errorMessage}</Text> : null}

        {!status?.running ? (
          <TextField.Root
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder={
              status?.tokenStored || status?.envTokenPresent
                ? t("settings.lts_database.cloudflared_saved_token")
                : t("settings.lts_database.cloudflared_token")
            }
          >
            <TextField.Slot><KeyRound size={16} /></TextField.Slot>
          </TextField.Root>
        ) : null}

        {status?.logs?.length ? (
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-[var(--gray-a3)] p-3 text-xs">
            {status.logs.slice(-20).join("\n")}
          </pre>
        ) : null}

        <Flex justify="end" gap="2" wrap="wrap">
          <Button variant="soft" disabled={loading || busy} onClick={() => void refresh()}>
            <RefreshCw size={16} className={loading ? "animate-spin" : undefined} />
            {t("common.refresh")}
          </Button>
          {!status?.running ? (
            <>
              {(status?.tokenStored || status?.envTokenPresent) && (
                <Button color="red" variant="soft" disabled={busy} onClick={() => void removeToken()}>
                  <Trash2 size={16} />
                  {t("settings.lts_database.remove_token")}
                </Button>
              )}
              <Button disabled={busy || !status?.installed} onClick={() => void start()}>
                <Play size={16} />
                {t("settings.lts_database.start")}
              </Button>
            </>
          ) : (
            <Dialog.Root open={stopOpen} onOpenChange={setStopOpen}>
              <Dialog.Trigger>
                <Button color="red" disabled={busy}>
                  <Square size={16} />
                  {t("settings.lts_database.stop")}
                </Button>
              </Dialog.Trigger>
              <Dialog.Content maxWidth="480px">
                <Dialog.Title>{t("settings.lts_database.stop_confirm_title")}</Dialog.Title>
                <Dialog.Description size="2">
                  {t("settings.lts_database.stop_confirm_description")}
                </Dialog.Description>
                <TextField.Root
                  mt="3"
                  type={settings.disable_password_login ? "text" : "password"}
                  value={settings.disable_password_login ? confirmText : password}
                  onChange={(event) =>
                    settings.disable_password_login
                      ? setConfirmText(event.target.value)
                      : setPassword(event.target.value)
                  }
                  placeholder={settings.disable_password_login ? "STOP CLOUDFLARED" : t("login.password")}
                />
                <Flex justify="end" gap="2" mt="4">
                  <Dialog.Close><Button variant="soft">{t("common.cancel")}</Button></Dialog.Close>
                  <Button color="red" disabled={busy} onClick={() => void stop()}>
                    {t("settings.lts_database.stop")}
                  </Button>
                </Flex>
              </Dialog.Content>
            </Dialog.Root>
          )}
        </Flex>
      </Flex>
    </SettingCard>
  );
}
