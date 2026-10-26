import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { WorkspaceService, type WorkspaceAuthorization } from "@komari/proto/komari/workspace/v1/workspace_pb";
import { WorkspaceState, type WorkspaceGrant } from "../../utils/workspaceState";

export const workspaceState = new WorkspaceState();
const client = createClient(WorkspaceService, createConnectTransport({
  baseUrl: typeof window === "undefined" ? "http://localhost" : window.location.origin,
  useBinaryFormat: true,
  defaultTimeoutMs: 15000,
  fetch: (input, init) => fetch(input, { ...init, credentials: "same-origin" }),
}));
const sessions = new Map<string, WorkspaceGrant>();
let activeAgent = "";
let lastTouch = 0;
let touching = false;

function fromAuthorization(value: WorkspaceAuthorization, previous?: WorkspaceGrant): WorkspaceGrant {
  if (!value.grantToken || !value.expiresAt || !value.idleExpiresAt) throw new Error("Missing workspace authorization");
  return { agentId: value.agentId, systemUser: value.systemUser, token: value.grantToken,
    expiresAt: timestampDate(value.expiresAt).getTime(), idleExpiresAt: timestampDate(value.idleExpiresAt).getTime(),
    controller: previous?.controller ?? new AbortController() };
}
export const setActiveWorkspace = (agentId: string) => { activeAgent = agentId; };
export const ensureWorkspace = (agentId: string) => {
  if (!activeAgent) activeAgent = agentId;
  return workspaceState.authorize(agentId);
};
export async function unlockWorkspace(agentId: string, systemUser: string, authorizationToken: string, signal?: AbortSignal) {
  const response = await client.unlockWorkspace({ agentId, systemUser, twoFactor: { authorizationToken } }, { signal });
  if (!response.authorization) throw new Error("Missing workspace authorization");
  const grant = fromAuthorization(response.authorization);
  workspaceState.install(grant);
  activeAgent = agentId;
  lastTouch = Date.now();
}
export function lockWorkspace(agentId: string, reopen = true) {
  const grant = workspaceState.invalidate(agentId);
  if (grant) void client.lockWorkspace({ grantToken: grant.token }).catch(() => {});
  for (const [id, session] of sessions) { if (session.agentId === agentId) sessions.delete(id); }
  if (reopen) void ensureWorkspace(agentId).catch(() => {});
}
export async function workspaceAccess(agentId: string, signal: AbortSignal) {
  const grant = await ensureWorkspace(agentId);
  return { headers: { "X-Komari-Workspace-Grant": grant.token }, signal: AbortSignal.any([signal, grant.controller.signal]) };
}
export function rememberWorkspaceSession(sessionId: string, agentId: string) {
  const grant = workspaceState.grants.get(agentId);
  if (!grant || !workspaceState.valid(grant)) throw new Error("Workspace locked");
  sessions.set(sessionId, grant);
}
export function workspaceSessionAccess(sessionId: string, signal: AbortSignal) {
  const grant = sessions.get(sessionId);
  if (!grant || !workspaceState.valid(grant) || workspaceState.grants.get(grant.agentId)?.token !== grant.token) throw new Error("Workspace locked");
  return { headers: { "X-Komari-Workspace-Grant": grant.token }, signal: AbortSignal.any([signal, grant.controller.signal]) };
}

export function trackWorkspaceActivity() {
  const activity = (event: Event) => {
    if (!event.isTrusted || document.visibilityState !== "visible" || !document.hasFocus()) return;
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-workspace-agent]")?.dataset.workspaceAgent : undefined;
    if (target) activeAgent = target;
    const grant = workspaceState.grants.get(activeAgent);
    if (!grant || !workspaceState.valid(grant) || touching || Date.now() - lastTouch < 10000) return;
    touching = true;
    lastTouch = Date.now();
    void client.touchWorkspace({ grantToken: grant.token }).then((response) => {
      if (response.authorization && workspaceState.grants.get(grant.agentId)?.token === grant.token) workspaceState.install(fromAuthorization(response.authorization, grant));
    }).catch(() => { if (workspaceState.grants.get(grant.agentId)?.token === grant.token) lockWorkspace(grant.agentId); }).finally(() => { touching = false; });
  };
  const events = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"];
  events.forEach((name) => document.addEventListener(name, activity, { capture: true, passive: true }));
  const timer = window.setInterval(() => workspaceState.expire(), 1000);
  const visibility = () => workspaceState.expire();
  document.addEventListener("visibilitychange", visibility);
  return () => {
    events.forEach((name) => document.removeEventListener(name, activity, true));
    document.removeEventListener("visibilitychange", visibility);
    window.clearInterval(timer);
    for (const agent of workspaceState.grants.keys()) lockWorkspace(agent, false);
    for (const agent of workspaceState.pending.keys()) workspaceState.cancel(agent);
  };
}
