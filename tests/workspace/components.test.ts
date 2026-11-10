import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import TerminalSession from '../../src/pages/terminal/TerminalSession.tsx';
import WorkspaceBoundary from '../../src/pages/terminal/WorkspaceBoundary.tsx';
import { rememberWorkspaceSession, workspaceSessionAccess, workspaceSessionValid, workspaceState } from '../../src/api/connect/workspace.ts';
import { terminals, starts, failures, waitingForAttachment, attachRemoteSession } from './peripherals.ts';

// DOM setup runs in register.mjs before static React/Radix imports.
// No real panel, production credentials, operating-system shell or browser.
await i18next.use(initReactI18next).init({ lng: 'en', resources: {}, initImmediate: false });
const grant = (agentId: string, token: string) => ({ agentId, token, systemUser: 'alice', expiresAt: Date.now() + 30*60_000, idleExpiresAt: Date.now() + 3*60_000, controller: new AbortController() });
const session = (uuid: string, active = true) => createElement(TerminalSession, { key: uuid, uuid, active, twoFaEnabled: true, disconnectMessage: 'closed', onApiChange: () => {} });

test('real TerminalSession: SJC locks silently without rebuilding either renderer or disrupting FRA', async () => {
  const host = document.createElement('div'); document.body.appendChild(host);
  const root = createRoot(host);
  workspaceState.install(grant('SJC', 'sjc-first')); workspaceState.install(grant('FRA', 'fra-first'));
  try {
    await act(async () => { root.render(createElement('div', null, session('SJC'), session('FRA'))); });
    assert.equal(terminals.length, 2); assert.deepEqual(starts, ['SJC', 'FRA']);
    terminals[0].write('alice@SJC:~/keep-this-directory$ ');
    terminals[1].write('alice@FRA:~$ ');
    await act(async () => { workspaceState.invalidate('SJC'); });
    assert.equal(workspaceState.pending.size, 0);
    assert.equal(workspaceState.promptAgent, undefined);
    assert.equal(terminals.length, 2, 'locking must not recreate Xterm');
    assert.equal(terminals[0].disposed, false); assert.equal(terminals[1].disposed, false);
    assert.equal(terminals[0].options.disableStdin, true);
    assert.equal(terminals[1].options.disableStdin, false, 'FRA was locked by SJC');
    assert.equal(host.querySelector('[data-workspace-agent="FRA"] [inert]'), null);
    assert.equal(host.querySelector('[data-workspace-agent="SJC"] [inert]') !== null, true);
    await act(async () => { workspaceState.install(grant('SJC', 'sjc-new')); });
    assert.equal(terminals.length, 2, 'unlock must retain the renderer');
    assert.equal(terminals[0].text.includes('keep-this-directory'), true);
    assert.deepEqual(starts, ['SJC', 'FRA', 'SJC']);
    assert.equal(terminals[1].text, 'alice@FRA:~$ ');
    assert.equal(terminals[1].options.disableStdin, false);
  } finally { await act(async () => root.unmount()); host.remove(); }
  assert.equal(terminals.every(t => t.disposed), true);
});

