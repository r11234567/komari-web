import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { Button, Flex, Text } from "@radix-ui/themes";
import { workspaceState } from "@/api/connect/workspace";

// A lock is local to one surface. Sibling machines remain usable and no stale
// background surface is allowed to open a credential prompt on its own.
export default function WorkspaceSurface({ agentId, active = true, children }: {
  agentId: string; active?: boolean; children: ReactNode;
}) {
  useSyncExternalStore(workspaceState.subscribe, () => workspaceState.version, () => 0);
  useEffect(() => agentId ? workspaceState.retain(agentId) : undefined, [agentId]);
  const grant = workspaceState.grants.get(agentId);
  const locked = Boolean(agentId && workspaceState.knownAgents.has(agentId) && (!grant || !workspaceState.valid(grant)));
  return <div data-workspace-agent={agentId} className="relative h-full min-h-0 w-full" style={{ display: active ? undefined : "none" }}>
    <div className="h-full min-h-0" inert={locked}>{children}</div>
    {locked && <Flex direction="column" align="center" justify="center" gap="3" className="absolute inset-0" style={{ background: "var(--color-panel-solid)", zIndex: 20 }}>
      <Text size="2">工作台已锁定</Text>
      <Button onClick={() => workspaceState.requestUnlock(agentId)}>解锁此机器</Button>
    </Flex>}
  </div>;
}
