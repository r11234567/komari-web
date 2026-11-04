import { useEffect, useId, useState, useSyncExternalStore, type ReactNode } from "react";
import { Button, Card, Code, Flex, Heading, Text, TextField, Theme } from "@radix-ui/themes";
import { trackWorkspaceActivity, unlockWorkspace, workspaceState } from "@/api/connect/workspace";
import TrustedCredentialVerification from "@/components/TrustedCredentialVerification";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { CredentialPurpose } from "@komari/proto/komari/credential/v1/credential_pb";
import { workspaceCredentialResource } from "@/api/connect/trustedCredential";
import { useTranslation } from "react-i18next";

function UnlockDialog({ agentId, appearance }: { agentId: string; appearance?: "light" | "dark" }) {
  const { t } = useTranslation();
  const [username, setUsername] = useState(() => {
    try { return localStorage.getItem(`workspace-user:${agentId}`) ?? ""; } catch { return ""; }
  });
  const [targetUser, setTargetUser] = useState("");
  const usernameId = useId();
  return <Dialog.Root open onOpenChange={(open) => { if (!open) workspaceState.cancel(agentId); }}>
    <Dialog.Portal>
      <Theme asChild appearance={appearance} hasBackground={false}>
        <Dialog.Overlay className="km-workspace-unlock-overlay" style={{
          position: "fixed", inset: 0, zIndex: 200020, display: "grid", placeItems: "center",
          padding: "16px", background: "rgba(0,0,0,.65)", overflowY: "auto",
        }}>
          <Dialog.Content className="km-workspace-unlock" style={{ width: "100%", maxWidth: "25rem", maxHeight: "calc(100dvh - 32px)", overflowY: "auto", outline: "none" }}
            onEscapeKeyDown={(event) => event.stopPropagation()}
            onInteractOutside={(event) => event.preventDefault()}>
            <Card size="2" style={{ background: appearance === "dark" ? "#252526" : "var(--color-panel-solid)", border: "1px solid var(--gray-6)", borderRadius: 8 }}>
              <Flex direction="column" gap="3">
                <Flex align="start" justify="between" gap="3">
                  <Dialog.Title asChild><Heading size="3">{t("terminal.workspace_unlock_title")}</Heading></Dialog.Title>
                  <Dialog.Close asChild><Button type="button" variant="ghost" color="gray" aria-label={t("terminal.workspace_cancel_unlock")}><X size={18} /></Button></Dialog.Close>
                </Flex>
                <Dialog.Description asChild><Text as="p" size="2" color="gray">
                  {t("terminal.workspace_unlock_description")}
                </Text></Dialog.Description>
                <Flex direction="column" gap="3">
                  <Text as="p" size="1" color="gray">{t("terminal.workspace_target")} · <Code size="1" variant="ghost" style={{ overflowWrap: "anywhere" }}>{agentId}</Code></Text>
                  <Flex direction="column" gap="2">
                    <Text as="label" htmlFor={usernameId} size="2" weight="medium">{t("terminal.workspace_system_user")}</Text>
                    <TextField.Root id={usernameId} autoFocus autoComplete="username" disabled={Boolean(targetUser)} value={username} onChange={(event) => setUsername(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && username.trim() && !targetUser) { event.preventDefault(); setTargetUser(username.trim()); } }} placeholder={t("terminal.workspace_user_placeholder")} />
                    <Text size="1" color="gray">{t("terminal.workspace_identity_hint")}</Text>
                  </Flex>
                  {targetUser ? <TrustedCredentialVerification purpose={CredentialPurpose.UNLOCK_WORKSPACE} resource={workspaceCredentialResource(agentId, targetUser)} onAuthorized={async (token, signal) => {
                    await unlockWorkspace(agentId, targetUser, token, signal);
                    try { localStorage.setItem(`workspace-user:${agentId}`, targetUser); } catch { /* Optional account preference. */ }
                  }} /> : <Button type="button" disabled={!username.trim()} onClick={() => setTargetUser(username.trim())}>{t("terminal.workspace_verify_unlock")}</Button>}
                  <Flex justify="end" gap="3" wrap="wrap">
                    {targetUser && <Button type="button" variant="soft" color="gray" onClick={() => setTargetUser("")}>{t("terminal.workspace_change_user")}</Button>}
                    <Button type="button" variant="soft" color="gray" onClick={() => workspaceState.cancel(agentId)}>{t("common.cancel")}</Button>
                  </Flex>
                </Flex>
              </Flex>
            </Card>
          </Dialog.Content>
        </Dialog.Overlay>
      </Theme>
    </Dialog.Portal>
  </Dialog.Root>;
}

export default function WorkspaceBoundary({ children, appearance }: { children: ReactNode; appearance?: "light" | "dark" }) {
  useSyncExternalStore(workspaceState.subscribe, () => workspaceState.version, () => 0);
  useEffect(trackWorkspaceActivity, []);
  const pending = workspaceState.promptAgent;
  return <>
    {children}
    {pending && workspaceState.pending.has(pending) && <UnlockDialog key={pending} agentId={pending} appearance={appearance} />}
  </>;
}
