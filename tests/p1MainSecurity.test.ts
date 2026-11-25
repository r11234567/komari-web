import { getBuiltInIcon, resolvePluginIcon } from "../src/utils/iconHelper.ts";
import { createStreamOutputDecoder } from "../src/utils/streamOutput.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildPluginPageSrc } from "../src/utils/pluginPage.ts";
import { buildEnableTwoFactorRequest } from "../src/utils/accountTwoFactor.ts";

test("plugin iframe helpers drop allow-same-origin and reject traversal/query injection", () => {
  const adminPageSource = readFileSync(new URL("../src/pages/admin/plugin_page.tsx", import.meta.url), "utf8");
  const publicPageSource = readFileSync(new URL("../src/pages/plugin_page.tsx", import.meta.url), "utf8");

  assert.doesNotMatch(adminPageSource, /allow-same-origin/);
  assert.doesNotMatch(publicPageSource, /allow-same-origin/);
  assert.match(adminPageSource, /referrerPolicy="no-referrer"/);
  assert.match(publicPageSource, /referrerPolicy="no-referrer"/);

  assert.equal(
    buildPluginPageSrc("/api/admin/plugin", "demo-plugin", "/ui/index page.html"),
    "/api/admin/plugin/demo-plugin/ui/index%20page.html",
  );
  assert.equal(
    buildPluginPageSrc("/api/plugin", "demo_1.0", "public/status.html"),
    "/api/plugin/demo_1.0/public/status.html",
  );

  for (const [short, file] of [
    ["../secret", "index.html"],
    ["demo/evil", "index.html"],
    [".", "index.html"],
    ["..", "index.html"],
    ["demo", "../etc/passwd"],
    ["demo", "ui/../../secret.html"],
    ["demo", "ui\\index.html"],
    ["demo", "index.html?x=1"],
    ["demo", "index.html#frag"],
    ["demo", "index.html\n"],
    ["demo", "/"],
  ] as const) {
    assert.equal(buildPluginPageSrc("/api/admin/plugin", short, file), null, `expected rejection for ${short}/${file}`);
  }
});

test("enabling TOTP 2FA sends same-origin credentials and wires step-up token for passkey/contact users", () => {
  const direct = buildEnableTwoFactorRequest(" 123456 ");
  assert.equal(direct.url, "/api/admin/2fa/enable?code=123456");
  assert.equal(direct.init.method, "POST");
  assert.equal(direct.init.credentials, "same-origin");
  assert.equal(direct.init.headers, undefined);

  const controller = new AbortController();
  const steppedUp = buildEnableTwoFactorRequest("654321", "cred-token-abc", controller.signal);
  assert.equal(steppedUp.url, "/api/admin/2fa/enable?code=654321");
  assert.equal(steppedUp.init.method, "POST");
  assert.equal(steppedUp.init.credentials, "same-origin");
  assert.equal(steppedUp.init.signal, controller.signal);
  assert.deepEqual(steppedUp.init.headers, {
    "X-Komari-Credential-Authorization": "cred-token-abc",
  });

  const accountSource = readFileSync(new URL("../src/pages/admin/account.tsx", import.meta.url), "utf8");
  assert.match(accountSource, /requiresStepUp=\{Boolean\(account\?\.trusted_2fa_enabled\)\}/);
  assert.match(accountSource, /restCredentialResource\("POST",\s*"\/api\/admin\/2fa\/enable"\)/);
});

test("plugin icon sources stay inside their package and names resolve only own icons", () => {
  assert.ok(getBuiltInIcon("Home"));
  assert.equal(getBuiltInIcon("__proto__"), undefined);
  assert.equal(getBuiltInIcon("constructor"), undefined);
  assert.equal(resolvePluginIcon("fixture", "./icons/service icon.svg"), "/api/admin/plugin/fixture/icons/service%20icon.svg");
  for (const icon of ["//example.invalid/icon.svg", "/admin", "https://example.invalid/icon.svg", "../icon.svg", "icons/../x", "%2e%2e/x"]) {
    assert.equal(resolvePluginIcon("fixture", icon), "");
  }
});

test("execution output decodes multibyte characters across interleaved stdout and stderr frames", () => {
  const stream = createStreamOutputDecoder();
  const bytes = new TextEncoder().encode("\u4E2D\u6587");
  assert.equal(stream.decode(1, bytes.subarray(0, 2)), "");
  assert.equal(stream.decode(2, new TextEncoder().encode("stderr")), "stderr");
  assert.equal(stream.decode(1, bytes.subarray(2)), "\u4E2D\u6587");
  assert.equal(stream.decode(2, bytes.subarray(0, 1)), "");
  assert.equal(stream.finish(), "\uFFFD");
  assert.equal(stream.finish(), "");
});
