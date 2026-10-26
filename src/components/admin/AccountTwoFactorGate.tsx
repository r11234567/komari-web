import React from "react";
import { Button, Flex, TextField } from "@radix-ui/themes";
import { ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

export default function AccountTwoFactorGate ({
  onVerified,
  endpoint = "/api/admin/2fa/verify",
}: {
  onVerified: () => void | Promise<void>;
  endpoint?: "/api/admin/2fa/verify" | "/api/admin/2fa/sign-on";
}) {
  const { t } = useTranslation();
  const [code, setCode] = React.useState("");
  const [verifying, setVerifying] = React.useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = code.trim();
    if (!trimmed) {
      toast.error(t("account.otp_empty_error"));
      return;
    }
    setVerifying(true);
    try {
      const response = await fetch(
        endpoint,
        {
          method: "POST",
          headers: {
            "X-2FA-Code": trimmed,
          },
        },
      );
      if (response.ok) {
        await onVerified();
        return;
      }
      const data = await response.json().catch(() => ({}));
      throw new Error(data.message || t("account.otp_empty_error"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "2FA verification failed");
    } finally {
      setVerifying(false);
    }
  };

  return (
    <Flex
      direction="column"
      align="center"
      justify="center"
      className="km-account-2fa-gate w-full min-h-[60vh] p-4"
    >
      <Flex
        direction="column"
        gap="4"
        className="w-full max-w-md p-6 rounded-xl border border-[var(--gray-a5)] bg-[var(--color-panel-solid)] shadow-sm"
      >
        <Flex align="center" gap="3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-[var(--accent-a3)] text-[var(--accent-11)]">
            <ShieldCheck className="size-5" />
          </div>
          <Flex direction="column">
            <label className="text-xl font-bold">
              {t("login.two_factor", "双重身份验证")}
            </label>
            <span className="text-xs text-muted-foreground">
              {t("account.title")}
            </span>
          </Flex>
        </Flex>
        <label className="text-sm text-muted-foreground">
          {t("account.2fa_otp_input_prompt")}
        </label>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <TextField.Root
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            autoFocus
            placeholder="000000"
            value={code}
            onChange={(e) => setCode((e.target as HTMLInputElement).value)}
          />
          <Flex gap="2" justify="end" className="mt-1">
            <Button
              type="button"
              variant="soft"
              onClick={() => window.history.back()}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={verifying || !code.trim()}>
              {t("common.confirm")}
            </Button>
          </Flex>
        </form>
      </Flex>
    </Flex>
  );
}
