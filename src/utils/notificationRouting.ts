export const alertKinds = [
 "offline", "online", "load", "traffic",
 "expire", "renew", "login", "ping_loss",
 "ping_latency", "traffic_report_daily", "traffic_report_weekly",
 "traffic_report_monthly", "return_route", "mainland_reachability",
] as const;
export type NotificationRoutes = Record<string, string[]>;

export function normalizeRouteDraft(raw: unknown): NotificationRoutes {
 const source = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
 return Object.fromEntries(alertKinds.map((kind) => [kind, Array.isArray(source[kind]) ? [...new Set((source[kind] as unknown[]).filter((v): v is string => typeof v === "string" && !!v.trim()).map((v) => v.trim()))] : []]));
}
export function toggleRoute(routes: NotificationRoutes, kind: string, channel: string, checked: boolean): NotificationRoutes {
 const prior = routes[kind] || [];
 return {...routes, [kind]: checked ? [...new Set([...prior, channel])] : prior.filter((value) => value !== channel)};
}
export function digestSecondsInput(value: string, invalidMessage = "Expected a whole number from 1 to 3600 seconds."): number {
 if (!/^\d+$/.test(value.trim())) throw new RangeError(invalidMessage);
 const seconds = Number(value);
 if (!Number.isInteger(seconds) || seconds < 1 || seconds > 3600) throw new RangeError(invalidMessage);
 return seconds;
}
export async function notificationRequest<T>(url: string, init?: RequestInit): Promise<T> {
 const response = await fetch(url, {cache:"no-store", ...init});
 let result;
 try { result = await response.json(); } catch { throw new Error(`HTTP ${response.status}`); }
 if (!response.ok || result?.status !== "success") throw new Error(result?.message || `HTTP ${response.status}`);
 return result.data as T;
}
