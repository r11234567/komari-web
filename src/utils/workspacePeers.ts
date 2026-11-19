import { WorkspaceState, type WorkspaceGrant } from './workspaceState.ts';

interface Channel {
  postMessage(value: unknown): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  close(): void;
}

type Message =
  | { sender: string; kind: 'consumers'; agents: string[] }
  | { sender: string; kind: 'changed'; agentId: string }
  | { sender: string; kind: 'lock'; agentId: string; lockedAt: number };

export type WorkspaceSyncResult =
  | { kind: 'grant'; grant: WorkspaceGrant }
  | { kind: 'unauthorized' }
  | { kind: 'none' };

// Coordinate active workspace consumers, state-change pings, and explicit locks
// across same-origin tabs without ever transmitting bearer grant tokens on
// BroadcastChannel. Receiving tabs re-query the server with per-agent sequence
// and revision guards so stale or cancelled sync responses cannot overwrite
// newer local grants or resurrect locked workspaces.
export class WorkspacePeers {
  private id = crypto.randomUUID();
  private peers = new Map<string, { at: number; agents: string[] }>();
  private syncRequests = new Map<string, { seq: number; startRevision: number; controller: AbortController }>();
  private nextSyncSeq = 0;
  private disposed = false;
  private unsubscribe: () => void;
  private timer: ReturnType<typeof setInterval>;
  private state: WorkspaceState;
  private channel: Channel;
  private now: () => number;
  private syncGrant?: (agentId: string, signal: AbortSignal) => Promise<WorkspaceSyncResult>;

  constructor(
    state: WorkspaceState,
    channel: Channel,
    now = Date.now,
    syncGrant?: (agentId: string, signal: AbortSignal) => Promise<WorkspaceSyncResult>,
  ) {
    this.state = state;
    this.channel = channel;
    this.now = now;
    this.syncGrant = syncGrant;
    channel.addEventListener('message', this.receive);
    this.unsubscribe = state.subscribe(this.onStateChange);
    this.timer = setInterval(this.announce, 15_000);
    this.announce();
  }

  hasConsumer(agentId: string) {
    return [...this.peers.values()].some((peer) => this.now() - peer.at < 45_000 && peer.agents.includes(agentId));
  }

  cancelSync(agentId: string) {
    const active = this.syncRequests.get(agentId);
    if (!active) return;
    this.syncRequests.delete(agentId);
    active.controller.abort();
  }

  notifyChanged(agentId: string) {
    this.cancelSync(agentId);
    this.channel.postMessage({ sender: this.id, kind: 'changed', agentId });
  }

  lock(agentId: string) {
    this.cancelSync(agentId);
    this.channel.postMessage({ sender: this.id, kind: 'lock', agentId, lockedAt: this.now() });
  }

  private onStateChange = () => {
    for (const [agentId, active] of this.syncRequests) {
      if (this.state.revision(agentId) !== active.startRevision) {
        this.syncRequests.delete(agentId);
        active.controller.abort();
      }
    }
    this.announce();
  };

  private announce = () => {
    this.channel.postMessage({ sender: this.id, kind: 'consumers', agents: this.state.consumingAgents() });
  };

  private sync(agentId: string) {
    if (this.disposed || !this.syncGrant) return;
    this.cancelSync(agentId);
    const seq = ++this.nextSyncSeq;
    const startRevision = this.state.revision(agentId);
    const controller = new AbortController();
    this.syncRequests.set(agentId, { seq, startRevision, controller });
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]);
    const isCurrent = () =>
      !this.disposed &&
      !controller.signal.aborted &&
      this.syncRequests.get(agentId)?.seq === seq &&
      this.state.revision(agentId) === startRevision;

    void this.syncGrant(agentId, signal)
      .then((result) => {
        if (!isCurrent()) return;
        this.syncRequests.delete(agentId);
        if (result.kind === 'grant') {
          this.state.install(result.grant);
        } else if (result.kind === 'unauthorized' && this.state.grants.has(agentId)) {
          this.state.invalidate(agentId);
        }
      })
      .catch(() => {
        if (this.syncRequests.get(agentId)?.seq === seq) {
          this.syncRequests.delete(agentId);
        }
      });
  }

  private receive = (event: MessageEvent<Message>) => {
    const message = event.data;
    if (!message || typeof message.sender !== 'string' || message.sender === this.id) return;
    if (message.kind === 'consumers') {
      if (!Array.isArray(message.agents) || message.agents.length > 256 || message.agents.some((agent) => typeof agent !== 'string')) return;
      for (const [id, peer] of this.peers) {
        if (this.now() - peer.at >= 45_000) this.peers.delete(id);
      }
      if (this.peers.size < 256 || this.peers.has(message.sender)) {
        this.peers.set(message.sender, { at: this.now(), agents: message.agents });
      }
      return;
    }
    if (message.kind === 'changed') {
      if (typeof message.agentId !== 'string' || !message.agentId) return;
      this.sync(message.agentId);
      return;
    }
    if (message.kind === 'lock') {
      if (typeof message.agentId !== 'string' || !Number.isFinite(message.lockedAt)) return;
      // Always cancel any in-flight pull even on a cold tab with no local grant yet.
      this.cancelSync(message.agentId);
      if (this.state.grants.has(message.agentId)) {
        this.state.invalidate(message.agentId);
      }
    }
  };

  dispose() {
    this.disposed = true;
    for (const active of this.syncRequests.values()) {
      active.controller.abort();
    }
    this.syncRequests.clear();
    clearInterval(this.timer);
    this.unsubscribe();
    this.channel.postMessage({ sender: this.id, kind: 'consumers', agents: [] });
    this.channel.removeEventListener('message', this.receive);
    this.channel.close();
  }
}
