import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import TerminalSession from '../../src/pages/terminal/TerminalSession.tsx';
import WorkspaceBoundary from '../../src/pages/terminal/WorkspaceBoundary.tsx';
import { workspaceState } from '../../src/api/connect/workspace.ts';
import { terminals, starts } from './peripherals.ts';

// No real panel, production credentials, operating-system shell or browser.
const dom = new JSDOM('<html><body></body></html>', { url: 'https://unit.invalid/', pretendToBeVisual: true });
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'HTMLInputElement', 'MutationObserver', 'getComputedStyle']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === 'getComputedStyle' ? dom.window.getComputedStyle.bind(dom.window) : dom.window[key as keyof Window] });
}
globalThis.fetch = async () => { throw new Error('CI unit transport forbids external requests'); };
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, requestAnimationFrame: (fn: FrameRequestCallback) => setTimeout(() => fn(0), 0), cancelAnimationFrame: clearTimeout });
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
  try {
    await act(async () => { root.render(createElement(WorkspaceBoundary, null, createElement('button', { id: 'fra-control' }, 'FRA'))); });
    assert.equal(host.querySelector('#fra-control')?.closest('[inert]'), null);
    assert.equal(host.querySelector('[role="dialog"]')?.getAttribute('aria-modal'), 'false');
    await act(async () => { workspaceState.cancel('third-machine'); await assert.rejects(pending); });
    assert.equal(host.querySelector('[role="dialog"]'), null, 'Esc/cancel must not drain a hidden prompt queue');
    assert.equal(workspaceState.pending.has('fourth-machine'), true);
  } finally {
    await act(async () => { workspaceState.cancel('fourth-machine'); await assert.rejects(other); root.unmount(); }); host.remove();
  }
});
