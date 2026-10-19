import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Audit P0 Bug 1: /bind page prevents input wipe and recreation loops", () => {
  const source = readFileSync(new URL("../src/pages/bind.tsx", import.meta.url), "utf8");
  // lookup should have empty deps [] and not depend on [newName]
  assert.match(source, /lookup\s*=\s*React\.useCallback\([\s\S]*?\},\s*\[\s*\]\)/);
  // setNewName should preserve user typed value if present
  assert.match(source, /setNewName\(\(prev\)\s*=>\s*prev\s*\|\|\s*response\.enrollment\?\.device\?\.hostname\s*\|\|\s*""\)/);
});

test("Audit P0 Bug 2: routes include /enroll pointing to bind page and /admin/privileged-config", () => {
  const routesSource = readFileSync(new URL("../src/routes.ts", import.meta.url), "utf8");
  assert.match(routesSource, /path:\s*["']\/enroll["']/);
  assert.match(routesSource, /path:\s*["']\/bind["']/);
  assert.match(routesSource, /path:\s*["']privileged-config["']/);
  assert.match(routesSource, /import\("\.\/pages\/admin\/privileged-config"\)/);
});

test("Audit P0 Bug 3: LiveDataContext releases Web Locks on hidden tab to prevent starvation", () => {
  const source = readFileSync(new URL("../src/contexts/LiveDataContext.tsx", import.meta.url), "utf8");
  // Should abort controller and break loop when hidden
  assert.match(source, /document\.visibilityState\s*===\s*["']hidden["']/);
  assert.match(source, /streamController\.abort/);
  // Should listen for visibilitychange to re-elect leader when returning to foreground
  assert.match(source, /document\.addEventListener\(["']visibilitychange["'],\s*handleGlobalVisibility\)/);
});

test("Audit P0 Bug 4: NodeDetailsContext uses ConnectRPC with AbortController and pauses when hidden", () => {
  const contextSource = readFileSync(new URL("../src/contexts/NodeDetailsContext.tsx", import.meta.url), "utf8");
  const adminPageSource = readFileSync(new URL("../src/pages/admin/index.tsx", import.meta.url), "utf8");

  // NodeDetailsContext uses listAdminNodes with AbortController
  assert.match(contextSource, /listAdminNodes\(controller\.signal\)/);
  assert.match(contextSource, /abortRef\.current\?\.abort\(\)/);
  assert.doesNotMatch(contextSource, /\/api\/admin\/client\/list/);

  // admin/index.tsx checks visibility before polling refresh
  assert.match(adminPageSource, /document\.visibilityState\s*!==\s*["']visible["']/);
});

test("Audit P0 Bug 5: useSettings uses module-level singleton state and listener sync", () => {
  const source = readFileSync(new URL("../src/lib/api.ts", import.meta.url), "utf8");
  assert.match(source, /let\s+cachedSettings:\s*SettingsResponse/);
  assert.match(source, /const\s+settingsListeners\s*=\s*new\s*Set/);
  assert.match(source, /function\s+notifySettingsListeners\(\)/);
  assert.match(source, /settingsListeners\.add\(/);
  assert.match(source, /settingsListeners\.delete\(/);
});

test("Audit P0 Bug 6: menuConfig and all locales mount privileged-config navigation", () => {
  const menuConfig = JSON.parse(readFileSync(new URL("../src/config/menuConfig.json", import.meta.url), "utf8"));
  const privItem = menuConfig.menu.find((item: { path: string }) => item.path === "/admin/privileged-config");
  assert.ok(privItem, "privileged-config must exist in menuConfig.menu");
  assert.equal(privItem.icon, "ShieldCheck");
  assert.equal(privItem.labelKey, "privileged_config.title");

  const locales = ["zh_CN", "zh_TW", "en", "ja_JP", "id_ID"];
  for (const locale of locales) {
    const localeJson = JSON.parse(readFileSync(new URL(`../src/i18n/locales/${locale}.json`, import.meta.url), "utf8"));
    assert.ok(
      localeJson.privileged_config?.title,
      `privileged_config.title missing in ${locale}.json`
    );
  }
});

test("Audit Bonus: PerformanceDiagnostics renders structured DiagnosticsReport", () => {
  const source = readFileSync(new URL("../src/components/admin/PerformanceDiagnostics.tsx", import.meta.url), "utf8");
  assert.match(source, /msg\.event\.diagnostics/);
  assert.match(source, /report\.cpu/);
  assert.match(source, /report\.memory/);
  assert.match(source, /stealPercent/);
  assert.match(source, /availableBytes/);
  assert.match(source, /swapUsedBytes/);
});
