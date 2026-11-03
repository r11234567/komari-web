import { WorkspaceState } from "../../../src/utils/workspaceState";
import { state } from "./state";
export const workspaceState = new WorkspaceState();
export const ensureWorkspace = (agentId: string, signal?: AbortSignal) => workspaceState.authorize(agentId, signal);
export const trackWorkspaceActivity = () => () => {};
export async function unlockWorkspace(agentId: string, systemUser: string, token: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (token !== "synthetic-scoped-proof") throw new Error("Synthetic transport: missing workspace proof");
  state.unlocks.push({ agentId, systemUser });
  installFixtureGrant(agentId, systemUser);
}
export function installFixtureGrant(agentId: string, systemUser = "alice") {
  workspaceState.install({ agentId, systemUser, token: "synthetic-workspace-grant", expiresAt: Date.now() + 1800000, idleExpiresAt: Date.now() + 180000, controller: new AbortController() });
}
export async function workspaceAccess(agentId: string, signal: AbortSignal) {
  const grant = await ensureWorkspace(agentId, signal);
  return { headers: { "X-Komari-Workspace-Grant": grant.token }, signal: AbortSignal.any([signal, grant.controller.signal]) };
}
