export const alertKinds = [
 ["offline", "离线"], ["online", "恢复上线"], ["load", "资源负载"], ["traffic", "流量阈值"],
 ["expire", "到期提醒"], ["renew", "自动续费"], ["login", "登录"], ["ping_loss", "丢包"],
 ["ping_latency", "延迟"], ["traffic_report_daily", "流量日报"], ["traffic_report_weekly", "流量周报"],
 ["traffic_report_monthly", "流量月报"], ["return_route", "回程线路"], ["mainland_reachability", "大陆连通性"],
] as const;
export type NotificationRoutes = Record<string, string[]>;

export function normalizeRouteDraft(raw: unknown): NotificationRoutes {
 const source = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
 return Object.fromEntries(alertKinds.map(([kind]) => [kind, Array.isArray(source[kind]) ? [...new Set((source[kind] as unknown[]).filter((v): v is string => typeof v === "string" && !!v.trim()).map((v) => v.trim()))] : []]));
}
export function toggleRoute(routes: NotificationRoutes, kind: string, channel: string, checked: boolean): NotificationRoutes {
 const prior = routes[kind] || [];
 return {...routes, [kind]: checked ? [...new Set([...prior, channel])] : prior.filter((value) => value !== channel)};
}
export function digestSecondsInput(value: string): number {
 if (!/^\d+$/.test(value.trim())) throw new Error("汇总时间必须是 1 到 3600 的整数秒");
 const seconds = Number(value);
 if (!Number.isInteger(seconds) || seconds < 1 || seconds > 3600) throw new Error("汇总时间必须是 1 到 3600 的整数秒");
 return seconds;
}
export async function notificationRequest<T>(url: string, init?: RequestInit): Promise<T> {
 const response = await fetch(url, {cache:"no-store", ...init});
 let result;
 try { result = await response.json(); } catch { throw new Error(`HTTP ${response.status}`); }
 if (!response.ok || result?.status !== "success") throw new Error(result?.message || `HTTP ${response.status}`);
 return result.data as T;
}
