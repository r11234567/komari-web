import type { PluginPackage, PluginPermissions } from "@komari/proto/komari/plugin/v1/plugin_pb";

export const pluginPackageTargets = (review: PluginPackage) => [
  review.plugin?.shortName ?? "", review.digest, review.plugin?.version ?? "",
  review.permissionsHash, review.currentDigest,
];

export function pluginPermissionChanges(current?: PluginPermissions, candidate?: PluginPermissions) {
  const fields = [
    ["node", "Node compatibility"], ["allowSystemRpc", "System RPC"],
    ["allowRoutes", "HTTP routes"], ["allowHooks", "Request/response hooks"],
    ["allowHtmlInject", "Same-origin HTML/JavaScript injection"],
    ["allowExec", "Child process execution"], ["allowListen", "Listen on local ports"],
    ["allowAllFileAccess", "Files outside the plugin directory"],
    ["maxHttpBodyBytes", "HTTP body limit (bytes)"],
    ["maxChildOutputBytes", "Child output limit (bytes)"], ["timeoutSeconds", "Turn timeout (seconds)"],
  ] as const;
  const value = (permissions: PluginPermissions | undefined, field: typeof fields[number][0]) => String(permissions?.[field] ?? (field.startsWith("allow") || field === "node" ? false : 0));
  return fields.map(([field, label]) => ({ field, label, before: value(current, field), after: value(candidate, field), changed: value(current, field) !== value(candidate, field) }));
}
