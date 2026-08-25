import type {
  DashboardAlertKind,
  DashboardAlertLatest,
} from "@/utils/dashboard";

// This module stays transport-free on purpose: it is loaded directly by
// `node --test`, which does not resolve the "@/" bundler alias, so a value
// import of the Connect adapter here would break the test run. Fetching and
// caching alert items lives in src/api/connect/dashboard.ts.

export const serverAlertKinds = new Set<DashboardAlertKind>([
  "offline",
  "resource",
  "traffic",
  "billing",
]);

export function dashboardAlertCategoryPath(kind: DashboardAlertKind): string {
  if (kind === "latency_loss") return "/admin/notification/ping-loss?state=active";
  if (kind === "return_route") return "/admin/return-route?state=switched";
  return `/admin/servers?alert=${encodeURIComponent(kind)}`;
}

export function dashboardAlertDetailPath(
  kind: DashboardAlertKind,
  alert?: DashboardAlertLatest,
): string {
  if (!alert) return dashboardAlertCategoryPath(kind);
  if (kind === "latency_loss" && alert.node_uuid && alert.task_id) {
    const params = new URLSearchParams({ node: alert.node_uuid, task: String(alert.task_id) });
    return `/admin/notification/ping-loss?${params}`;
  }
  if (kind === "return_route" && alert.task_id) {
    return `/admin/return-route?task=${encodeURIComponent(String(alert.task_id))}`;
  }
  if (alert.node_uuid) {
    return `/admin/servers?node=${encodeURIComponent(alert.node_uuid)}`;
  }
  return dashboardAlertCategoryPath(kind);
}

export function formatBillingAlertStatus(
  dueAt: string | undefined,
  locale: string,
  now = Date.now(),
): string {
  if (!dueAt) return "";
  const due = new Date(dueAt).getTime();
  if (!Number.isFinite(due)) return "";
  const days = Math.ceil(Math.abs(due - now) / 86_400_000);
  if (due < now) return locale.startsWith("zh") ? `已到期 ${days} 天` : `Expired ${days}d`;
  return locale.startsWith("zh") ? `${days} 天后到期` : `Due in ${days}d`;
}
