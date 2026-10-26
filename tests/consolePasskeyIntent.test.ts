import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import {
  clearConsolePasskeyIntent,
  consumeConsolePasskeyIntent,
  markConsolePasskeyIntent,
} from "../src/utils/consolePasskeyIntent.ts";

const KEY = "komari:console-passkey-intent";
const NOW = 1_800_000_000_000;
function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

test("console Passkey intent is scoped to its page and consumed once", () => {
  const storage = memoryStorage();
  markConsolePasskeyIntent("/?view=compact", { storage, now: NOW });
  assert.equal(consumeConsolePasskeyIntent("/?view=compact", { storage, now: NOW + 100 }), true);
  assert.equal(consumeConsolePasskeyIntent("/?view=compact", { storage, now: NOW + 100 }), false);
  for (const path of ["/bind-login", "/login", "/?view=other"]) {
    markConsolePasskeyIntent("/?view=compact", { storage, now: NOW });
    assert.equal(consumeConsolePasskeyIntent(path, { storage, now: NOW }), false);
  }
});

test("missing, expired, future and malformed intents never navigate", () => {
  const storage = memoryStorage();
  for (const raw of [null, "", "null", "{}", "broken", "0",
    JSON.stringify({ path: "/", startedAt: String(NOW) }),
    JSON.stringify({ path: "/", startedAt: NOW - 60_001 }),
    JSON.stringify({ path: "/", startedAt: NOW + 1 })]) {
    if (raw !== null) storage.setItem(KEY, raw);
    assert.equal(consumeConsolePasskeyIntent("/", { storage, now: NOW }), false);
    assert.equal(storage.getItem(KEY), null);
  }
});

test("browser default uses window.sessionStorage without a bare storage global", () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const storage = memoryStorage();
  Object.defineProperty(globalThis, "window", { configurable: true, value: { sessionStorage: storage } });
  try {
    markConsolePasskeyIntent("/", { now: NOW });
    assert.notEqual(storage.getItem(KEY), null);
    assert.equal(consumeConsolePasskeyIntent("/", { now: NOW }), true);
    markConsolePasskeyIntent("/", { now: NOW });
    clearConsolePasskeyIntent();
    assert.equal(storage.getItem(KEY), null);
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { get sessionStorage() { throw new Error("Storage disabled"); } },
    });
    assert.doesNotThrow(() => markConsolePasskeyIntent("/"));
    assert.equal(consumeConsolePasskeyIntent("/"), false);
    assert.doesNotThrow(() => clearConsolePasskeyIntent());
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

// Execute the real component with hook adapters. No browser or WebAuthn is
// simulated here: these tests cover branch/effect ownership after account load.
const componentCode = ts.transpileModule(
  readFileSync(new URL("../src/components/Login.tsx", import.meta.url), "utf8") +
    "\nexport { LoginDialogContent as TestDialog };",
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } },
).outputText;

function dialogHarness() {
  const storage = memoryStorage();
  const options = { storage, now: NOW };
  const navigation: string[] = [];
  const effects: Array<() => void> = [];
  let state = { account: { logged_in: false }, loading: false, error: null as Error | null };
  const exports: any = {};
  class TestElement {
    closest(selector: string) { return selector === ".km-passkey-login" ? this : null; }
  }
  const sandbox = {
    exports, Element: TestElement,
    window: { location: { pathname: "/", search: "", assign: (path: string) => navigation.push(path) } },
    require(name: string): any {
      if (name === "react") return {
        useState: (initial: unknown) => [initial, () => {}],
        useEffect: (effect: () => void) => effects.push(effect),
        useCallback: (callback: unknown) => callback,
        useId: () => "test-field",
      };
      if (name === "react/jsx-runtime") {
        const jsx = (type: unknown, props: any) => ({ type, props });
        return { jsx, jsxs: jsx };
      }
      if (name === "@/contexts/AccountContext") return { useAccount: () => ({ ...state, refresh: async () => {} }) };
      if (name === "@/contexts/PublicInfoContext") return { usePublicInfo: () => ({ publicInfo: {} }) };
      if (name === "@/hooks/useNativePasswordLogin") return { useNativePasswordLogin: () => ({ busy: false, pending: false, error: "" }) };
      if (name === "react-i18next") return { useTranslation: () => [(key: string) => key] };
      if (name === "@/utils/consolePasskeyIntent") return {
        markConsolePasskeyIntent: (path: string) => markConsolePasskeyIntent(path, options),
        consumeConsolePasskeyIntent: (path: string) => consumeConsolePasskeyIntent(path, options),
        clearConsolePasskeyIntent: () => clearConsolePasskeyIntent(options),
      };
      return new Proxy({}, { get: (_, key) => key === "__esModule" ? false : key === "Dialog"
        ? { Root: "Dialog.Root", Trigger: "Dialog.Trigger", Content: "Dialog.Content", Title: "Dialog.Title", Description: "Dialog.Description" }
        : key });
    },
  };
  vm.runInNewContext(componentCode, sandbox);
  return {
    storage, navigation, exports, TestElement,
    mark: () => markConsolePasskeyIntent("/", options),
    render(nextState: Partial<typeof state> = {}, props = {}) {
      state = { ...state, ...nextState };
      effects.length = 0;
      const tree = exports.TestDialog(props);
      effects.forEach(effect => effect());
      return tree;
    },
  };
}

