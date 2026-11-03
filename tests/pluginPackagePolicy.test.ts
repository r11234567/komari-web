import assert from "node:assert/strict";
import test from "node:test";
import type { PluginPackage, PluginPermissions } from "@komari/proto/komari/plugin/v1/plugin_pb";
import { pluginPackageTargets, pluginPermissionChanges } from "../src/utils/pluginPackagePolicy.ts";

test("plugin package approval binds identity, bytes, version, full permissions and current revision", () => {
  const review = { plugin: { shortName: "example", version: "1.0.0" }, digest: "package-a", permissionsHash: "permissions-a", currentDigest: "active-a" } as PluginPackage;
  const original = pluginPackageTargets(review);
  for (const field of ["digest", "permissionsHash", "currentDigest"] as const) {
    assert.notDeepEqual(pluginPackageTargets({ ...review, [field]: "changed" }), original);
  }
  for (const field of ["shortName", "version"] as const) {
    assert.notDeepEqual(pluginPackageTargets({ ...review, plugin: { ...review.plugin!, [field]: "changed" } }), original);
  }
});

test("permission review includes execution/injection privileges and runtime settings", () => {
  const before = {} as PluginPermissions;
  const after = { allowHtmlInject: true, allowExec: true, timeoutSeconds: 60, maxHttpBodyBytes: 10n } as PluginPermissions;
  const changes = pluginPermissionChanges(before, after).filter(item => item.changed);
  assert.deepEqual(changes.map(item => item.field).sort(), ["allowExec", "allowHtmlInject", "maxHttpBodyBytes", "timeoutSeconds"].sort());
  assert.equal(pluginPermissionChanges(before, before).some(item => item.changed), false);
});
