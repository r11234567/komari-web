// Install DOM globals before React/Radix modules decide whether portals exist.
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<html><body></body></html>', { url: 'https://unit.invalid/', pretendToBeVisual: true });
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'NodeFilter', 'HTMLInputElement', 'HTMLButtonElement', 'HTMLFormElement', 'HTMLSelectElement', 'HTMLOptionElement', 'HTMLTextAreaElement', 'SVGElement', 'DocumentFragment', 'CustomEvent', 'Event', 'KeyboardEvent', 'MutationObserver', 'getComputedStyle', 'localStorage']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === 'getComputedStyle' ? dom.window.getComputedStyle.bind(dom.window) : dom.window[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, requestAnimationFrame: (fn) => setTimeout(() => fn(0), 0), cancelAnimationFrame: clearTimeout, BroadcastChannel: undefined });
globalThis.fetch = async () => { throw new Error('CI unit transport forbids external requests'); };
