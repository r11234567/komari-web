import assert from 'node:assert/strict';
import test from 'node:test';
import { WorkspaceState } from '../src/utils/workspaceState.ts';
import { WorkspacePeers } from '../src/utils/workspacePeers.ts';

// Real BroadcastChannel delivery, with independent state stores as two windows.
test('workspace peers: same-machine grants/renewals cross windows, other machines stay isolated', async () => {
 const first = new WorkspaceState(), second = new WorkspaceState();
 const name = `workspace-unit-${crypto.randomUUID()}`;
 const a = new WorkspacePeers(first,new BroadcastChannel(name));
 const b = new WorkspacePeers(second,new BroadcastChannel(name));
 const controller = new AbortController();
 const awaiting = second.authorize('SJC',controller.signal);
 first.knownAgents.add('SJC'); first.knownAgents.add('FRA');
 const release = first.retain('SJC');
 const now=Date.now();
 try {
  first.install({agentId:'SJC',systemUser:'alice',token:'synthetic-sjc',expiresAt:now+30*60_000,idleExpiresAt:now+3*60_000,controller:new AbortController()});
  const received=await Promise.race([awaiting,new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error('grant did not cross actual channel')),2000).unref())]);
  assert.equal(received.token,'synthetic-sjc'); assert.equal(second.grants.has('FRA'),false);
  assert.equal(b.hasConsumer('SJC'),true);
  const refreshed=new Promise<void>((resolve)=>{ const off=second.subscribe(()=>{if(second.grants.get('SJC')?.idleExpiresAt===now+4*60_000){off();resolve();}}); });
  const old=first.grants.get('SJC')!;
  first.install({...old,idleExpiresAt:now+4*60_000});
  await Promise.race([refreshed,new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error('renewal not shared')),2000).unref())]);
  assert.equal(second.grants.get('SJC')?.token,old.token);
  assert.equal(second.grants.get('SJC')?.controller.signal.aborted,false);
 } finally { controller.abort();release();a.dispose();b.dispose(); }
});
