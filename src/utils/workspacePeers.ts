import { WorkspaceState } from './workspaceState.ts';

interface Channel {
  postMessage(value: unknown): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  close(): void;
}

type Message =
  | { sender: string; kind: 'consumers'; agents: string[] }
  | { sender: string; kind: 'lock'; agentId: string; lockedAt: number };

// Coordinate active workspace consumers and explicit locks across same-origin
// tabs without ever transmitting bearer grant tokens on BroadcastChannel.
export class WorkspacePeers {
  private id = crypto.randomUUID();
  private peers = new Map<string, { at: number; agents: string[] }>();
  private unsubscribe: () => void;
  private timer: ReturnType<typeof setInterval>;
  private state: WorkspaceState;
  private channel: Channel;
  private now: () => number;

  constructor(state: WorkspaceState, channel: Channel, now = Date.now) {
    this.state = state;
    this.channel = channel;
    this.now = now;
    channel.addEventListener('message', this.receive);
    this.unsubscribe = state.subscribe(this.announce);
    this.timer = setInterval(this.announce, 15_000);
    this.announce();
  }

  hasConsumer(agentId: string) {
    return [...this.peers.values()].some((peer) => this.now() - peer.at < 45_000 && peer.agents.includes(agentId));
  }

  lock(agentId: string) {
    this.channel.postMessage({ sender: this.id, kind: 'lock', agentId, lockedAt: this.now() });
  }

  private announce = () => {
    this.channel.postMessage({ sender: this.id, kind: 'consumers', agents: this.state.consumingAgents() });
  };

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
    if (message.kind === 'lock') {
      if (typeof message.agentId !== 'string' || !Number.isFinite(message.lockedAt)) return;
      if (this.state.grants.has(message.agentId)) {
        this.state.invalidate(message.agentId);
      }
    }
  };

  dispose() {
    clearInterval(this.timer);
    this.unsubscribe();
    this.channel.postMessage({ sender: this.id, kind: 'consumers', agents: [] });
    this.channel.removeEventListener('message', this.receive);
    this.channel.close();
  }
}
