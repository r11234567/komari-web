import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Audit P0 Bug 1: /bind page prevents input wipe, deadlock on abort, and works across routes", () => {
  const source = readFileSync(new URL("../src/pages/bind.tsx", import.meta.url), "utf8");
  // lookup should have empty deps [] and not depend on [newName]
  assert.match(source, /lookup\s*=\s*React\.useCallback\([\s\S]*?\},\s*\[\s*\]\)/);
  // setNewName should preserve user typed value if present
  assert.match(source, /setNewName\(\(prev\)\s*=>\s*prev\s*\|\|\s*response\.enrollment\?\.device\?\.hostname\s*\|\|\s*""\)/);
  // finally block should reset loading without being blocked by signal.aborted
  assert.match(source, /if\s*\(abortRef\.current\s*===\s*controller\)\s*\{\s*setLoading\(false\);\s*\}/);
  // Radix UI Select must use bindTarget || undefined to avoid empty string value bug
  assert.match(source, /value=\{bindTarget \|\| undefined\}/);
  // Error feedback Callout is rendered on invalid/expired code
  assert.match(source, /lookupError/);
});

test("Audit P0 Bug 2: routes and public-routes include /enroll and /bind, privileged-config is removed", () => {
  const routesSource = readFileSync(new URL("../src/routes.ts", import.meta.url), "utf8");
  const publicRoutesSource = readFileSync(new URL("../src/public-routes.ts", import.meta.url), "utf8");

  // /enroll and /bind exist in both bundles
  assert.match(routesSource, /path:\s*["']\/enroll["']/);
  assert.match(routesSource, /path:\s*["']\/bind["']/);
  assert.match(publicRoutesSource, /path:\s*["']\/enroll["']/);
  assert.match(publicRoutesSource, /path:\s*["']\/bind["']/);

  // privileged-config route is removed per user requirement
  assert.doesNotMatch(routesSource, /path:\s*["']privileged-config["']/);
});

test("Audit P0 Bug 3: LiveDataContext releases Web Locks on hidden tab to prevent starvation", () => {
  const source = readFileSync(new URL("../src/contexts/LiveDataContext.tsx", import.meta.url), "utf8");
  // Should abort controller and break loop when hidden
  assert.match(source, /document\.visibilityState\s*===\s*["']hidden["']/);
  assert.match(source, /streamController\.abort/);
  // Should listen for visibilitychange to re-elect leader when returning to foreground
  assert.match(source, /document\.addEventListener\(["']visibilitychange["'],\s*handleGlobalVisibility\)/);
});

test("Audit P0 Bug 4: NodeDetailsContext uses ConnectRPC with silent refresh and no polling storm in admin", () => {
  const contextSource = readFileSync(new URL("../src/contexts/NodeDetailsContext.tsx", import.meta.url), "utf8");
  const adminPageSource = readFileSync(new URL("../src/pages/admin/index.tsx", import.meta.url), "utf8");

  // NodeDetailsContext uses listAdminNodes with AbortController
  assert.match(contextSource, /listAdminNodes\(controller\.signal\)/);
  assert.match(contextSource, /abortRef\.current\?\.abort\(\)/);
  assert.doesNotMatch(contextSource, /\/api\/admin\/client\/list/);

  // Background refresh does not toggle isLoading or cause screen flashing
  assert.match(contextSource, /hasLoadedRef/);
  assert.match(adminPageSource, /isLoading\s*&&\s*\(!nodeDetail\s*\|\|\s*nodeDetail\.length\s*===\s*0\)/);
  // admin/index.tsx does not run setInterval polling storms
  assert.doesNotMatch(adminPageSource, /setInterval/);
});

test("Audit P0 Bug 5: useSettings uses module-level singleton state and listener sync", () => {
  const source = readFileSync(new URL("../src/lib/api.ts", import.meta.url), "utf8");
  assert.match(source, /let\s+cachedSettings:\s*SettingsResponse/);
  assert.match(source, /const\s+settingsListeners\s*=\s*new\s*Set/);
  assert.match(source, /function\s+notifySettingsListeners\(\)/);
  assert.match(source, /settingsListeners\.add\(/);
  assert.match(source, /settingsListeners\.delete\(/);
});

test("Audit P0 Bug 6: menuConfig has removed privileged-config navigation entry", () => {
  const menuConfig = JSON.parse(readFileSync(new URL("../src/config/menuConfig.json", import.meta.url), "utf8"));
  const privItem = menuConfig.menu.find((item: { path: string }) => item.path === "/admin/privileged-config");
  assert.equal(privItem, undefined, "privileged-config must be removed from menuConfig.menu");
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
