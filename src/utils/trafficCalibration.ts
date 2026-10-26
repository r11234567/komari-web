// Provider billing uses decimal GB. Keep input as decimal text until the exact
// integer-byte conversion; never parseFloat/round a provider value silently.
export const GB_BYTES = 1_000_000_000;
export type TrafficUsage = { up: number; down: number };
export type CountingType = "sum" | "max" | "min" | "up" | "down";
export const countingTypeLabels: Record<CountingType, string> = { sum: "上传 + 下载", max: "上下行较大值", min: "上下行较小值", up: "仅上传", down: "仅下载" };
export type TrafficPolicy = {
  traffic_reset_day: number | null;
  traffic_reset_time: string;
  traffic_reset_timezone: string;
  next_reset: string;
};
export type CalibrationSnapshot = {
  cycle: string;
  cycle_start: string;
  cycle_end: string;
  raw: TrafficUsage;
  adjustment: TrafficUsage;
  effective: TrafficUsage;
  history_complete?: boolean;
  calibration_warning?: string;
  history: Array<{
    calibration_id: string;
    mode?: string;
    billable_offset?: number;
    target_total?: number;
    target: TrafficUsage;
    adjustment: TrafficUsage;
    operator?: string;
    created_at: string;
  }>;
};
export type CalibrationResponse = {
  available: boolean;
  counting_type?: CountingType;
  reason?: string;
  snapshot?: CalibrationSnapshot;
};

export function gbToBytes(input: string): number {
  const value = input.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) {
    throw new Error("请输入非负 GB 数值，最多两位小数");
  }
  const [whole, fraction = ""] = value.split(".");
  const bytes = BigInt(whole) * 1_000_000_000n + BigInt(fraction.padEnd(2, "0")) * 10_000_000n;
  if (bytes > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("流量数值超出支持范围");
  return Number(bytes);
}

export function bytesToGB(bytes: number): string {
  if (!Number.isSafeInteger(bytes)) throw new Error("流量超出精确显示范围");
  return (bytes / GB_BYTES).toFixed(2);
}

export function calibrationTargets(snapshot: CalibrationSnapshot, up: string, down: string) {
  // Unedited rounded fields must preserve every byte of the original value.
  return {
    target_up: up.trim() === bytesToGB(snapshot.effective.up) ? snapshot.effective.up : gbToBytes(up),
    target_down: down.trim() === bytesToGB(snapshot.effective.down) ? snapshot.effective.down : gbToBytes(down),
  };
}

export function billableUsage(value: TrafficUsage, kind: CountingType): number {
  let result: number;
  switch (kind) {
    case "sum": result = value.up + value.down; break;
    case "up": result = value.up; break;
    case "down": result = value.down; break;
    case "min": result = Math.min(value.up, value.down); break;
    default: result = Math.max(value.up, value.down);
  }
  if (!Number.isSafeInteger(result) || result < 0) throw new Error("流量超出精确计费范围");
  return result;
}

export function calibrationTotalTarget(snapshot: CalibrationSnapshot, kind: CountingType, total: string) {
  const current = billableUsage(snapshot.effective, kind);
  return { target_total: total.trim() === bytesToGB(current) ? current : gbToBytes(total), counting_type: kind };
}

export function trafficResetPayload(day: string, clock: string, timezone: string) {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(clock)) throw new Error("重置时间必须为有效时分");
  if (day !== "follow" && (!/^\d{1,2}$/.test(day) || Number(day) > 31)) throw new Error("重置日必须为 0–31");
  if (!timezone.trim()) throw new Error("请选择 UTC 偏移或时区");
  return {
    traffic_reset_day: day === "follow" ? null : Number(day),
    traffic_reset_time: clock.length === 5 ? `${clock}:00` : clock,
    traffic_reset_timezone: timezone.trim(),
  };
}

export async function trafficRequest<T>(url: string, signal: AbortSignal, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    signal,
    ...(body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  const payload = await response.json();
  if (!response.ok || payload?.status !== "success") throw new Error(payload?.message || `请求失败 (${response.status})`);
  return payload.data as T;
}
