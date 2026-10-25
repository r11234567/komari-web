import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { lockWorkspace, trackWorkspaceActivity, unlockWorkspace, workspaceState } from "@/api/connect/workspace";

function UnlockDialog({ agentId }: { agentId: string }) {
  const [username, setUsername] = useState(() => {
    try { return localStorage.getItem(`workspace-user:${agentId}`) ?? ""; } catch { return ""; }
  });
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submit = async () => {
    if (submitting || !username.trim() || !/^\d{6}$/.test(code)) return;
    setSubmitting(true); setError("");
    try {
      await unlockWorkspace(agentId, username.trim(), code);
      try { localStorage.setItem(`workspace-user:${agentId}`, username.trim()); } catch { /* Optional account preference. */ }
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); setCode(""); }
    finally { setSubmitting(false); }
  };
  return <Dialog.Root open onOpenChange={(open) => { if (!open && !submitting) workspaceState.cancel(agentId); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 bg-[#111]" style={{ zIndex: 200000 }} />
      <Dialog.Content className="fixed left-1/2 top-1/2 w-[min(92vw,420px)] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-neutral-600 bg-[#252526] p-5 text-neutral-100 shadow-xl" style={{ zIndex: 200001 }}>
        <Dialog.Title className="text-lg">解锁终端与文件工作台</Dialog.Title>
        <Dialog.Description className="mt-2 break-all text-sm text-neutral-300">
          目标：{agentId}。验证后最多使用 30 分钟，3 分钟无操作自动锁定。终端和文件使用下方系统账号的真实权限。
        </Dialog.Description>
        <form onSubmit={(event) => { event.preventDefault(); void submit(); }} className="mt-4 grid gap-3">
          <label className="grid gap-1 text-sm">目标机器的系统账号
            <input autoFocus autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="例如 alice" className="rounded border border-neutral-600 bg-[#1e1e1e] p-2" />
          </label>
          <label className="grid gap-1 text-sm">新的 2FA 验证码
            <input type="password" autoComplete="one-time-code" inputMode="numeric" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.trim())} className="rounded border border-neutral-600 bg-[#1e1e1e] p-2" />
          </label>
          <p className="text-xs text-neutral-400">请先在账户启用 2FA；root 还需机器端明确允许。Windows 身份切换暂不支持。</p>
          {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
          <div className="flex justify-end gap-3">
            <button type="button" disabled={submitting} onClick={() => workspaceState.cancel(agentId)}>取消</button>
            <button type="submit" disabled={submitting || !username.trim() || !/^\d{6}$/.test(code)} className="rounded bg-blue-600 px-3 py-2 disabled:opacity-50">{submitting ? "验证中…" : "解锁"}</button>
          </div>
        </form>
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
