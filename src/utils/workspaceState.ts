export interface WorkspaceGrant {
  agentId: string;
  systemUser: string;
  token: string;
  expiresAt: number;
  idleExpiresAt: number;
  controller: AbortController;
}

export class WorkspaceState {
  grants = new Map<string, WorkspaceGrant>();
  knownAgents = new Set<string>();
  pending = new Map<string, {
    promise: Promise<WorkspaceGrant>;
    resolve: (grant: WorkspaceGrant) => void;
    reject: (error: Error) => void;
  }>();
  private listeners = new Set<() => void>();
  private revisions = new Map<string, number>();
  version = 0;

  private now: () => number;
  constructor(now: () => number = Date.now) { this.now = now; }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  emit() { this.version++; this.listeners.forEach((listener) => listener()); }
  revision(agentId: string) { return this.revisions.get(agentId) ?? 0; }
  valid(grant: WorkspaceGrant) {
    return !grant.controller.signal.aborted && this.now() < Math.min(grant.expiresAt, grant.idleExpiresAt);
  }
  authorize(agentId: string): Promise<WorkspaceGrant> {
    this.knownAgents.add(agentId);
    const grant = this.grants.get(agentId);
    if (grant && this.valid(grant)) return Promise.resolve(grant);
    if (grant) this.invalidate(agentId);
    const existing = this.pending.get(agentId);
    if (existing) return existing.promise;
    const pending = {} as { promise: Promise<WorkspaceGrant>; resolve: (grant: WorkspaceGrant) => void; reject: (error: Error) => void };
    pending.promise = new Promise((resolve, reject) => { pending.resolve = resolve; pending.reject = reject; });
    this.pending.set(agentId, pending);
    this.emit();
    return pending.promise;
  }
  install(grant: WorkspaceGrant) {
    const previous = this.grants.get(grant.agentId);
    if (previous && previous.token !== grant.token) previous.controller.abort();
    this.grants.set(grant.agentId, grant);
    this.pending.get(grant.agentId)?.resolve(grant);
    this.pending.delete(grant.agentId);
    this.emit();
  }
  cancel(agentId: string) {
    this.pending.get(agentId)?.reject(new DOMException("Workspace unlock cancelled", "AbortError"));
    this.pending.delete(agentId);
    this.emit();
  }
  invalidate(agentId: string) {
    const grant = this.grants.get(agentId);
    this.grants.delete(agentId);
    grant?.controller.abort();
    this.revisions.set(agentId, this.revision(agentId) + 1);
    this.emit();
    return grant;
  }
  expire() {
    for (const [agentId, grant] of this.grants) {
      if (!this.valid(grant)) {
        this.invalidate(agentId);
        void this.authorize(agentId).catch(() => {});
      }
    }
  }
}
