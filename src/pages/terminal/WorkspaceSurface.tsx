import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { Button, Flex, Text } from "@radix-ui/themes";
import { workspaceState } from "@/api/connect/workspace";
import { useTranslation } from "react-i18next";

// A lock is local to one surface. Sibling machines remain usable and no stale
// background surface is allowed to open a credential prompt on its own.
export default function WorkspaceSurface({ agentId, active = true, children }: {
  agentId: string; active?: boolean; children: ReactNode;
}) {
  const { t } = useTranslation();
  useSyncExternalStore(workspaceState.subscribe, () => workspaceState.version, () => 0);
  useEffect(() => agentId ? workspaceState.retain(agentId) : undefined, [agentId]);
  const grant = workspaceState.grants.get(agentId);
  // Unused-session collection forgets knownAgents, but keeps the revision so
  // transports require an explicit unlock. The surface must use that same
  // history or a reopened session is neither connected nor visibly locked.
  const locked = Boolean(agentId && (workspaceState.knownAgents.has(agentId) || workspaceState.revision(agentId) > 0) && (!grant || !workspaceState.valid(grant)));
  return <div data-workspace-agent={agentId} className="relative h-full min-h-0 w-full overflow-hidden" style={{ display: active ? undefined : "none" }}>
    <div className="h-full min-h-0" inert={locked}>{children}</div>
    {locked && <Flex direction="column" align="center" justify="center" gap="3" className="absolute inset-0" style={{ background: "var(--color-panel-solid)", zIndex: 20 }}>
      <Text size="2">{t("terminal.workspace_locked")}</Text>
      <Button onClick={() => workspaceState.requestUnlock(agentId)}>{t("terminal.workspace_unlock_machine")}</Button>
    </Flex>}
  </div>;
}
