import { WorkspaceState, type WorkspaceGrant } from './workspaceState.ts';

interface Channel {
  postMessage(value: unknown): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  close(): void;
}
type WireGrant = Omit<WorkspaceGrant, 'controller'>;
type Message = { sender: string; kind: 'hello' | 'grant' | 'consumers' | 'lock'; agentId?: string; grant?: WireGrant; agents?: string[] };

// Same-origin tabs share only in-memory, machine-scoped capabilities. No token
// goes into persistent browser storage; every server request still verifies its
// login session, machine and OS account. A channel message is never proof.
export class WorkspacePeers {
  private id = crypto.randomUUID();
  private applying = false;
  private sent = new Map<string, string>();
  private peers = new Map<string, { at: number; agents: string[] }>();
  private unsubscribe: () => void;
  private timer: ReturnType<typeof setInterval>;
  private state: WorkspaceState;
  private channel: Channel;
  private now: () => number;
  constructor(state: WorkspaceState, channel: Channel, now = Date.now) {
    this.state = state; this.channel = channel; this.now = now;
    channel.addEventListener('message', this.receive);
    this.unsubscribe = state.subscribe(this.publish);
    this.timer = setInterval(this.announce, 15_000);
    this.announce();
  }
  request(agentId: string) { this.channel.postMessage({ sender: this.id, kind: 'hello', agentId }); }
  hasConsumer(agentId: string) {
    return [...this.peers.values()].some(peer => this.now() - peer.at < 45_000 && peer.agents.includes(agentId));
  }
  lock(agentId: string) { this.channel.postMessage({ sender: this.id, kind: 'lock', agentId }); }
  private announce = () => {
    this.channel.postMessage({ sender: this.id, kind: 'consumers', agents: this.state.consumingAgents() });
  };
  private publish = () => {
    this.announce();
    if (this.applying) return;
    for (const grant of this.state.grants.values()) {
      if (!this.state.valid(grant)) continue;
      const fingerprint = `${grant.token}:${grant.idleExpiresAt}`;
      if (this.sent.get(grant.agentId) === fingerprint) continue;
      this.sent.set(grant.agentId, fingerprint);
      const { agentId, systemUser, token, expiresAt, idleExpiresAt } = grant;
      this.channel.postMessage({ sender: this.id, kind: 'grant', grant: { agentId, systemUser, token, expiresAt, idleExpiresAt } });
    }
  };
  private receive = (event: MessageEvent<Message>) => {
    const message = event.data;
    if (!message || typeof message.sender !== 'string' || message.sender === this.id) return;
    if (message.kind === 'consumers') {
      if (!Array.isArray(message.agents) || message.agents.length > 256 || message.agents.some(agent => typeof agent !== 'string')) return;
      // Bound stale peers as well as active entries.
      for (const [id, peer] of this.peers) if (this.now() - peer.at >= 45_000) this.peers.delete(id);
      if (this.peers.size < 256 || this.peers.has(message.sender)) this.peers.set(message.sender, { at: this.now(), agents: message.agents });
      return;
    }
    if (message.kind === 'hello') {
      if (typeof message.agentId !== 'string') return;
      this.sent.delete(message.agentId); this.publish(); this.announce(); return;
    }
    if (message.kind === 'lock') {
      if (typeof message.agentId === 'string') this.state.invalidate(message.agentId);
      return;
    }
    if (message.kind !== 'grant') return;
    const grant = message.grant;
    if (!grant || typeof grant.agentId !== 'string' || !this.state.knownAgents.has(grant.agentId) || typeof grant.systemUser !== 'string' || grant.systemUser.length > 128 || typeof grant.token !== 'string' || grant.token.length > 256 || !Number.isFinite(grant.expiresAt) || !Number.isFinite(grant.idleExpiresAt) || grant.expiresAt <= this.now() || grant.idleExpiresAt <= this.now()) return;
    const previous = this.state.grants.get(grant.agentId);
    if (previous?.token === grant.token && previous.idleExpiresAt >= grant.idleExpiresAt) return;
    this.applying = true;
    try { this.state.install({ ...grant, controller: previous?.token === grant.token ? previous.controller : new AbortController() }); }
    finally { this.applying = false; }
  };
  dispose() {
    clearInterval(this.timer); this.unsubscribe();
    this.channel.postMessage({ sender: this.id, kind: 'consumers', agents: [] });
    this.channel.removeEventListener('message', this.receive); this.channel.close();
  }
}
