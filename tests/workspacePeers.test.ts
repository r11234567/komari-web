import assert from 'node:assert/strict';
import test from 'node:test';
import { WorkspaceState, type WorkspaceGrant } from '../src/utils/workspaceState.ts';
import { WorkspacePeers, type WorkspaceSyncResult } from '../src/utils/workspacePeers.ts';

function makeGrant(agentId: string, token: string, now = Date.now()): WorkspaceGrant {
  return {
    agentId,
    systemUser: 'alice',
    token,
    expiresAt: now + 30 * 60_000,
    idleExpiresAt: now + 3 * 60_000,
    controller: new AbortController(),
  };
}

function waitFor(condition: () => boolean, message: string) {
  return new Promise<void>((resolve, reject) => {
    const deadline = Date.now() + 2000;
    const poll = () => {
      if (condition()) { resolve(); return; }
      if (Date.now() > deadline) { reject(new Error(message)); return; }
      setTimeout(poll, 10).unref();
    };
    poll();
  });
}

test('workspace peers: coordinates consumers and locks across tabs without leaking grant tokens', async () => {
  const first = new WorkspaceState();
  const second = new WorkspaceState();
  const name = `workspace-unit-${crypto.randomUUID()}`;
  const wireMessages: unknown[] = [];
  const changedAgents: string[] = [];
  const spy = new BroadcastChannel(name);
  spy.addEventListener('message', (event) => wireMessages.push(event.data));
  const a = new WorkspacePeers(first, new BroadcastChannel(name));
  const b = new WorkspacePeers(second, new BroadcastChannel(name), Date.now, async (agentId) => {
    changedAgents.push(agentId);
    return { kind: 'none' };
  });
  const release = first.retain('SJC');
  const now = Date.now();
  try {
    first.knownAgents.add('SJC');
    second.knownAgents.add('SJC');
    second.knownAgents.add('FRA');
    first.install(makeGrant('SJC', 'secret-sjc-token', now));
    second.install(makeGrant('SJC', 'second-sjc-token', now));
    second.install(makeGrant('FRA', 'second-fra-token', now));

    await waitFor(() => b.hasConsumer('SJC'), 'consumer presence did not cross channel');

    a.notifyChanged('SJC');
    await waitFor(() => changedAgents.includes('SJC'), 'changed event did not cross channel');

    // A peer with no local grant also receives changed notifications to pull server state.
    const coldState = new WorkspaceState();
    const coldChanged: string[] = [];
    const coldPeer = new WorkspacePeers(coldState, new BroadcastChannel(name), Date.now, async (agentId) => {
      coldChanged.push(agentId);
      return { kind: 'none' };
    });
    try {
      a.notifyChanged('SJC');
      await waitFor(() => coldChanged.includes('SJC'), 'cold peer did not receive changed event');
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

test('workspace peers: drops out-of-order sync responses and stale unauthorized failures', async () => {
  const first = new WorkspaceState();
  const second = new WorkspaceState();
  const name = `workspace-unit-${crypto.randomUUID()}`;
  const requests: Array<{ agentId: string; signal: AbortSignal; resolve: (value: WorkspaceSyncResult) => void }> = [];

  const a = new WorkspacePeers(first, new BroadcastChannel(name));
  const b = new WorkspacePeers(second, new BroadcastChannel(name), Date.now, (agentId, signal) => (
    new Promise<WorkspaceSyncResult>((resolve) => {
      requests.push({ agentId, signal, resolve });
    })
  ));

  try {
    // Trigger sync #1, then supersede with sync #2.
    a.notifyChanged('SJC');
    await waitFor(() => requests.length === 1, 'first sync request did not start');
    a.notifyChanged('SJC');
    await waitFor(() => requests.length === 2, 'second sync request did not start');

    assert.equal(requests[0].signal.aborted, true, 'superseded sync must be aborted');
    assert.equal(requests[1].signal.aborted, false, 'latest sync must remain active');

    // Resolve sync #2 first, then resolve stale sync #1 with an older grant.
    requests[1].resolve({ kind: 'grant', grant: makeGrant('SJC', 'grant-v2') });
    await waitFor(() => second.grants.get('SJC')?.token === 'grant-v2', 'sync #2 did not install grant-v2');
    requests[0].resolve({ kind: 'grant', grant: makeGrant('SJC', 'grant-v1-stale') });
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(second.grants.get('SJC')?.token, 'grant-v2', 'stale sync response must not overwrite newer grant');

    // Trigger sync #3, then locally install grant-v3 before sync #3 returns unauthorized (401/403).
    a.notifyChanged('SJC');
    await waitFor(() => requests.length === 3, 'third sync request did not start');
    second.install(makeGrant('SJC', 'grant-v3-local'));
    assert.equal(requests[2].signal.aborted, true, 'local grant replacement must abort in-flight sync');
    requests[2].resolve({ kind: 'unauthorized' });
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(second.grants.get('SJC')?.token, 'grant-v3-local', 'stale 401/403 must not invalidate newer local grant');
  } finally {
    a.dispose();
    b.dispose();
  }
});

test('workspace peers: peer lock cancels in-flight sync on a cold tab with no local grant', async () => {
  const first = new WorkspaceState();
  const cold = new WorkspaceState();
  const name = `workspace-unit-${crypto.randomUUID()}`;
  let coldSignal: AbortSignal | undefined;
  let resolveCold!: (value: WorkspaceSyncResult) => void;

  const a = new WorkspacePeers(first, new BroadcastChannel(name));
  const b = new WorkspacePeers(cold, new BroadcastChannel(name), Date.now, (_agentId, signal) => (
    new Promise<WorkspaceSyncResult>((resolve) => {
      coldSignal = signal;
      resolveCold = resolve;
    })
  ));

  try {
    a.notifyChanged('SJC');
    await waitFor(() => coldSignal !== undefined, 'cold tab did not start server sync');
    assert.equal(cold.grants.has('SJC'), false);
    assert.equal(coldSignal!.aborted, false);

    // Peer locks before the cold tab's pull finishes.
    a.lock('SJC');
    await waitFor(() => coldSignal!.aborted === true, 'peer lock must abort cold-tab in-flight sync');

    // Even if the stale response resolves afterwards, it must never resurrect the locked workspace.
    resolveCold({ kind: 'grant', grant: makeGrant('SJC', 'resurrected-token') });
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(cold.grants.has('SJC'), false, 'cancelled cold-tab sync must not install locked grant');
  } finally {
    a.dispose();
    b.dispose();
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
