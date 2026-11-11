import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  formatChartTitle,
  getMetricLabel,
} from "../src/utils/metricSeries.ts";

const locales = {
  en: JSON.parse(
    readFileSync(
      new URL("../src/i18n/locales/en.json", import.meta.url),
      "utf8",
    ),
  ),
  zh_CN: JSON.parse(
    readFileSync(
      new URL("../src/i18n/locales/zh_CN.json", import.meta.url),
      "utf8",
    ),
  ),
  zh_TW: JSON.parse(
    readFileSync(
      new URL("../src/i18n/locales/zh_TW.json", import.meta.url),
      "utf8",
    ),
  ),
  ja_JP: JSON.parse(
    readFileSync(
      new URL("../src/i18n/locales/ja_JP.json", import.meta.url),
      "utf8",
    ),
  ),
  id_ID: JSON.parse(
    readFileSync(
      new URL("../src/i18n/locales/id_ID.json", import.meta.url),
      "utf8",
    ),
  ),
};

const makeTranslator = (localeData: any) => {
  return ((key: string, defaultValueOrOptions?: any) => {
    const parts = key.split(".");
    let current: any = localeData;
    for (const part of parts) {
      if (current && typeof current === "object" && part in current) {
        current = current[part];
      } else {
        return typeof defaultValueOrOptions === "string"
          ? defaultValueOrOptions
          : key;
      }
    }
    return typeof current === "string" ? current : key;
  }) as any;
};

test("all locales define chart.titles for default dashboard charts", () => {
  const expectedKeys = ["cpu", "memory", "disk", "network", "latency", "gpu"];
  for (const [lng, data] of Object.entries(locales)) {
    assert.ok(data.chart?.titles, `Locale ${lng} is missing chart.titles`);
    for (const key of expectedKeys) {
      assert.ok(
        data.chart.titles[key],
        `Locale ${lng} is missing chart.titles.${key}`,
      );
    }
  }

  assert.equal(locales.zh_CN.chart.titles.latency, "延迟");
  assert.equal(locales.zh_TW.chart.titles.latency, "延遲");
  assert.equal(locales.ja_JP.chart.titles.latency, "遅延");
  assert.equal(locales.id_ID.chart.titles.latency, "Latensi");
  assert.equal(locales.en.chart.titles.latency, "Latency");
});

test("formatChartTitle translates default charts across locales", () => {
  const zhTranslator = makeTranslator(locales.zh_CN);
  const enTranslator = makeTranslator(locales.en);
  const jaTranslator = makeTranslator(locales.ja_JP);
  const twTranslator = makeTranslator(locales.zh_TW);

  // Even if title is stored as English 'Latency' or id is 'ping'
  assert.equal(
    formatChartTitle({ id: "ping", title: "Latency" }, zhTranslator),
    "延迟",
  );
  assert.equal(
    formatChartTitle({ id: "ping", title: "Latency" }, twTranslator),
    "延遲",
  );
  assert.equal(
    formatChartTitle({ id: "ping", title: "Latency" }, jaTranslator),
    "遅延",
  );
  assert.equal(
    formatChartTitle({ id: "ping", title: "Latency" }, enTranslator),
    "Latency",
  );

  // Default CPU, Memory, Disk, Network
  assert.equal(
    formatChartTitle({ id: "memory", title: "Memory" }, zhTranslator),
    "内存",
  );
  assert.equal(
    formatChartTitle({ id: "disk", title: "Disk" }, zhTranslator),
    "磁盘",
  );
  assert.equal(
    formatChartTitle({ id: "network", title: "Network" }, zhTranslator),
    "网络",
  );
  assert.equal(
    formatChartTitle({ id: "cpu", title: "CPU" }, zhTranslator),
    "CPU",
  );

  // Custom user titles remain preserved if not a default keyword
  assert.equal(
    formatChartTitle({ id: "custom-1", title: "My Special Metric" }, zhTranslator),
    "My Special Metric",
  );
});

