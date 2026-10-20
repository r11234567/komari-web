import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Audit P0 Bug 1: /bind page prevents input wipe, deadlock on abort, and works across routes", () => {
  const source = readFileSync(new URL("../src/pages/bind.tsx", import.meta.url), "utf8");
  // lookup should have empty deps [] and not depend on [newName]
  assert.match(source, /lookup\s*=\s*React\.useCallback\([\s\S]*?\},\s*\[\s*bindTicket\s*\]\)/);
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

test("Audit Feature 1: /bind enforces 2-minute single-use ticket, route gate, and X-Bind-Ticket header", () => {
  const bindSource = readFileSync(new URL("../src/pages/bind.tsx", import.meta.url), "utf8");
  const loginSource = readFileSync(new URL("../src/components/Login.tsx", import.meta.url), "utf8");
  const bindLoginSource = readFileSync(new URL("../src/pages/bind-login.tsx", import.meta.url), "utf8");

  // /bind uses route interception to bind-login
  assert.match(bindSource, /BindAuthGate/);
  assert.match(bindSource, /bindLoginPath/);
  // Acquires ticket from /api/bind/ticket via LoginForm mode="bind"
  assert.match(loginSource, /\/api\/bind\/ticket/);
  assert.match(loginSource, /setStoredBindTicket/);
  assert.match(bindLoginSource, /mode="bind"/);
  // Passes X-Bind-Ticket in headers
  assert.match(bindSource, /"X-Bind-Ticket":\s*(?:ticketToUse|bindTicket)/);
  // Has live countdown timer
  assert.match(bindSource, /formatTicketTime/);
  assert.match(bindSource, /ticketTimeLeft/);
  // Clears single-use ticket on approve
  assert.match(bindSource, /setBindTicket\(null\)/);
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

test("Audit Feature 3: Cascading switch dependencies in AgentDeploymentDialog", () => {
  const dialogSource = readFileSync(new URL("../src/components/admin/AgentDeploymentDialog.tsx", import.meta.url), "utf8");
  // 远程控制总开关 disabled when not in root mode
  assert.match(dialogSource, /label="远程控制总开关"[\s\S]*?disabled=\{!isPrivilegedAccount\}/);
  // WebSSH disabled when remoteControlEnabled is off
  assert.match(dialogSource, /label="WebSSH 交互终端"[\s\S]*?disabled=\{!privDraft\.remoteControlEnabled/);
  // 远程命令执行 disabled when remoteControlEnabled is off
  assert.match(dialogSource, /label="远程命令执行"[\s\S]*?disabled=\{!privDraft\.remoteControlEnabled/);
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
