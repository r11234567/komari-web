import assert from "node:assert/strict";
import test from "node:test";
import { metricSeriesToLiveRecords } from "../src/utils/liveMetricRecords.ts";
import type { MetricSeries } from "../src/types/metrics";

test("history keeps identical GPU models separate and joins metrics by device index", () => {
  const time = "2026-10-25T00:00:00Z";
  const series = [
    ["gpu.device.usage", "1", 82], ["gpu.memory.used", "0", 100],
    ["gpu.device.usage", "0", 15], ["gpu.memory.used", "1", 900],
    ["gpu.temperature", "1", 71], ["gpu.temperature", "0", 42],
  ].map(([metric, index, value]) => ({
    metric_key: metric, tags: { device_index: index, device_name: "Same GPU model" },
    points: [{ time, value }],
  })) as MetricSeries[];
  const [record] = metricSeriesToLiveRecords(series);
  assert.equal(record.gpu?.count, 2);
  assert.deepEqual(record.gpu?.detailed_info.map(device => ({
    usage: device.utilization, memory: device.memory_used, temperature: device.temperature,
  })), [
    { usage: 15, memory: 100, temperature: 42 },
    { usage: 82, memory: 900, temperature: 71 },
  ]);
});

test("history keeps missing GPU temperature as null while preserving true 0 C and decimals", () => {
  const time = "2026-10-25T00:00:00Z";
  const series = [
    ["gpu.device.usage", "0", 30],
    ["gpu.device.usage", "1", 50],
    ["gpu.temperature", "1", 0],
    ["gpu.device.usage", "2", 70],
    ["gpu.temperature", "2", 64.5],
  ].map(([metric, index, value]) => ({
    metric_key: metric, tags: { device_index: index, device_name: `GPU ${index}` },
    points: [{ time, value }],
  })) as MetricSeries[];
  const [record] = metricSeriesToLiveRecords(series);
  assert.deepEqual(record.gpu?.detailed_info.map(device => device.temperature), [null, 0, 64.5]);
});
