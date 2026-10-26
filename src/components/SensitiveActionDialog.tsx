import { useEffect, useState } from "react";
import { Button, Dialog, Text } from "@radix-ui/themes";
import { useTranslation } from "react-i18next";
import { CredentialPurpose } from "@komari/proto/komari/credential/v1/credential_pb";
import TrustedCredentialVerification from "@/components/TrustedCredentialVerification";
import { credentialActionResource } from "@/utils/credentialAction";

export type SensitiveAction = {
  action: string;
  targets: string[];
  title: string;
  execute: (authorizationToken: string, signal: AbortSignal) => Promise<void>;
};

// Mount inside the action's owning screen/dialog so existing modal focus and
// cancellation stay local. The request captures the reviewed target at click.
export default function SensitiveActionDialog({ request, onClose }: { request: SensitiveAction | null; onClose: () => void }) {
  const { t } = useTranslation();
  const [scope, setScope] = useState<{ request: SensitiveAction; resource: string }>();
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true; setScope(undefined); setError("");
    if (request) void credentialActionResource(request.action, request.targets).then((resource) => {
      if (active) setScope({ request, resource });
    }).catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "Unable to prepare verification"); });
    return () => { active = false; };
  }, [request]);
  return <Dialog.Root open={Boolean(request)} onOpenChange={(open) => { if (!open) onClose(); }}>
    <Dialog.Content maxWidth="440px">
      <Dialog.Title>{request?.title ?? t("login.two_factor")}</Dialog.Title>
      <Dialog.Description>{t("login.two_factor")}</Dialog.Description>
      {error && <Text role="alert" color="red">{error}</Text>}
      {scope && scope.request === request && <TrustedCredentialVerification key={scope.resource} purpose={CredentialPurpose.SENSITIVE_OPERATION} resource={scope.resource} onAuthorized={async (token, signal) => {
        await scope.request.execute(token, signal);
        if (!signal.aborted) onClose();
      }} />}
      <Button type="button" variant="soft" className="mt-3" onClick={onClose}>{t("common.cancel")}</Button>
    </Dialog.Content>
  </Dialog.Root>;
}
