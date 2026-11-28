import assert from "node:assert/strict";
import test from "node:test";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import type { TrafficEvidenceHour, TrafficEvidenceBytes } from "@komari/proto/komari/metrics/v1/metrics_pb";
import { attributedBytes, coverageNeedsAttention, evidenceByteLabel, evidenceFresh, evidenceBytes, hourBuckets, observedTotals, todayBucketStart } from "../src/utils/trafficEvidence.ts";

const now = Date.parse("2026-11-28T12:12:00Z") / 1_000;
const octets = (rxBytes = 0n, txBytes = 0n): TrafficEvidenceBytes => ({ $typeName: "komari.metrics.v1.TrafficEvidenceBytes", rxBytes, txBytes });
const row: TrafficEvidenceHour = {
  $typeName: "komari.metrics.v1.TrafficEvidenceHour",
  hourUtc: timestampFromDate(new Date("2026-11-28T12:00:00Z")),
  observed: octets(71_172_788n, 80_590_468n),
  coverage: { $typeName: "komari.metrics.v1.TrafficEvidenceCoverage", sampler: "ebpf", interfaceName: "eth0",
    coveredSeconds: 60, attributionSources: ["xray"], observationScope: "interface_ip",
    issues: ["sample_gap", "unmatched_ip"], latestIssues: ["unmatched_ip"], unmatchedIpBytes: 872n, invalidIpBytes: 0n },
  services: { xray: octets(88_000_000n) },
  unexplained: octets(1n),
  attributedServices: {},
  partial: true,
};

test("the current bucket renders new evidence and missing hours stay absent", () => {
  const buckets = hourBuckets([row], now, 24);
  assert.equal(buckets.length, 24);
  assert.equal(buckets.filter(({ row }) => row == null).length, 23);
  assert.equal(buckets[23].row, row);
  assert.equal(observedTotals([row]).total, 151_763_256n);
  assert.equal(evidenceByteLabel(evidenceBytes(row).rx, "en"), "71.17 MB");
});

test("raw counters and alert residual cannot enter attribution or mark capture degraded", () => {
  assert.deepEqual(attributedBytes(row), { rx: 0n, tx: 0n, total: 0n });
  assert.equal(coverageNeedsAttention(row.coverage), false);
  assert.equal(coverageNeedsAttention({ ...row.coverage!, latestIssues: ["incomplete_slice"] }), true);
  assert.equal(attributedBytes({ ...row, coverage: undefined }), undefined);
  assert.equal(attributedBytes({ ...row, coverage: { ...row.coverage!, observationScope: "mixed" } }), undefined);
  assert.equal(evidenceFresh(now - 61, now - 1, now), false);
  assert.equal(evidenceFresh(now - 59, now - 3, now), true);
});

test("the local daily card never estimates the split of a half-hour offset bucket", () => {
  const original = process.env.TZ;
  try {
    process.env.TZ = "Asia/Kolkata";
    const result = todayBucketStart(now);
    assert.equal(result.omittedEdge, true);
    assert.equal(result.firstFull, Date.parse("2026-11-27T19:00:00Z") / 1_000);
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});