function findForm(node: any, form: unknown): any {
  if (!node || typeof node !== "object") return undefined;
  if (node.type === form) return node;
  const children = node.props?.children;
  for (const child of Array.isArray(children) ? children : [children]) {
    const found = findForm(child, form);
    if (found) return found;
  }
}

test("dialog restores Passkey navigation after reload when the form is absent", () => {
  const h = dialogHarness();
  h.mark();
  assert.equal(h.navigation.length, 0);
  h.render({ account: { logged_in: true }, loading: true });
  assert.notEqual(h.storage.getItem(KEY), null);
  const authenticated = h.render({ loading: false });
  assert.equal(authenticated.type, "a");
  assert.equal(authenticated.props.target, undefined);
  assert.equal(findForm(authenticated, h.exports.LoginForm), undefined);
  assert.deepEqual(h.navigation, ["/admin/dashboard"]);
  h.render();
  assert.equal(h.navigation.length, 1);
});

test("dialog does not redirect an existing session, a failed account load or a guest", () => {
  const h = dialogHarness();
  h.render({ account: { logged_in: true } });
  assert.equal(h.navigation.length, 0);
  h.mark();
  h.render({ error: new Error("account unavailable") });
  assert.equal(h.navigation.length, 0);
  h.render({ error: null, account: { logged_in: false } });
  assert.equal(h.navigation.length, 0);
});

test("closing the dialog or choosing OAuth cancels pending console navigation", () => {
  const h = dialogHarness();
  const guest = h.render();
  const form = findForm(guest, h.exports.LoginForm);
  form.props.onPasskeyLoginStart();
  guest.props.onOpenChange(false);
  assert.equal(h.storage.getItem(KEY), null);
  form.props.onPasskeyLoginStart();
  form.props.onOAuthLoginStart();
  assert.equal(h.storage.getItem(KEY), null);
  h.render({ account: { logged_in: true } });
  assert.equal(h.navigation.length, 0);
});

test("Passkey and password completion honor the dialog's success callback", () => {
  const h = dialogHarness();
  let completed = 0;
  const props = { onLoginSuccess: () => { completed++; } };
  const guest = h.render({}, props);
  findForm(guest, h.exports.LoginForm).props.onLoginSuccess();
  assert.equal(completed, 1);
  h.mark();
  h.render({ account: { logged_in: true } }, props);
  assert.equal(completed, 2);
  assert.equal(h.navigation.length, 0);
});

test("starting password login clears a prior plugin attempt before account refresh", () => {
  const h = dialogHarness();
  const form = findForm(h.render(), h.exports.LoginForm);
  form.props.onPasskeyLoginStart();
  form.props.onPasswordLoginStart();
  h.render({ account: { logged_in: true } });
  assert.equal(h.navigation.length, 0);
  form.props.onLoginSuccess();
  assert.deepEqual(h.navigation, ["/admin/dashboard"]);
});

test("shared form reports its plugin click without consuming intent or navigating", () => {
  const h = dialogHarness();
  let bindStarts = 0;
  h.render({ account: { logged_in: true } });
  h.mark();
  const form = h.exports.LoginForm({ onPasskeyLoginStart: () => { bindStarts++; } });
  form.props.onClickCapture({ target: new h.TestElement() });
  assert.equal(bindStarts, 1);
  assert.notEqual(h.storage.getItem(KEY), null);
  assert.equal(h.navigation.length, 0);
});
