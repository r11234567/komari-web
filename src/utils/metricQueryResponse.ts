import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { MetricsSeries } from "@komari/proto/komari/metrics/v1/metrics_pb";
import type { MetricSeries } from "../types/metrics";

const seconds = (value?: { seconds: bigint; nanos: number }) =>
  value ? Number(value.seconds) + value.nanos / 1e9 : undefined;
const date = (value?: Parameters<typeof timestampDate>[0]) =>
  value ? timestampDate(value).toISOString() : undefined;

export const mapMetricQuerySeries = (series: MetricsSeries): MetricSeries => {
  const span = (value: MetricsSeries["sources"][number]) => ({
    start: date(value.startTime) ?? "",
    end: date(value.endTime) ?? "",
    source_interval_seconds: seconds(value.sourceInterval) ?? 0,
    reason: value.reason,
  });
  return {
    metric_key: series.metric, entity_id: series.agentId, tags: series.labels,
    type: series.type, unit: series.unit, retention_days: series.retentionDays,
    downsampled: series.downsampled, downsample_algorithm: series.aggregation,
    interval_seconds: seconds(series.interval),
    requested_interval_seconds: seconds(series.requestedInterval),
    coverage: series.coverage, coverage_start: date(series.coverageStart),
    coverage_end: date(series.coverageEnd), boundary_adjusted: series.boundaryAdjusted,
    summarized_through: series.summarizedThrough.toString(),
    accepted_through: series.acceptedThrough.toString(),
    sources: series.sources.map(span), gaps: series.gaps.map(span),
    count: series.queryPoints.length,
    points: series.queryPoints.map(point => ({
      time: date(point.observedAt) ?? "", value: point.value ?? null,
      count: point.sampleCount, tags: series.labels, labels: point.labels,
      source_interval_seconds: seconds(point.sourceInterval),
      coverage: point.coverage, coverage_reason: point.coverageReason,
    })),
  };
};