test("getMetricLabel localizes system metrics from settings.metrics.system", () => {
  const zhTranslator = makeTranslator(locales.zh_CN);
  const enTranslator = makeTranslator(locales.en);
  const jaTranslator = makeTranslator(locales.ja_JP);

  assert.equal(
    getMetricLabel("cpu.usage", undefined, zhTranslator),
    "CPU 使用率",
  );
  assert.equal(
    getMetricLabel("cpu.usage", undefined, enTranslator),
    "CPU usage",
  );
  assert.equal(
    getMetricLabel("cpu.usage", undefined, jaTranslator),
    "CPU使用率",
  );

  assert.equal(
    getMetricLabel("memory.used", undefined, zhTranslator),
    "已用内存",
  );
  assert.equal(
    getMetricLabel("ping.latency_ms", undefined, zhTranslator),
    "Ping 延迟",
  );
});

test("charts keep explicit unknown buckets while using each series own timestamps", () => {
  const loadChartSource = readFileSync(
    new URL("../src/pages/instance/LoadChart.tsx", import.meta.url),
    "utf8",
  );
  const miniPingSource = readFileSync(
    new URL("../src/components/MiniPingChart.tsx", import.meta.url),
    "utf8",
  );

  assert.ok(
    loadChartSource.includes("connectNulls"),
    "LoadChart must specify connectNulls",
  );
  assert.ok(
    loadChartSource.includes("connectNulls={false}") && loadChartSource.includes("metricLineRows(chartRows, item.dataKey)"),
    "LoadChart must break at explicit gaps without treating other series timestamps as gaps",
  );

  assert.ok(
    miniPingSource.includes("connectNulls"),
    "MiniPingChart must specify connectNulls",
  );
  assert.ok(
    miniPingSource.includes("connectNulls={false}") && miniPingSource.includes("metricLineRows(chartData, item.dataKey)"),
    "MiniPingChart must preserve unavailable buckets",
  );
});

test("sparse ping lines retain continuity and EWMA resets at explicit unknown buckets", async () => {
  const { applyMetricEwma, trimMetricChartBoundaryRows, metricLineRows } = await import(
    "../src/utils/metricSeries.ts"
  );

  // Simulate 3 ping targets reporting at offset intervals (e.g. 60s period with phase shift)
  // Target 1: t=0, t=60, t=120
  // Target 2: t=20, t=80, t=140
  // Target 3: t=40, t=100, t=160
  const rows = [
    { time: "2026-11-08T00:00:00Z", t1: 150 },
    { time: "2026-11-08T00:00:20Z", t2: 160 },
    { time: "2026-11-08T00:00:40Z", t3: 170 },
    { time: "2026-11-08T00:01:00Z", t1: 152 },
    { time: "2026-11-08T00:01:20Z", t2: 162 },
    { time: "2026-11-08T00:01:40Z", t3: 168 },
    { time: "2026-11-08T00:02:00Z", t1: 148 },
    { time: "2026-11-08T00:02:20Z", t2: 159 },
    { time: "2026-11-08T00:02:40Z", t3: 172 },
  ];

  const series = [
    { dataKey: "t1" },
    { dataKey: "t2" },
    { dataKey: "t3" },
  ];

  const trimmed = trimMetricChartBoundaryRows(rows, ["t1", "t2", "t3"]);
  assert.equal(trimmed.length, 9);

  // EWMA should calculate over existing numbers and leave inter-bucket undefined values intact
  const smoothed = applyMetricEwma(trimmed, series, true);
  assert.equal(smoothed.length, 9);

  // For series t1, valid points are at index 0, 3, 6; other indices are undefined
  assert.equal(smoothed[0].t1, 150);
  assert.equal(smoothed[1].t1, undefined);
  assert.ok(typeof smoothed[3].t1 === "number");
  assert.equal(smoothed[4].t1, undefined);
  assert.ok(typeof smoothed[6].t1 === "number");

  assert.deepEqual(metricLineRows(smoothed, "t1").map(row=>row.t1), [150, smoothed[3].t1, smoothed[6].t1]);
  const withGap = [{time:"a",t1:100},{time:"b",t2:42},{time:"c",t1:null},{time:"d",t1:200}];
  const gapSmoothed=applyMetricEwma(withGap,series,true);
  assert.deepEqual(metricLineRows(gapSmoothed,"t1").map(row=>row.t1),[100,null,200]);
});
