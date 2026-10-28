import { workspaceAccess, rememberWorkspaceSession, workspaceSessionAccess, forgetWorkspaceSession } from '../../src/api/connect/workspace';
export const terminals: Terminal[] = [];
export const starts: string[] = [];
export const failures = new Set<string>();
export class Terminal {
  options: Record<string, unknown>;
  rows = 24; cols = 80; text = ''; disposed = false;
  buffer = { active: { length: 0, getLine: () => undefined } };
  node?: HTMLElement;
  constructor(options: Record<string, unknown>) { this.options = options; terminals.push(this); }
  loadAddon() {} open(host: HTMLElement) { this.node = document.createElement('div'); host.appendChild(this.node); }
  write(data: string | Uint8Array) { this.text += typeof data === 'string' ? data : new TextDecoder().decode(data); }
  reset() { this.text = ''; } dispose() { this.disposed = true; this.node?.remove(); }
  onData() { return { dispose() {} }; } onResize() { return { dispose() {} }; }
  attachCustomKeyEventHandler() {} focus() {} hasSelection() { return false; } getSelection() { return ''; }
}
export class FitAddon { fit() {} }
export class SearchAddon {}
export class WebLinksAddon {}
export async function createRemoteSession(input: { agentId: string; signal: AbortSignal }) {
  const access = await workspaceAccess(input.agentId, input.signal);
  input.signal.throwIfAborted();
  const sessionId = input.agentId + ':' + starts.length;
  starts.push(input.agentId);
  if (failures.has(input.agentId)) {
    await new Promise(resolve => setTimeout(resolve, 5));
    throw new Error('synthetic create unavailable');
  }
  rememberWorkspaceSession(sessionId, input.agentId, access.headers['X-Komari-Workspace-Grant']);
  return { sessionId };
}
export async function* watchRemoteSession(input: { sessionId: string; signal: AbortSignal }): AsyncIterable<never> {
  const access = workspaceSessionAccess(input.sessionId, input.signal);
  if (access.signal.aborted) return;
  yield* [];
  await new Promise<void>((resolve) => access.signal.addEventListener('abort', () => resolve(), { once: true }));
}
export async function sendRemoteSessionInput() {}
export async function sendRemoteSessionResize() {}
export async function closeRemoteSession(input: { sessionId: string }) { forgetWorkspaceSession(input.sessionId); }
