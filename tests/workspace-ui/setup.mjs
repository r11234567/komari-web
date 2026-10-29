import {JSDOM} from 'jsdom';
const dom=new JSDOM('<html><body></body></html>',{url:'https://unit.invalid/terminal',pretendToBeVisual:true});
for(const key of ['window','document','navigator','HTMLElement','Element','Node','NodeFilter','HTMLInputElement','HTMLButtonElement','CustomEvent','Event','KeyboardEvent','MutationObserver','getComputedStyle','localStorage']){
 Object.defineProperty(globalThis,key,{configurable:true,value:key==='getComputedStyle'?dom.window.getComputedStyle.bind(dom.window):dom.window[key]});
}
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true,requestAnimationFrame:(fn)=>setTimeout(()=>fn(0),0),cancelAnimationFrame:clearTimeout,BroadcastChannel:undefined});
Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});

globalThis.workspaceTestDOM=dom;
