import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { lockWorkspace, trackWorkspaceActivity, unlockWorkspace, workspaceState } from "@/api/connect/workspace";
import TrustedCredentialVerification from "@/components/TrustedCredentialVerification";
import { CredentialPurpose } from "@komari/proto/komari/credential/v1/credential_pb";
import { workspaceCredentialResource } from "@/api/connect/trustedCredential";

function UnlockDialog({ agentId }: { agentId: string }) {
  const [username, setUsername] = useState(() => {
    try { return localStorage.getItem(`workspace-user:${agentId}`) ?? ""; } catch { return ""; }
  });
  const [targetUser, setTargetUser] = useState("");
  return <Dialog.Root open onOpenChange={(open) => { if (!open) workspaceState.cancel(agentId); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 bg-[#111]" style={{ zIndex: 200000 }} />
      <Dialog.Content className="fixed left-1/2 top-1/2 w-[min(92vw,420px)] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-neutral-600 bg-[#252526] p-5 text-neutral-100 shadow-xl" style={{ zIndex: 200001 }}>
        <Dialog.Title className="text-lg">解锁终端与文件工作台</Dialog.Title>
        <Dialog.Description className="mt-2 break-all text-sm text-neutral-300">
          目标：{agentId}。验证后最多使用 30 分钟，3 分钟无操作自动锁定。终端和文件使用下方系统账号的真实权限。
        </Dialog.Description>
        <div className="mt-4 grid gap-3">
          <label className="grid gap-1 text-sm">目标机器的系统账号
            <input autoFocus autoComplete="username" disabled={Boolean(targetUser)} value={username} onChange={(event) => setUsername(event.target.value)} placeholder="例如 alice" className="rounded border border-neutral-600 bg-[#1e1e1e] p-2" />
          </label>
          <p className="text-xs text-neutral-400">请先在账户配置可信凭据；root 还需机器端明确允许。Windows 身份切换暂不支持。</p>
          {targetUser ? <TrustedCredentialVerification purpose={CredentialPurpose.UNLOCK_WORKSPACE} resource={workspaceCredentialResource(agentId, targetUser)} onAuthorized={async (token, signal) => {
            await unlockWorkspace(agentId, targetUser, token, signal);
            try { localStorage.setItem(`workspace-user:${agentId}`, targetUser); } catch { /* Optional account preference. */ }
          }} /> : <button type="button" disabled={!username.trim()} onClick={() => setTargetUser(username.trim())} className="rounded bg-blue-600 px-3 py-2 disabled:opacity-50">验证并解锁</button>}
          <div className="flex justify-end gap-3">
            {targetUser && <button type="button" onClick={() => setTargetUser("")}>更换账号</button>}
            <button type="button" onClick={() => workspaceState.cancel(agentId)}>取消</button>
          </div>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}

export default function WorkspaceBoundary({ children }: { children: ReactNode }) {
  useSyncExternalStore(workspaceState.subscribe, () => workspaceState.version, () => 0);
  useEffect(trackWorkspaceActivity, []);
  const pending = workspaceState.pending.keys().next().value as string | undefined;
  return <>
    <div inert={Boolean(pending)}>{children}</div>
    {!pending && workspaceState.knownAgents.size > 0 && <details className="fixed bottom-2 right-2 rounded border border-neutral-600 bg-[#252526] p-2 text-xs text-neutral-200" style={{ zIndex: 100020 }}>
      <summary>工作台账号 / 锁定</summary>
      {[...workspaceState.knownAgents].map((agentId) => <div key={agentId} className="mt-2 flex max-w-[360px] items-center gap-2">
        <span className="truncate">{agentId}：{workspaceState.grants.get(agentId)?.systemUser ?? "已锁定"}</span>
        <button className="shrink-0 text-blue-300" onClick={() => lockWorkspace(agentId)}>解锁 / 切换账号</button>
        {workspaceState.grants.has(agentId) && <button className="shrink-0" onClick={() => lockWorkspace(agentId, false)}>锁定</button>}
      </div>)}
    </details>}
    {pending && <UnlockDialog key={pending} agentId={pending} />}
  </>;
}
