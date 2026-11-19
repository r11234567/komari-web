import assert from 'node:assert/strict';
import test from 'node:test';
import { WorkspaceState } from '../src/utils/workspaceState.ts';
import { WorkspacePeers } from '../src/utils/workspacePeers.ts';

test('workspace peers: coordinates consumers and locks across tabs without leaking grant tokens', async () => {
  const first = new WorkspaceState();
  const second = new WorkspaceState();
  const name = `workspace-unit-${crypto.randomUUID()}`;
  const wireMessages: unknown[] = [];
  const changedAgents: string[] = [];
  const spy = new BroadcastChannel(name);
  spy.addEventListener('message', (event) => wireMessages.push(event.data));
  const a = new WorkspacePeers(first, new BroadcastChannel(name));
  const b = new WorkspacePeers(second, new BroadcastChannel(name), Date.now, (agentId) => {
    changedAgents.push(agentId);
  });
  const release = first.retain('SJC');
  const now = Date.now();
  try {
    first.knownAgents.add('SJC');
    second.knownAgents.add('SJC');
    second.knownAgents.add('FRA');
    first.install({
      agentId: 'SJC',
      systemUser: 'alice',
      token: 'secret-sjc-token',
      expiresAt: now + 30 * 60_000,
      idleExpiresAt: now + 3 * 60_000,
      controller: new AbortController(),
    });
    second.install({
      agentId: 'SJC',
      systemUser: 'alice',
      token: 'second-sjc-token',
      expiresAt: now + 30 * 60_000,
      idleExpiresAt: now + 3 * 60_000,
      controller: new AbortController(),
    });
    second.install({
      agentId: 'FRA',
      systemUser: 'alice',
      token: 'second-fra-token',
      expiresAt: now + 30 * 60_000,
      idleExpiresAt: now + 3 * 60_000,
      controller: new AbortController(),
    });

    await new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + 2000;
      const poll = () => {
        if (b.hasConsumer('SJC')) { resolve(); return; }
        if (Date.now() > deadline) { reject(new Error('consumer presence did not cross channel')); return; }
        setTimeout(poll, 10).unref();
      };
      poll();
    });

    const changed = new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + 2000;
      const poll = () => {
        if (changedAgents.includes('SJC')) { resolve(); return; }
        if (Date.now() > deadline) { reject(new Error('changed event did not cross channel')); return; }
        setTimeout(poll, 10).unref();
      };
      poll();
    });
    a.notifyChanged('SJC');
    await changed;

    // A peer with no local grant also receives changed notifications to pull server state.
    const coldState = new WorkspaceState();
    const coldChanged: string[] = [];
    const coldPeer = new WorkspacePeers(coldState, new BroadcastChannel(name), Date.now, (agentId) => {
      coldChanged.push(agentId);
    });
    try {
      const coldDone = new Promise<void>((resolve, reject) => {
        const deadline = Date.now() + 2000;
        const poll = () => {
          if (coldChanged.includes('SJC')) { resolve(); return; }
          if (Date.now() > deadline) { reject(new Error('cold peer did not receive changed event')); return; }
          setTimeout(poll, 10).unref();
        };
        poll();
      });
      a.notifyChanged('SJC');
      await coldDone;
      assert.equal(coldState.grants.has('SJC'), false, 'channel must not install grants directly');
    } finally {
      coldPeer.dispose();
    }

    const locked = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('lock did not cross channel')), 2000).unref();
      const off = second.subscribe(() => {
        if (!second.grants.has('SJC')) {
          clearTimeout(timer);
          off();
          resolve();
        }
      });
    });
    a.lock('SJC');
    await locked;

    assert.equal(second.grants.has('SJC'), false);
    assert.equal(second.grants.get('FRA')?.controller.signal.aborted, false);
    assert.equal(JSON.stringify(wireMessages).includes('secret-sjc-token'), false, 'grant tokens must never cross BroadcastChannel');
    assert.equal(JSON.stringify(wireMessages).includes('second-sjc-token'), false, 'peer grant tokens must never cross BroadcastChannel');
  } finally {
    release();
    a.dispose();
    b.dispose();
    spy.close();
  }
});

test('workspace peers: ignores spoofed grant messages pushed onto the channel', async () => {
  const state = new WorkspaceState();
  const name = `workspace-unit-${crypto.randomUUID()}`;
  const receiver = new BroadcastChannel(name);
  const sender = new BroadcastChannel(name);
  const peer = new WorkspacePeers(state, receiver);
  const now = Date.now();
  state.knownAgents.add('SJC');
  try {
    await new Promise<void>((resolve, reject) => {
      const id = crypto.randomUUID();
      const timer = setTimeout(() => reject(new Error('channel delivery timed out')), 2000).unref();
      const onMessage = (event: MessageEvent) => {
        if (event.data?.sender !== id) return;
        clearTimeout(timer);
        receiver.removeEventListener('message', onMessage);
        resolve();
      };
      receiver.addEventListener('message', onMessage);
      sender.postMessage({
        sender: id,
        kind: 'grant',
        grant: {
          agentId: 'SJC',
          systemUser: 'root',
          token: 'injected-token',
          expiresAt: now + 60_000,
          idleExpiresAt: now + 60_000,
        },
      });
    });
    assert.equal(state.grants.has('SJC'), false, 'channel must never install remote grants');
  } finally {
    peer.dispose();
    sender.close();
  }
});
