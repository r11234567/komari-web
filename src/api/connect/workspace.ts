import { Code, ConnectError, createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { WorkspaceService, type WorkspaceAuthorization } from "@komari/proto/komari/workspace/v1/workspace_pb";
import { WorkspacePeers } from "../../utils/workspacePeers";
import { WorkspaceState, type WorkspaceGrant } from "../../utils/workspaceState";

export const workspaceState = new WorkspaceState();
const client = createClient(WorkspaceService, createConnectTransport({
  baseUrl: typeof window === "undefined" ? "http://localhost" : window.location.origin,
  useBinaryFormat: true,
  defaultTimeoutMs: 15000,
  fetch: (input, init) => fetch(input, { ...init, credentials: "same-origin" }),
}));
const sessions = new Map<string, WorkspaceGrant>();
let peers: WorkspacePeers | undefined;


function fromAuthorization(value: WorkspaceAuthorization, previous?: WorkspaceGrant): WorkspaceGrant {
  if (!value.grantToken || !value.expiresAt || !value.idleExpiresAt) throw new Error("Missing workspace authorization");
  return { agentId: value.agentId, systemUser: value.systemUser, token: value.grantToken,
    expiresAt: timestampDate(value.expiresAt).getTime(), idleExpiresAt: timestampDate(value.idleExpiresAt).getTime(),
    controller: previous?.controller ?? new AbortController() };
}
export const ensureWorkspace = (agentId: string, signal?: AbortSignal) => {
  peers?.request(agentId);
  return workspaceState.authorize(agentId, signal);
};
export async function unlockWorkspace(agentId: string, systemUser: string, authorizationToken: string, signal?: AbortSignal) {
  const pending = workspaceState.pending.get(agentId);
  const boundSignal = pending ? AbortSignal.any([pending.controller.signal, ...(signal ? [signal] : [])]) : signal;
  const response = await client.unlockWorkspace({ agentId, systemUser, twoFactor: { authorizationToken } }, { signal: boundSignal });
  if (boundSignal?.aborted || (pending && workspaceState.pending.get(agentId) !== pending)) throw new DOMException("Stale workspace unlock", "AbortError");
  if (!response.authorization) throw new Error("Missing workspace authorization");
  const grant = fromAuthorization(response.authorization);
  workspaceState.install(grant);

}
export function lockWorkspace(agentId: string, reopen = false) {
  const grant = workspaceState.invalidate(agentId);
  if (grant) peers?.lock(agentId, grant.token);
  if (grant) void client.lockWorkspace({ grantToken: grant.token }).catch(() => {});
  for (const [id, session] of sessions) { if (session.agentId === agentId) sessions.delete(id); }
  if (reopen) void ensureWorkspace(agentId).catch(() => {});
}
export async function workspaceAccess(agentId: string, signal: AbortSignal) {
  const grant = await ensureWorkspace(agentId, signal);
  signal.throwIfAborted();
  return { headers: { "X-Komari-Workspace-Grant": grant.token }, signal: AbortSignal.any([signal, grant.controller.signal]) };
}
export function rememberWorkspaceSession(sessionId: string, agentId: string) {
  const grant = workspaceState.grants.get(agentId);
  if (!grant || !workspaceState.valid(grant)) throw new Error("Workspace locked");
  sessions.set(sessionId, grant);
}
export const forgetWorkspaceSession = (sessionId: string) => { sessions.delete(sessionId); };
export function workspaceSessionValid(sessionId: string) {
  const grant = sessions.get(sessionId);
  return Boolean(grant && workspaceState.valid(grant) && workspaceState.grants.get(grant.agentId)?.token === grant.token);
}
export function workspaceSessionAccess(sessionId: string, signal: AbortSignal) {
  const grant = sessions.get(sessionId);
  if (!grant || !workspaceState.valid(grant) || workspaceState.grants.get(grant.agentId)?.token !== grant.token) throw new Error("Workspace locked");
  return { headers: { "X-Komari-Workspace-Grant": grant.token }, signal: AbortSignal.any([signal, grant.controller.signal]) };
}

export function trackWorkspaceActivity() {
  if (typeof BroadcastChannel !== "undefined") peers = new WorkspacePeers(workspaceState, new BroadcastChannel("komari-workspace-v1"));
  const release = (agentId: string) => {
    if (peers?.hasConsumer(agentId)) workspaceState.invalidate(agentId);
    else lockWorkspace(agentId);
  };
  const activity = (event: Event) => {
    if (!event.isTrusted || document.visibilityState !== "visible" || !document.hasFocus()) return;
    const agentId = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-workspace-agent]")?.dataset.workspaceAgent : undefined;
    if (!agentId) return;
    void workspaceState.touch(agentId, async (grant) => {
      const response = await client.touchWorkspace({ grantToken: grant.token }, { signal: grant.controller.signal });
      if (!response.authorization) throw new Error("Missing workspace authorization");
      return fromAuthorization(response.authorization, grant);
    }).catch((error: unknown) => {
      // Temporary transport failure must not revoke another machine or summon a dialog.
      if (error instanceof ConnectError && [Code.Unauthenticated, Code.PermissionDenied].includes(error.code)) lockWorkspace(agentId);
    });
  };
  const events = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"];
  events.forEach((name) => document.addEventListener(name, activity, { capture: true, passive: true }));
  const timer = window.setInterval(() => { workspaceState.expire(); workspaceState.collectUnused(release); }, 1000);
  const visibility = () => workspaceState.expire();
  document.addEventListener("visibilitychange", visibility);
  return () => {
    events.forEach((name) => document.removeEventListener(name, activity, true));
    document.removeEventListener("visibilitychange", visibility);
    window.clearInterval(timer);
    for (const agent of workspaceState.grants.keys()) release(agent);
    peers?.dispose(); peers = undefined;
    for (const agent of workspaceState.pending.keys()) workspaceState.cancel(agent);
  };
}