test('real WorkspaceBoundary: cancellation never reveals another machine or makes page inert', async () => {
  const host = document.createElement('div'); document.body.appendChild(host);
  const root = createRoot(host);
  const pending = workspaceState.authorize('third-machine');
  const other = workspaceState.authorize('fourth-machine');
  // Register rejection handlers before rendering effects can cancel waiters.
  const pendingRejected = assert.rejects(pending, { name: 'AbortError' });
  const otherRejected = assert.rejects(other, { name: 'AbortError' });
  try {
    await act(async () => { root.render(createElement(WorkspaceBoundary, null, createElement('button', { id: 'fra-control' }, 'FRA'))); });
    assert.equal(host.querySelector('#fra-control')?.closest('[inert]'), null);
    const dialog = document.querySelector('[role="dialog"]');
    assert.ok(dialog, 'the actual Radix portal must render');
    assert.equal(host.contains(dialog), false, 'unlock must use the portal');
    assert.ok(dialog.getAttribute('aria-labelledby'), 'unlock must have an accessible title');
    assert.ok(dialog.textContent?.includes('third-machine'));
    assert.equal(dialog.textContent?.includes('fourth-machine'), false);
    await act(async () => { workspaceState.cancel('third-machine'); await pendingRejected; });
    assert.equal(document.querySelector('[role="dialog"]'), null, 'Esc/cancel must not drain a hidden prompt queue');
    assert.equal(host.closest('[inert], [aria-hidden="true"]'), null, 'cancel must restore the page');
    assert.equal(workspaceState.pending.has('fourth-machine'), true);
  } finally {
    await act(async () => { workspaceState.cancel('fourth-machine'); await otherRejected; root.unmount(); }); host.remove();
  }
});

test('cold TerminalSession keeps input disabled through appearance changes until attachment and after locking', async () => {
  const host = document.createElement('div'); document.body.appendChild(host);
  const root = createRoot(host);
  const before = terminals.length;
  waitingForAttachment.add('cold-start');
  workspaceState.install(grant('cold-start', 'cold-first'));
  const render = (fontSize: number) => createElement(TerminalSession, {
    uuid: 'cold-start', active: true, twoFaEnabled: true,
    disconnectMessage: 'closed', onApiChange: () => {},
    fontSize, options: { disableStdin: false },
  });
  try {
    await act(async () => { root.render(render(14)); });
    const terminal = terminals[before];
    assert.equal(terminal.options.disableStdin, true, 'create/heartbeat is not attachment');
    await act(async () => { root.render(render(18)); });
    assert.equal(terminal.options.disableStdin, true, 'appearance must not enable a cold terminal');
    await act(async () => { attachRemoteSession('cold-start'); });
    assert.equal(terminal.options.disableStdin, false, 'real attachment enables input');
    await act(async () => { workspaceState.invalidate('cold-start'); });
    await act(async () => { root.render(render(20)); });
    assert.equal(terminal.options.disableStdin, true, 'appearance must not unlock a locked terminal');
    assert.equal(terminals.length, before + 1, 'appearance must retain the renderer');
  } finally {
    await act(async () => root.unmount()); host.remove();
    waitingForAttachment.delete('cold-start');
  }
});

test('real TerminalSession: failed creation does not immediately retry or consume credential capacity', async () => {
  const host = document.createElement('div'); document.body.appendChild(host);
  const root = createRoot(host);
  const before = starts.length;
  failures.add('unavailable');
  workspaceState.install(grant('unavailable', 'unavailable-first'));
  try {
    await act(async () => { root.render(session('unavailable')); });
    // Drain effects/microtasks again: a self-restarting create would not settle.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    assert.deepEqual(starts.slice(before), ['unavailable']);
    assert.equal(workspaceState.pending.has('unavailable'), false);
  } finally { failures.delete('unavailable'); await act(async () => root.unmount()); host.remove(); }
});

test('actual session binding rejects a delayed create from an old grant and retains renewed deadlines', () => {
  const original = grant('binding', 'binding-old');
  workspaceState.install(original);
  rememberWorkspaceSession('old-session', 'binding', original.token);
  workspaceState.install({ ...original, idleExpiresAt: original.idleExpiresAt + 10_000 });
  assert.equal(workspaceSessionValid('old-session'), true);
  assert.equal(workspaceSessionAccess('old-session', new AbortController().signal).signal.aborted, false);
  workspaceState.install(grant('binding', 'binding-new'));
  assert.throws(() => rememberWorkspaceSession('delayed-session', 'binding', original.token), /Workspace locked/);
  assert.equal(workspaceSessionValid('old-session'), false);
  assert.throws(() => workspaceSessionAccess('old-session', new AbortController().signal), /Workspace locked/);
});
