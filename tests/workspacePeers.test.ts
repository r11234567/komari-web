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

test('workspace peers: delayed lock cannot revoke a newer grant and revoked grants cannot be replayed', async () => {
 const state = new WorkspaceState();
 const name = `workspace-unit-${crypto.randomUUID()}`;
 const receiver = new BroadcastChannel(name);
 const sender = new BroadcastChannel(name);
 const peer = new WorkspacePeers(state, receiver);
 const now = Date.now();
 const fresh = {agentId:'SJC',systemUser:'alice',token:'new-sjc',expiresAt:now+30*60_000,idleExpiresAt:now+3*60_000};
 state.knownAgents.add('SJC'); state.knownAgents.add('FRA');
 state.install({...fresh,controller:new AbortController()});
 state.install({...fresh,agentId:'FRA',token:'fra-unrelated',controller:new AbortController()});
 // Wait for actual delivery through the receiving channel, after the real
 // WorkspacePeers handler, rather than sleeping and assuming it ran.
 const deliver = async (message: Record<string, unknown>) => {
  const id = crypto.randomUUID();
  await new Promise<void>((resolve,reject) => {
   const timer = setTimeout(() => {receiver.removeEventListener('message',received);reject(new Error('channel delivery timed out'));},2000);
   const received = (event: MessageEvent) => {
    if (event.data.sender !== id) return;
    clearTimeout(timer);receiver.removeEventListener('message',received);resolve();
   };
   receiver.addEventListener('message',received);
   sender.postMessage({...message,sender:id});
  });
 };
 try {
  await deliver({kind:'lock',agentId:'SJC',token:'old-sjc'});
  assert.equal(state.grants.get('SJC')?.token,'new-sjc');
  await deliver({kind:'grant',grant:{...fresh,token:'old-sjc',expiresAt:fresh.expiresAt+1000}});
  assert.equal(state.grants.get('SJC')?.token,'new-sjc','revoked old token must not win by a later timestamp');
  await deliver({kind:'lock',agentId:'SJC',token:'new-sjc'});
  assert.equal(state.grants.has('SJC'),false);
  await deliver({kind:'grant',grant:fresh});
  assert.equal(state.grants.has('SJC'),false,'late grant must not resurrect revoked authorization');
  assert.equal(state.grants.get('FRA')?.controller.signal.aborted,false);
  assert.equal(state.promptAgent,undefined);
 } finally {peer.dispose();sender.close();}
});
