import assert from "node:assert/strict";
import test from "node:test";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { TrafficAccountingSchema } from "@komari/proto/komari/browser/v1/browser_pb";
import { formatTrafficGB, trafficAccountingView, trafficResetDescription, trafficResetInstant } from "../src/utils/trafficDisplay.ts";

test("provider calibration and public/admin displays use identical decimal GB", () => {
  assert.equal(formatTrafficGB(50_720_000_000), "50.72 GB");
  assert.equal(formatTrafficGB(21_230_000_000), "21.23 GB");
  assert.equal(formatTrafficGB(55_720_000_000), "55.72 GB");
  assert.equal(formatTrafficGB(1_073_741_824), "1.07 GB");
});

test("typed accounting preserves follow/disabled/custom policy and exact UTC instant", () => {
  assert.equal(trafficAccountingView(undefined), undefined);
  const source = create(TrafficAccountingSchema, {
    resetDay: 31, resetTime: "12:45:00", resetTimezone: "UTC-05:30",
    nextReset: timestampFromDate(new Date("2026-11-30T18:15:00Z")),
    usedUpBytes: 50_720_000_000n, usedDownBytes: 5_000_000_000n,
    billableBytes: 55_720_000_000n, countingType: "sum", cycleAvailable: true,
  });
  const value = trafficAccountingView(source)!;
  assert.equal(value.billable, 55_720_000_000);
  assert.equal(value.cycleAvailable, true);
  assert.equal(trafficResetDescription(value), "每月 31 日 12:45（UTC-05:30）");
  assert.equal(trafficResetInstant(value.nextReset, value.resetTimezone), "2026-11-30 12:45 UTC-05:30");
  assert.equal(trafficResetDescription({ ...value, resetDay: 0 }), "不设置月度流量重置");
  assert.equal(trafficResetDescription({ ...value, resetDay: undefined }), "跟随 Agent 的流量重置设置");
  assert.match(trafficResetDescription({ ...value, resetTime: "08:00" }), /08:00/);
});

test("reset instant uses configured timezone, not the browser timezone", () => {
  assert.equal(trafficResetInstant("2026-11-05T00:00:00Z", "Asia/Shanghai"), "2026-11-05 08:00 Asia/Shanghai");
  assert.equal(trafficResetInstant("2026-11-05T00:00:00Z", "UTC+05:45"), "2026-11-05 05:45 UTC+05:45");
  assert.equal(trafficResetInstant("2026-11-05T00:00:00Z", "UTC-03:30"), "2026-11-04 20:30 UTC-03:30");
  assert.equal(trafficResetInstant("", "UTC"), "");
});
