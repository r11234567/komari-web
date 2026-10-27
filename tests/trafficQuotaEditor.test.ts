import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as quota from "../src/utils/trafficQuota.ts";

// Execute the actual machine EditButton: text input -> blur -> save payload.
// No browser, production node, network or database is used.
const source = ts.transpileModule(readFileSync(new URL("../src/pages/admin/index.tsx", import.meta.url), "utf8") + "\nexport { EditButton as TestEditButton };", {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
function harness(initialBytes = 590_558_003_200) {
  const states: any[] = [], refs: any[] = [], effects: any[] = [], requests: any[] = [];
  let si = 0, ri = 0, ei = 0;
  const exports: any = {};
  const react = {
    useState(initial: any) { const i = si++; if (!(i in states)) states[i] = typeof initial === "function" ? initial() : initial; return [states[i], (v: any) => { states[i] = v; }]; },
    useRef(initial: any) { const i = ri++; refs[i] ??= { current: initial }; return refs[i]; },
    useEffect(fn: () => void) { const i = ei++; if (!effects[i]) { effects[i] = true; fn(); } },
  };
  vm.runInNewContext(source, { exports, console,
    fetch: async (url: string, init: any) => { requests.push({ url, body: JSON.parse(init.body) }); return { ok: true }; },
    require(name: string): any {
      if (name === "react") return { ...react, default: react, __esModule: true };
      if (name === "react/jsx-runtime") { const jsx = (type: any, props: any) => ({ type, props }); return { jsx, jsxs: jsx }; }
      if (name === "react-i18next") return { useTranslation: () => ({ t: (key: string) => key }) };
      if (name === "@/contexts/NodeDetailsContext") return { useNodeDetails: () => ({ refresh() {} }) };
      if (name === "@/utils/trafficQuota") return quota;
      if (name === "sonner") return { toast: { success() {}, error() {} } };
      return new Proxy({}, { get: (_, key) => key === "__esModule" ? false : key === "Dialog" ? { Root: "Dialog.Root", Trigger: "Dialog.Trigger", Content: "Dialog.Content", Title: "Dialog.Title", Description: "Dialog.Description" } : key });
    },
  });
  const node = { uuid: "synthetic-node", traffic_limit: initialBytes, traffic_limit_type: "sum", hidden: false };
  const render = () => { si = ri = ei = 0; return exports.TestEditButton({ node }); };
  render();
  const nodes = (node: any): any[] => !node || typeof node !== "object" ? [] : [node, ...(Array.isArray(node.props?.children) ? node.props.children : [node.props?.children]).flatMap(nodes)];
  return { requests,
    field: () => nodes(render()).find(n => n.props?.title === "admin.nodeEdit.trafficLimit" && n.type === "SettingCardShortTextInput"),
    change(text: string) { this.field().props.onChange({ currentTarget: { value: text } }); },
    blur() { this.field().props.onBlur(); },
    save: async () => { const button = nodes(render()).find(n => n.props?.type === "submit"); await button.props.onClick(); },
  };
}
test("typing GB in the machine editor submits decimal bytes, including after blur", async () => {
  const h = harness();
  h.change("550 GB"); assert.equal(h.field().props.value, "550 GB");
  h.blur(); assert.equal(h.field().props.value, "550 GB");
  await h.save();
  assert.equal(h.requests[0].body.traffic_limit, 550_000_000_000);
});
test("explicit GiB remains binary but normalized display states the actual decimal GB", async () => {
  const h = harness(); h.change("550 GiB"); h.blur();
  assert.equal(h.field().props.value, "590.5580032 GB");
  await h.save(); assert.equal(h.requests[0].body.traffic_limit, 590_558_003_200);
});
test("an unrelated edit preserves original bytes exactly", async () => {
  const h = harness(123_456_789_123); await h.save();
  assert.equal(h.requests[0].body.traffic_limit, 123_456_789_123);
});
test("save independently validates the visible draft instead of submitting a stale valid value", async () => {
  const h = harness(); h.change("550 GB"); h.change("invalid"); await h.save();
  assert.equal(h.requests.length, 0);
  h.change("550.25 GB"); await h.save();
  assert.equal(h.requests[0].body.traffic_limit, 550_250_000_000);
});
