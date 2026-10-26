import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Audit P0 Bug 1: /bind page prevents input wipe, deadlock on abort, and works across routes", () => {
  const source = readFileSync(new URL("../src/pages/bind.tsx", import.meta.url), "utf8");
  // lookup must not depend on newName; route navigation dependencies are expected.
  assert.match(
    source,
    /lookup\s*=\s*React\.useCallback\([\s\S]*?\},\s*\[bindTicket,\s*location\.hash,\s*location\.pathname,\s*location\.search,\s*navigate\]\)/,
  );
  // setNewName should preserve user typed value if present
  assert.match(source, /setNewName\(\(prev\)\s*=>\s*prev\s*\|\|\s*response\.enrollment\?\.device\?\.hostname\s*\|\|\s*""\)/);
  // finally block should reset loading without being blocked by signal.aborted
  assert.match(source, /if\s*\(abortRef\.current\s*===\s*controller\)\s*\{\s*setLoading\(false\);\s*\}/);
  // Radix UI Select must use bindTarget || undefined to avoid empty string value bug
  assert.match(source, /value=\{bindTarget \|\| undefined\}/);
  // Error feedback Callout is rendered on invalid/expired code
  assert.match(source, /lookupError/);
});

test("Audit P0 Bug 2: routes and public-routes include /enroll, /bind, and /bind-login, privileged-config is removed", () => {
  const routesSource = readFileSync(new URL("../src/routes.ts", import.meta.url), "utf8");
  const publicRoutesSource = readFileSync(new URL("../src/public-routes.ts", import.meta.url), "utf8");

  // /enroll, /bind, and /bind-login exist in both bundles
  assert.match(routesSource, /path:\s*["']\/enroll["']/);
  assert.match(routesSource, /path:\s*["']\/bind["']/);
  assert.match(routesSource, /path:\s*["']\/bind-login["']/);
  assert.match(publicRoutesSource, /path:\s*["']\/enroll["']/);
  assert.match(publicRoutesSource, /path:\s*["']\/bind["']/);
  assert.match(publicRoutesSource, /path:\s*["']\/bind-login["']/);

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

test("Audit Feature 1: /bind-login completes a full login then obtains a reusable 2-minute ticket", () => {
  const bindSource = readFileSync(new URL("../src/pages/bind.tsx", import.meta.url), "utf8");
  const loginSource = readFileSync(new URL("../src/components/Login.tsx", import.meta.url), "utf8");
  const bindLoginSource = readFileSync(new URL("../src/pages/bind-login.tsx", import.meta.url), "utf8");
  const navBarSource = readFileSync(new URL("../src/components/NavBar.tsx", import.meta.url), "utf8");

  // /bind uses route interception to bind-login
  assert.match(bindSource, /BindAuthGate/);
  assert.match(bindSource, /bindLoginPath/);
  // The login form stays a normal full-login form for password, OAuth, and passkey plugins.
  assert.match(loginSource, /\.km-passkey-login/);
  assert.match(loginSource, /oauthLoginURL/);
  assert.doesNotMatch(loginSource, /\/api\/bind\/ticket/);
  // The session is exchanged for a ticket only after the login page observes a completed login.
  assert.match(bindLoginSource, /\/api\/public\/bind\/ticket/);
  assert.match(bindLoginSource, /setStoredBindTicket/);
  assert.match(bindLoginSource, /<LoginForm/);
  assert.match(bindLoginSource, /consumeBindLoginIntent/);
  assert.doesNotMatch(bindLoginSource, /requestedRef/);
  assert.match(navBarSource, /window\.location\.assign\("\/admin\/dashboard"\)/);
  assert.doesNotMatch(loginSource, /href="\/admin\/dashboard" target="_blank"/);
  // Passes X-Bind-Ticket in headers
  assert.match(bindSource, /"X-Bind-Ticket":\s*(?:ticketToUse|bindTicket)/);
  // Has live countdown timer
  assert.match(bindSource, /formatTicketTime/);
  assert.match(bindSource, /ticketTimeLeft/);
  // The two-minute ticket is reusable and must not be consumed by one operation.
  assert.doesNotMatch(bindSource, /Consumed single-use ticket/);
  assert.doesNotMatch(bindSource, /twoFactor:\s*create\(/);
});

test("Audit Feature 2: Rename 一键部署与配置下发 to 配置下发", () => {
  const dialogSource = readFileSync(new URL("../src/components/admin/AgentDeploymentDialog.tsx", import.meta.url), "utf8");
  const nodeFuncSource = readFileSync(new URL("../src/components/admin/NodeTable/NodeFunction.tsx", import.meta.url), "utf8");
  const adminSource = readFileSync(new URL("../src/pages/admin/index.tsx", import.meta.url), "utf8");

  assert.doesNotMatch(dialogSource, /一键部署与配置下发/);
  assert.match(dialogSource, /title\s*=\s*"配置下发"/);

  assert.doesNotMatch(nodeFuncSource, /一键部署与配置下发/);
  assert.match(nodeFuncSource, /title="配置下发"/);

  assert.doesNotMatch(adminSource, /一键部署与配置下发/);
  assert.match(adminSource, /title="配置下发"/);
});

test("Audit Feature 3: both privileged surfaces use one authoritative state panel", () => {
  const dialog = readFileSync(new URL("../src/components/admin/AgentDeploymentDialog.tsx", import.meta.url), "utf8");
  const page = readFileSync(new URL("../src/pages/admin/privileged-config.tsx", import.meta.url), "utf8");
  assert.match(dialog, /<PrivilegedDeliveryPanel/);
  assert.match(page, /<PrivilegedDeliveryPanel/);
});

test("Audit Feature 4: Secret masking and anti-copy in renderProviders", () => {
  const renderSource = readFileSync(new URL("../src/utils/renderProviders.tsx", import.meta.url), "utf8");
  // Detects secret fields
  assert.match(renderSource, /isSecret/);
  assert.match(renderSource, /bot_token/);
  assert.match(renderSource, /device_key/);
  // Prohibits copy and cut with toast
  assert.match(renderSource, /onCopy=\{isSecret/);
  assert.match(renderSource, /onCut=\{isSecret/);
  assert.match(renderSource, /secret_copy_prevented/);
  assert.match(renderSource, /userSelect:\s*"none"/);
});

test("Sidebar 1.5.0 layout: top-level items and categorized groups", () => {
  const menuConfig = JSON.parse(readFileSync(new URL("../src/config/menuConfig.json", import.meta.url), "utf8"));
  const topFour = menuConfig.menu.slice(0, 4).map((item: { labelKey: string; children?: unknown[] }) => ({
    labelKey: item.labelKey,
    hasChildren: Array.isArray(item.children),
  }));
  assert.deepEqual(topFour, [
    { labelKey: "common.dashboard", hasChildren: false },
    { labelKey: "common.serverList", hasChildren: false },
    { labelKey: "operations.workbench", hasChildren: false },
    { labelKey: "billing.title", hasChildren: false },
  ]);

  const groupKeys = menuConfig.menu
    .filter((item: { children?: unknown[] }) => Array.isArray(item.children) && item.children.length > 0)
    .map((item: { labelKey: string }) => item.labelKey);
  assert.deepEqual(groupKeys, [
    "adminNavigation.operations",
    "notification.title",
    "adminNavigation.extensions",
    "adminNavigation.system",
    "adminNavigation.security",
  ]);
});

test("Account page requires 2FA verification before entry when 2FA is enabled", () => {
  const accountSource = readFileSync(new URL("../src/pages/admin/account.tsx", import.meta.url), "utf8");
  assert.match(accountSource, /AccountTwoFactorGate/);
  assert.match(accountSource, /account\?\.\["2fa_enabled"\]\s*&&\s*!twoFaVerified/);
  const gateSource = readFileSync(new URL("../src/components/admin/AccountTwoFactorGate.tsx", import.meta.url), "utf8");
  assert.match(gateSource, /\/api\/admin\/2fa\/verify/);
});
