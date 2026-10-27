import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { safeLoginReturnTo } from "../src/utils/loginRedirect.ts";

const source = ts.transpileModule(readFileSync(new URL("../src/pages/login-verify.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function harness(error = "", search = "") {
  const exports: any = {};
  const navigations: string[] = [];
  const imports: string[] = [];
  let authenticated: () => void;
  const login = { error, busy: false, reset: async () => true };
  vm.runInNewContext(source, { exports, URLSearchParams,
    window: { location: { replace: (path: string) => navigations.push(path) } },
    require(name: string): any {
      imports.push(name);
      if (name === "react/jsx-runtime") return { jsx: (type: unknown, props: any) => ({ type, props }), jsxs: (type: unknown, props: any) => ({ type, props }) };
      if (name === "@radix-ui/themes") return Object.fromEntries(["Button", "Card", "Flex", "Heading", "Text"].map(name => [name, name]));
      if (name === "react-router-dom") return { useLocation: () => ({ search }) };
      if (name === "react-i18next") return { useTranslation: () => ({ t: (_: string, fallback?: string) => fallback ?? _ }) };
      if (name === "@/contexts/PublicInfoContext") return { usePublicInfo: () => ({ publicInfo: { sitename: "Synthetic" } }) };
      if (name === "@/utils/loginRedirect") return { safeLoginReturnTo };
      if (name === "@/hooks/useNativePasswordLogin") return { useNativePasswordLogin: (success: () => void, mode: string) => {
        assert.equal(mode, "verify"); authenticated = success; return login;
      } };
      if (name === "@/components/PasswordCredentialStep") return { default: "PasswordCredentialStep", __esModule: true };
      throw new Error(`Unexpected import ${name}`);
    },
  });
  const tree = exports.default();
  return { tree, login, imports, navigations, complete: () => authenticated!() };
}
function flatten(node: any): any[] {
  if (!node || typeof node !== "object") return [];
  const children = node.props?.children;
  return [node, ...(Array.isArray(children) ? children : [children]).flatMap(flatten)];
}
test("dedicated page renders only factor controls even with missing or expired preauthentication", () => {
  for (const message of ["", "[unauthenticated] Login expired", "[resource_exhausted] Retry later"]) {
    const h = harness(message);
    const nodes = flatten(h.tree);
    assert.equal(nodes.filter(n => n.type === "PasswordCredentialStep").length, 1);
    assert.equal(nodes.find(n => n.type === "PasswordCredentialStep").props.login, h.login);
    assert.equal(nodes.filter(n => n.type === "form" || n.type === "input").length, 0);
    assert.equal(h.imports.some(name => /AccountContext|components\/Login$/.test(name)), false);
    assert.deepEqual(h.navigations, []);
    if (message) assert.equal(nodes.find(n => n.props?.role === "alert").props.children, message);
  }
});
test("factor completion enters dashboard and only accepts allowed local return destinations", () => {
  for (const [search, expected] of [["", "/admin/dashboard"], ["?returnTo=https://evil.test", "/admin/dashboard"], ["?returnTo=%2Fadmin%2Fservers", "/admin/servers"]]) {
    const h = harness("", search); h.complete(); assert.deepEqual(h.navigations, [expected]);
  }
});
test("restarting is explicit and cancels the old ceremony before opening password login", async () => {
  const h = harness("Expired");
  const restart = flatten(h.tree).find(n => n.type === "Button");
  await restart.props.onClick();
  assert.deepEqual(h.navigations, ["/login?returnTo=%2Fadmin%2Fdashboard"]);
});
