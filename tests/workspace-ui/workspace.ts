import { WorkspaceState } from '../../src/utils/workspaceState';
export const workspaceState = new WorkspaceState(() => Date.now());
export const unlockCalls: { agent: string; user: string; token: string }[] = [];
export function trackWorkspaceActivity() { return () => {}; }
export async function unlockWorkspace(agent: string, user: string, token: string, signal?: AbortSignal) {
 signal?.throwIfAborted();
 unlockCalls.push({agent,user,token});
 workspaceState.install({agentId:agent,systemUser:user,token:'synthetic-workspace-grant',expiresAt:Date.now()+1800000,idleExpiresAt:Date.now()+180000,controller:new AbortController()});
}
