import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import AgentCredentialLifecycle from '../../src/components/admin/AgentCredentialLifecycle.tsx';
import { applyCredentialLifecycle, credentialLifecyclePath, validCredentialPolicy } from '../../src/api/credentialLifecycle.ts';
import type { AgentCredentialStatus, CredentialLifecycle, CredentialPolicy } from '../../src/api/credentialLifecycle.ts';
import { CredentialPurpose } from '@komari/proto/komari/credential/v1/credential_pb';

const dom=new JSDOM('<html><body></body></html>',{url:'https://unit.invalid/',pretendToBeVisual:true});
for(const key of ['window','document','navigator','HTMLElement','Element','HTMLInputElement','MutationObserver','getComputedStyle']){
 Object.defineProperty(globalThis,key,{configurable:true,value:key==='getComputedStyle'?dom.window.getComputedStyle.bind(dom.window):dom.window[key as keyof Window]});
}
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true,requestAnimationFrame:(fn:FrameRequestCallback)=>setTimeout(()=>fn(0),0),cancelAnimationFrame:clearTimeout});
const policy:CredentialPolicy={revision:1,idle_days:7,absolute_days:180,migration_grace_days:30,warning_days:14};
const agent:AgentCredentialStatus={agent_id:'node-A',name:'Synthetic node A',generation:9,protocol:2,fingerprint:'A'.repeat(43),status:'expired',access_expires_at:'2026-01-01T00:00:00Z',idle_expires_at:'2026-01-07T00:00:00Z',absolute_expires_at:'2026-07-01T00:00:00Z',last_refresh_at:'2026-01-01T00:00:00Z',migration_grace_until:null,recovery_until:null,last_approved_at:null,can_reapprove:true};
function fixture():CredentialLifecycle{return{policy:{...policy},credentials:[{...agent},{...agent,agent_id:'node-B',name:'Revoked B',status:'revoked',can_reapprove:false}],total:2,page:1,page_size:100};}
function button(host:HTMLElement,text:string):HTMLButtonElement{
 const found=Array.from(host.querySelectorAll('button')).find(b=>b.textContent===text);assert.ok(found,'missing button: '+text);return found;
}

test('real credential component requires fresh scoped verification and posts frozen policy',async()=>{
 const calls:{url:string;init?:RequestInit}[]=[];
 globalThis.fetch=async(input,init)=>{
  calls.push({url:String(input),init});
  return Response.json({status:'success',data:init?.method==='POST'?policy:fixture()});
 };
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host);
 try{
  await act(async()=>root.render(createElement(AgentCredentialLifecycle)));
  assert.equal(calls.length,1);
  assert.ok(host.textContent?.includes('RT'));
  await act(async()=>button(host,'验证并保存策略').click());
  assert.equal(calls.length,1,'clicking Save must not mutate before credential verification');
  const proof=host.querySelector<HTMLButtonElement>('[data-proof-resource]');assert.ok(proof);
  assert.equal(proof.dataset.proofResource,'rest:POST:'+credentialLifecyclePath+'/policy');
  assert.equal(Number(proof.dataset.proofPurpose),CredentialPurpose.SENSITIVE_OPERATION);
  assert.equal(host.querySelector<HTMLInputElement>('input')?.disabled,true,'policy inputs changed during verification');
  await act(async()=>proof.click());
  const post=calls.find(c=>c.init?.method==='POST');assert.ok(post);
  assert.equal(post.url,credentialLifecyclePath+'/policy');
  assert.equal(new Headers(post.init?.headers).get('X-Komari-Credential-Authorization'),'synthetic-completed-proof');
  assert.equal(post.init?.credentials,'same-origin');
  assert.deepEqual(JSON.parse(String(post.init?.body)),policy);
  assert.ok(post.init?.signal instanceof AbortSignal);
  assert.equal(host.querySelector('[data-proof-resource]'),null);
  const after=calls.length;await act(async()=>new Promise(resolve=>setTimeout(resolve,30)));
  assert.equal(calls.length,after,'management UI must not poll');
 }finally{await act(async()=>root.unmount());host.remove();}
});

test('real credential component binds reapproval to selected generation and disables revoked nodes',async()=>{
 const calls:{url:string;init?:RequestInit}[]=[];
 globalThis.fetch=async(input,init)=>{calls.push({url:String(input),init});return Response.json({status:'success',data:init?.method==='POST'?{accepted:true}:fixture()});};
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host);
 try{
  await act(async()=>root.render(createElement(AgentCredentialLifecycle)));
  const rows=host.querySelectorAll('tbody tr');
  const active=rows[0].querySelector('button')!;const revoked=rows[1].querySelector('button')!;
  assert.equal(revoked.disabled,true);
  await act(async()=>active.click());
  const proof=host.querySelector<HTMLButtonElement>('[data-proof-resource]');assert.ok(proof);
  assert.equal(proof.dataset.proofResource,'rest:POST:'+credentialLifecyclePath+'/node-A/reapprove');
  assert.ok(host.textContent?.includes('Synthetic node A'));
  await act(async()=>proof.click());
  const post=calls.find(c=>c.init?.method==='POST');assert.ok(post);
  assert.equal(post.url,credentialLifecyclePath+'/node-A/reapprove');
  assert.deepEqual(JSON.parse(String(post.init?.body)),{generation:9,fingerprint:'A'.repeat(43)});
 }finally{await act(async()=>root.unmount());host.remove();}
});

test('credential policy bounds and missing-proof checks reject before network mutation',async()=>{
 assert.equal(validCredentialPolicy(policy),true);
 for(const patch of [{idle_days:0},{idle_days:31},{idle_days:1.5},{absolute_days:366},{migration_grace_days:0},{warning_days:31},{revision:0}]){
  assert.equal(validCredentialPolicy({...policy,...patch}),false);
 }
 let calls=0;globalThis.fetch=async()=>{calls++;throw new Error('must not send');};
 await assert.rejects(applyCredentialLifecycle({kind:'policy',policy},'',new AbortController().signal),/验证/);
 await assert.rejects(applyCredentialLifecycle({kind:'policy',policy:{...policy,idle_days:0}},'synthetic',new AbortController().signal),/无效/);
 assert.equal(calls,0);
});
