import {JSDOM} from 'jsdom';
const dom=new JSDOM('<html><body></body></html>',{url:'https://unit.invalid/terminal',pretendToBeVisual:true});
for(const key of ['window','document','navigator','HTMLElement','Element','Node','NodeFilter','HTMLInputElement','HTMLButtonElement','HTMLFormElement','HTMLSelectElement','HTMLOptionElement','HTMLTextAreaElement','SVGElement','DocumentFragment','CustomEvent','Event','KeyboardEvent','MutationObserver','getComputedStyle','localStorage']){
 Object.defineProperty(globalThis,key,{configurable:true,value:key==='getComputedStyle'?dom.window.getComputedStyle.bind(dom.window):dom.window[key]});
}
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true,requestAnimationFrame:(fn)=>setTimeout(()=>fn(0),0),cancelAnimationFrame:clearTimeout,BroadcastChannel:undefined});
Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});
// JSDOM has no layout engine; these tests do not resize Radix scroll areas.
// Keep actual dialog, select and focus behavior; only omit layout observation.
globalThis.ResizeObserver=class {
 observe() {}
 unobserve() {}
 disconnect() {}
};

globalThis.workspaceTestDOM=dom;

// Fail at the first React render loop rather than filling logs until job timeout.
const reportError=console.error;
console.error=(...args)=>{
 if(args.some(value=>String(value).includes('Maximum update depth exceeded')))throw new Error('React render loop: '+args.join(' '));
 reportError(...args);
};
