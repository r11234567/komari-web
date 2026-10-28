export interface WorkspaceGrant {
  agentId: string;
  systemUser: string;
  token: string;
  expiresAt: number;
  idleExpiresAt: number;
  controller: AbortController;
}

interface PendingAuthorization {
  promise: Promise<WorkspaceGrant>;
  resolve: (grant: WorkspaceGrant) => void;
  reject: (error: Error) => void;
  controller: AbortController;
  waiters: number;
}

export class WorkspaceState {
  grants = new Map<string, WorkspaceGrant>();
  knownAgents = new Set<string>();
  pending = new Map<string, PendingAuthorization>();
  promptAgent: string | undefined;
  private consumers = new Map<string, { count: number; releasedAt?: number }>();
  private touches = new Map<string, { at: number; busy: boolean }>();
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
  authorize(agentId: string, signal?: AbortSignal, interactive = false): Promise<WorkspaceGrant> {
    if (signal?.aborted) return Promise.reject(new DOMException("Workspace request aborted", "AbortError"));
    this.knownAgents.add(agentId);
    const grant = this.grants.get(agentId);
    if (grant && this.valid(grant)) return Promise.resolve(grant);
    if (grant) this.invalidate(agentId);
    const existing = this.pending.get(agentId);
    if (existing) return this.wait(agentId, existing, signal);
    if (!interactive && this.revision(agentId) > 0) return Promise.reject(new Error("Workspace locked"));
    const pending = { controller: new AbortController(), waiters: 0 } as PendingAuthorization;
    pending.promise = new Promise((resolve, reject) => { pending.resolve = resolve; pending.reject = reject; });
    this.pending.set(agentId, pending);
    if (!this.promptAgent) this.promptAgent = agentId;
    this.emit();
    return this.wait(agentId, pending, signal);
  }
  private wait(agentId: string, pending: PendingAuthorization, signal?: AbortSignal) {
    // Legacy callers without a lifetime still share the exact same promise.
    if (!signal) { pending.waiters++; return pending.promise; }
    pending.waiters++;
    return new Promise<WorkspaceGrant>((resolve, reject) => {
      let finished = false;
      const cleanup = () => {
        if (finished) return false;
        finished = true;
        signal.removeEventListener("abort", abort);
        pending.waiters--;
        return true;
      };
      const abort = () => {
        if (!cleanup()) return;
        reject(new DOMException("Workspace request aborted", "AbortError"));
        if (pending.waiters === 0 && this.pending.get(agentId) === pending) this.cancel(agentId);
      };
      signal.addEventListener("abort", abort, { once: true });
      pending.promise.then((grant) => { if (cleanup()) resolve(grant); }, (error: Error) => { if (cleanup()) reject(error); });
      if (signal.aborted) abort();
    });
  }
  requestUnlock(agentId: string) {
    this.promptAgent = agentId;
    void this.authorize(agentId, undefined, true).catch(() => {});
    this.emit();
  }
  consumingAgents() { return [...this.consumers].filter(([, entry]) => entry.count > 0).map(([agentId]) => agentId); }
  retain(agentId: string) {
    const entry = this.consumers.get(agentId) ?? { count: 0 };
    entry.count++;
    entry.releasedAt = undefined;
    this.consumers.set(agentId, entry);
    this.emit();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (--entry.count === 0) {
        entry.releasedAt = this.now();
        this.cancel(agentId);
      }
    };
  }
  collectUnused(revoke: (agentId: string) => void) {
    for (const [agentId, entry] of this.consumers) {
      if (entry.count === 0 && entry.releasedAt !== undefined && this.now() - entry.releasedAt >= 60_000) {
        this.consumers.delete(agentId);
        this.knownAgents.delete(agentId);
        this.touches.delete(agentId);
        revoke(agentId);
      }
    }
  }
  async touch(agentId: string, renew: (grant: WorkspaceGrant) => Promise<WorkspaceGrant>) {
    const grant = this.grants.get(agentId);
    const previous = this.touches.get(agentId);
    if (!grant || !this.valid(grant) || previous?.busy || (previous && this.now() - previous.at < 10_000)) return;
    const entry = { at: this.now(), busy: true };
    this.touches.set(agentId, entry);
    try {
      const refreshed = await renew(grant);
      if (this.grants.get(agentId) === grant && this.valid(grant)) this.install(refreshed);
    } finally { entry.busy = false; }
  }
  install(grant: WorkspaceGrant) {
    const previous = this.grants.get(grant.agentId);
    if (previous && previous.token !== grant.token) previous.controller.abort();
    if (!previous || previous.token !== grant.token) this.revisions.set(grant.agentId, this.revision(grant.agentId) + 1);
    this.grants.set(grant.agentId, grant);
    this.pending.get(grant.agentId)?.resolve(grant);
    this.pending.delete(grant.agentId);
    if (this.promptAgent === grant.agentId) this.promptAgent = undefined;
    this.emit();
  }
  cancel(agentId: string) {
    this.pending.get(agentId)?.controller.abort();
    this.pending.get(agentId)?.reject(new DOMException("Workspace unlock cancelled", "AbortError"));
    this.pending.delete(agentId);
    if (this.promptAgent === agentId) this.promptAgent = undefined;
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
        // Expiry is silent. Only explicit interaction may request verification.
      }
    }
  }
}
