import type { TrafficAccounting } from "@komari/proto/komari/browser/v1/browser_pb";
import { timestampDate } from "@bufbuild/protobuf/wkt";

export type TrafficAccountingView = {
  resetDay?: number;
  resetTime: string;
  resetTimezone: string;
  cycleStart: string;
  nextReset: string;
  up: number;
  down: number;
  billable: number;
  countingType: string;
  cycleAvailable: boolean;
};

export function trafficAccountingView(value?: TrafficAccounting): TrafficAccountingView | undefined {
  if (!value) return undefined; // Compatible with servers predating this view.
  return {
    resetDay: value.resetDay,
    resetTime: value.resetTime,
    resetTimezone: value.resetTimezone,
    cycleStart: value.cycleStart ? timestampDate(value.cycleStart).toISOString() : "",
    nextReset: value.nextReset ? timestampDate(value.nextReset).toISOString() : "",
    up: Number(value.usedUpBytes), down: Number(value.usedDownBytes),
    billable: Number(value.billableBytes), countingType: value.countingType,
    cycleAvailable: value.cycleAvailable,
  };
}

// Billing traffic uses the same decimal GB as provider calibration. RAM, disks
// and transfer rates keep their existing binary formatting.
export function formatTrafficGB(bytes: number): string {
  return `${(Math.max(0, bytes) / 1_000_000_000).toFixed(2)} GB`;
}

export function trafficResetDescription(value: TrafficAccountingView): string {
  if (value.resetDay == null) return "跟随 Agent 的流量重置设置";
  if (value.resetDay === 0) return "不设置月度流量重置";
  const clock = value.resetTime.length === 8 && value.resetTime.endsWith(":00") ? value.resetTime.slice(0, 5) : value.resetTime;
  return `每月 ${value.resetDay} 日 ${clock}（${value.resetTimezone}）`;
}

export function trafficResetInstant(instant: string, timezone: string): string {
  if (!instant) return "";
  const date = new Date(instant);
  const fixed = /^UTC([+-])(\d{2}):(\d{2})$/.exec(timezone);
  if (fixed) {
    const minutes = (Number(fixed[2]) * 60 + Number(fixed[3])) * (fixed[1] === "-" ? -1 : 1);
    return `${new Date(date.getTime() + minutes * 60_000).toISOString().slice(0, 16).replace("T", " ")} ${timezone}`;
  }
  return `${new Intl.DateTimeFormat("sv-SE", { timeZone: timezone || "UTC", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date)} ${timezone || "UTC"}`;
}

export const TRAFFIC_ACCOUNTING_CHANGED = "komari:traffic-accounting-changed";
