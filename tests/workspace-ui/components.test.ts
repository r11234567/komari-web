import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {act,createElement as h} from 'react';
import {createRoot} from 'react-dom/client';
import {createPortal} from 'react-dom';
import {Theme} from '@radix-ui/themes';
import {I18nextProvider} from 'react-i18next';
import i18next from 'i18next';
import TerminalPageBoundary from '../../src/pages/terminal/TerminalPageBoundary.tsx';
import EditorResourceMonitor from '../../src/pages/terminal/EditorResourceMonitor.tsx';
import TerminalResourceMonitor from '../../src/pages/terminal/TerminalResourceMonitor.tsx';
import {AgentStatus} from '@komari/proto/komari/browser/v1/browser_pb';
import {workspaceState,unlockCalls} from './workspace.ts';
import {credentialCalls} from './trusted.ts';
import {emitStatus,streamCalls} from './connect.ts';

const dom=globalThis.workspaceTestDOM;
const i18n=i18next.createInstance();
await i18n.init({lng:'en',fallbackLng:'en',resources:{en:{translation:{
 'account':{'native_otp':{provider:'Credential',no_provider:'Choose credential',begin:'Send code',enter_code:'Verification code',verify:'Verify',cancel:'Restart'}},
 'nodeCard':{offline:'Offline'},
 'terminal':{resource_monitor:{waiting:'Waiting for data',title:'Resource monitor'}},
}}},interpolation:{escapeValue:false}});
function wrap(child:ReturnType<typeof h>){return h(I18nextProvider,{i18n},h(Theme,{accentColor:'blue',appearance:'dark'},h(TerminalPageBoundary,null,child)));}
function button(text:string){const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent===text);assert.ok(b,'missing button '+text);return b;}
async function settle(){await act(async()=>{await new Promise(resolve=>setTimeout(resolve,15));});}

test('file-only workspace verifies above the editor portal with themed interactive OTP and scoped unlock',async()=>{
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host);
 const editor=document.createElement('div');editor.dataset.testEditor='true';editor.style.cssText='position:fixed;inset:0;z-index:100000';
 try{
  await act(async()=>root.render(wrap(h('div',null,createPortal(h('div',null,'File editor without SSH'),editor)))));
  document.body.appendChild(editor);
  await act(async()=>workspaceState.requestUnlock('synthetic-node'));
  await settle();
  const dialog=document.querySelector<HTMLElement>('[role="dialog"][aria-labelledby]');assert.ok(dialog,'missing accessible Radix dialog');
  assert.equal(host.contains(dialog),false,'unlock remains in original stacking context');
  const overlay=dialog.closest<HTMLElement>('.km-workspace-unlock-overlay');assert.ok(overlay);
  assert.ok(Number(overlay.style.zIndex)>Number(editor.style.zIndex),'editor covers verification');
  assert.ok(dialog.closest('.radix-themes'),'portal lost Komari theme');
  assert.ok(dialog.querySelector('.rt-Card'),'unlock does not use Komari card');
  const input=dialog.querySelector<HTMLInputElement>('input[autocomplete="username"]');assert.ok(input);
  await settle();assert.equal(document.activeElement,input,'username not focused above file editor');
  await act(async()=>{
   const setter=Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value')!.set!;
   setter.call(input,'alice');input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  });
  await act(async()=>button('验证并解锁').click());await settle();
  const begin=button('Send code');assert.ok(begin.classList.contains('rt-Button'),'OTP action lost theme');
  await act(async()=>begin.click());await settle();
  const code=document.querySelector<HTMLInputElement>('input[autocomplete="one-time-code"]');assert.ok(code,'OTP input hidden or not rendered');
  assert.equal(dialog.contains(code),true);
  await act(async()=>{
   Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value')!.set!.call(code,'AB12CD34');
   code.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  });
  await act(async()=>button('Verify').click());await settle();
  assert.deepEqual(unlockCalls.at(-1),{agent:'synthetic-node',user:'alice',token:'synthetic-scoped-proof'});
  const beginRequest=credentialCalls.find(c=>c.method==='begin')!.request as {resource:string};
  assert.equal(beginRequest.resource,'workspace:'+JSON.stringify(['synthetic-node','alice']));
  assert.equal(document.querySelector('.km-workspace-unlock'),null,'completed dialog still blocks editor');
 }finally{await act(async()=>root.unmount());host.remove();editor.remove();}
});

test('terminal page shares a single real live provider with editor portal and preserves actual offline status',async()=>{
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host);
 const portal=document.createElement('div');document.body.appendChild(portal);
 const before=streamCalls.length;
 try{
  await act(async()=>root.render(wrap(h('div',null,
   createPortal(h(EditorResourceMonitor,{uuid:'node-live'}),portal),
   h(TerminalResourceMonitor,{clients:[{uuid:'node-live',name:'Live node',os:'Linux'}],servers:['node-live'],onRemove:()=>{}})
  ))));await settle();
  assert.equal(streamCalls.length-before,1,'terminal route omitted or duplicated live stream');
  assert.ok(portal.textContent?.includes('Waiting for data'),'missing data mislabeled offline');
  assert.ok(!portal.textContent?.includes('Offline'));
  await act(async()=>emitStatus({agent:{agentId:'node-live',status:AgentStatus.ONLINE,eventId:'one'},latestReport:undefined}));await settle();
  assert.ok(portal.textContent?.includes('CPU'),'editor portal never received live status');
  assert.ok(host.textContent?.includes('CPU'),'terminal monitor never received same stream');
  assert.ok(!portal.textContent?.includes('Offline'));
  await act(async()=>emitStatus({agent:{agentId:'node-live',status:AgentStatus.OFFLINE,eventId:'two'},latestReport:undefined}));await settle();
  assert.ok(portal.textContent?.includes('Offline'),'explicit offline status was overridden by file connection');
  assert.ok(host.textContent?.includes('Offline'));
  assert.equal(streamCalls.length-before,1,'monitor updates started polling/new streams');
 }finally{await act(async()=>root.unmount());host.remove();portal.remove();}
 assert.equal(streamCalls.at(-1)?.signal.aborted,true,'page unmount leaked status stream');
 // Supplement actual component execution with route wiring checks; never a substitute for it.
 const source=readFileSync(new URL('../../src/pages/terminal/index.tsx',import.meta.url),'utf8');
 assert.match(source,/<TerminalPageBoundary><TerminalWorkbench \/><\/TerminalPageBoundary>/);
 assert.match(source,/<TerminalPageBoundary><TerminalLegacy \/><\/TerminalPageBoundary>/);
});
