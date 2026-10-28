import { useEffect, useId, useState, useSyncExternalStore, type ReactNode } from "react";
import { Badge, Box, Button, Code, Flex, Heading, Text, TextField } from "@radix-ui/themes";
import { trackWorkspaceActivity, unlockWorkspace, workspaceState } from "@/api/connect/workspace";
import TrustedCredentialVerification from "@/components/TrustedCredentialVerification";
import { CredentialPurpose } from "@komari/proto/komari/credential/v1/credential_pb";
import { workspaceCredentialResource } from "@/api/connect/trustedCredential";

function UnlockDialog({ agentId }: { agentId: string }) {
  const [username, setUsername] = useState(() => {
    try { return localStorage.getItem(`workspace-user:${agentId}`) ?? ""; } catch { return ""; }
  });
  const [targetUser, setTargetUser] = useState("");
  const usernameId = useId();
  return <div role="dialog" aria-modal="false" aria-label="解锁终端与文件工作台" onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); workspaceState.cancel(agentId); } }} className="km-workspace-unlock fixed right-4 top-20 rounded-lg border p-6 shadow-xl" style={{ zIndex: 100020, width: "480px", maxWidth: "calc(100vw - 32px)", background: "var(--color-panel-solid)", borderColor: "var(--gray-a6)" }}>
      <Heading size="5">解锁终端与文件工作台</Heading>
      <Text as="p" size="2" color="gray" mt="2">
        验证后最多使用 30 分钟，3 分钟无操作自动锁定。终端和文件使用所选系统账号的真实权限。
      </Text>
      <Flex direction="column" gap="4" mt="4">
        <Box p="3" style={{ background: "var(--gray-a2)", borderRadius: "var(--radius-3)" }}>
          <Flex direction="column" gap="2">
            <Flex align="center" justify="between" gap="2">
              <Text size="2" color="gray">目标机器</Text>
              <Badge variant="soft" color="gray">{targetUser ? "验证身份" : "选择账号"}</Badge>
            </Flex>
            <Code size="1" style={{ overflowWrap: "anywhere" }}>{agentId}</Code>
          </Flex>
        </Box>
        <Flex direction="column" gap="2">
          <Text as="label" htmlFor={usernameId} size="2" weight="medium">目标机器的系统账号</Text>
          <TextField.Root id={usernameId} autoFocus autoComplete="username" disabled={Boolean(targetUser)} value={username} onChange={(event) => setUsername(event.target.value)} placeholder="例如 alice" />
          <Text size="1" color="gray">请先在账户配置可信凭据；root 还需机器端明确允许。Windows 身份切换暂不支持。</Text>
        </Flex>
        {targetUser ? <TrustedCredentialVerification purpose={CredentialPurpose.UNLOCK_WORKSPACE} resource={workspaceCredentialResource(agentId, targetUser)} onAuthorized={async (token, signal) => {
          await unlockWorkspace(agentId, targetUser, token, signal);
          try { localStorage.setItem(`workspace-user:${agentId}`, targetUser); } catch { /* Optional account preference. */ }
        }} /> : <Button type="button" disabled={!username.trim()} onClick={() => setTargetUser(username.trim())}>验证并解锁</Button>}
        <Flex justify="end" gap="3" wrap="wrap">
          {targetUser && <Button type="button" variant="soft" color="gray" onClick={() => setTargetUser("")}>更换账号</Button>}
          <Button type="button" variant="soft" color="gray" onClick={() => workspaceState.cancel(agentId)}>取消</Button>
        </Flex>
      </Flex>
  </div>;
}

export default function WorkspaceBoundary({ children }: { children: ReactNode }) {
  useSyncExternalStore(workspaceState.subscribe, () => workspaceState.version, () => 0);
  useEffect(trackWorkspaceActivity, []);
  const pending = workspaceState.promptAgent;
  return <>
    {children}
    {pending && workspaceState.pending.has(pending) && <UnlockDialog key={pending} agentId={pending} />}
  </>;
}
