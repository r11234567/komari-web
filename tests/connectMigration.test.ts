import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { Code, ConnectError } from "@connectrpc/connect";
import { isCompatibilityFailure } from "../src/api/connect/compatibility.ts";
import { withRequestBudget } from "../src/api/connect/deadline.ts";
import {
  THEME_MANIFEST_SCHEMA_VERSION,
  normalizeThemeManifest,
} from "../src/utils/themeConfiguration.ts";

test("Connect fallback is limited to unavailable and unimplemented procedures", () => {
  assert.equal(
    isCompatibilityFailure(new ConnectError("old backend", Code.Unavailable)),
    true,
  );
  assert.equal(
    isCompatibilityFailure(new ConnectError("old backend", Code.Unimplemented)),
    true,
  );
  assert.equal(
    isCompatibilityFailure(new ConnectError("forbidden", Code.PermissionDenied)),
    false,
  );
  assert.equal(
    isCompatibilityFailure(new ConnectError("cancelled", Code.Canceled)),
    false,
  );
});

test("third-party manifests without schemaVersion remain v1-compatible", () => {
  const legacy = normalizeThemeManifest({
    short: "third-party",
    configuration: { type: "managed", data: [] },
  });
  assert.equal(legacy?.schemaVersion, THEME_MANIFEST_SCHEMA_VERSION);

  const current = normalizeThemeManifest({ schemaVersion: 2, short: "future" });
  assert.equal(current?.schemaVersion, 2);
  assert.equal(normalizeThemeManifest([]), null);
});

test("request budgets propagate caller cancellation to the operation", async () => {
  const controller = new AbortController();
  const observed = withRequestBudget(
    controller.signal,
    10_000,
    ({ signal }) =>
      new Promise<void>((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => reject(signal.reason),
          { once: true },
        );
      }),
  );

  const reason = new DOMException("route changed", "AbortError");
  controller.abort(reason);
  await assert.rejects(observed, (error) => error === reason);
});

test("request budgets reject invalid deadlines before transport work", async () => {
  const controller = new AbortController();
  let called = false;
  await assert.rejects(
    withRequestBudget(controller.signal, 0, async () => {
      called = true;
    }),
    RangeError,
  );
  assert.equal(called, false);
});

test("remote pages use typed Connect adapters instead of legacy transports", async () => {
  const [executionPage, terminalPage, adapter] = await Promise.all([
    readFile(new URL("../src/pages/admin/exec.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/terminal/index.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/api/connect/remote.ts", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(executionPage, /\/api\/admin\/task\/(?:exec|.*result)/);
  assert.doesNotMatch(terminalPage, /new WebSocket|\/terminal\?/);
  assert.doesNotMatch(terminalPage, /\/api\/admin\/client\/list/);
  assert.match(adapter, /execution\.watchExecution/);
  assert.match(adapter, /webssh\.watchSession/);
  assert.match(adapter, /webssh\.acknowledgeSessionEvents/);
  assert.match(adapter, /AbortSignal\.any/);
});

test("new deployment profiles use a dedicated service account identity", async () => {
  const deploymentDialog = await readFile(
    new URL("../src/components/admin/AgentDeploymentDialog.tsx", import.meta.url),
    "utf8",
  );
  assert.match(deploymentDialog, /AgentRuntimeIdentity\.SERVICE_ACCOUNT/);
  assert.match(deploymentDialog, /专用非特权服务账号/);
});

test("admin console reads go through typed Connect adapters, not REST bridges", async () => {
  const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");
  const [panels, alertFilters, sessions, logs, clipboard, database, pingContext] =
    await Promise.all([
      read("../src/components/admin/DashboardPanels.tsx"),
      read("../src/utils/adminAlertFilters.ts"),
      read("../src/pages/admin/sessions.tsx"),
      read("../src/pages/admin/log.tsx"),
      read("../src/contexts/CommandClipboardContext.tsx"),
      read("../src/components/admin/DatabaseMaintenanceCard.tsx"),
      read("../src/contexts/PingTaskContext.tsx"),
    ]);
  assert.doesNotMatch(panels, /\/api\/admin\/dashboard/);
  assert.doesNotMatch(alertFilters, /\/api\/admin\//);
  assert.doesNotMatch(sessions, /\/api\/admin\/session/);
  assert.doesNotMatch(logs, /\/api\/admin\/logs/);
  assert.doesNotMatch(clipboard, /\/api\/admin\/clipboard/);
  assert.doesNotMatch(database, /\/api\/admin\/database\//);
  assert.doesNotMatch(pingContext, /\/api\/admin\/ping/);
});

// adminAlertFilters is imported directly by dashboard.test.ts under
// `node --test`, which does not resolve the "@/" bundler alias. A value import
// of the Connect adapter there would fail at run time rather than at build time.
test("adminAlertFilters stays free of runtime imports the test runner cannot resolve", async () => {
  const source = await readFile(
    new URL("../src/utils/adminAlertFilters.ts", import.meta.url),
    "utf8",
  );
  const valueImports = source.match(/^import\s+(?!type\s)[^;]+from\s+"@\/[^"]+";$/gm);
  assert.equal(valueImports, null);
});

test("admin console adapters call the generated Connect clients", async () => {
  const [dashboardAdapter, maintenanceAdapter, pingAdapter] = await Promise.all([
    readFile(new URL("../src/api/connect/dashboard.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/api/connect/maintenance.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/api/connect/ping.ts", import.meta.url), "utf8"),
  ]);
  assert.match(dashboardAdapter, /dashboard\.getDashboardSummary/);
  assert.match(dashboardAdapter, /dashboard\.getDashboardCharts/);
  assert.match(dashboardAdapter, /dashboard\.listDashboardAlertItems/);
  assert.match(maintenanceAdapter, /maintenance\.listSessions/);
  assert.match(maintenanceAdapter, /maintenance\.vacuumDatabase/);
  assert.match(pingAdapter, /pingTask\.reorderPingTasks/);
});

test("default application graph does not import the RPC2 compatibility client", async () => {
  const files = await Promise.all([
    "../src/main.tsx",
    "../src/components/admin/AdminPanelBar.tsx",
    "../src/components/admin/DownsamplingCard.tsx",
    "../src/pages/admin/plugins.tsx",
    "../src/pages/admin/plugin_config.tsx",
    "../src/pages/admin/market/plugins.tsx",
    "../src/pages/admin/settings/metrics.tsx",
  ].map((path) => readFile(new URL(path, import.meta.url), "utf8")));
  for (const source of files) {
    assert.doesNotMatch(source, /RPC2Context|useRPC2Call|\/api\/rpc2|new WebSocket/);
  }
});
