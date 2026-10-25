import { metricSeriesToLiveRecords } from "../../utils/liveMetricRecords";
import { timestampDate, timestampFromDate } from "@bufbuild/protobuf/wkt";
import type { AgentReport } from "@komari/proto/komari/report/v1/report_pb";
import { connectClients, connectUnary } from "./client";
import type {
  MetricDefinition,
  MetricSeries,
  PingMetricStat,
  PublicPingTask,
} from "@/types/metrics";
import type { Record as LiveRecord } from "@/types/LiveData";

export const queryPublicMetrics = async (input: {
  agentIds?: string[];
  metrics: string[];
  hours?: number;
  start?: Date;
  end?: Date;
  maxPoints?: number;
  aggregation?: string;
  fillEmpty?: boolean;
  downsample?: boolean;
  signal: AbortSignal;
}) => {
  const end = input.end ?? new Date();
  const start = input.start ?? new Date(end.getTime() - (input.hours ?? 4) * 3_600_000);
  const response = await connectUnary(
    { signal: input.signal, timeoutMs: 30_000 },
    (signal, timeoutMs) => connectClients.metrics.queryMetrics({
      agentIds: input.agentIds ?? [],
      metrics: input.metrics,
      startTime: timestampFromDate(start),
      endTime: timestampFromDate(end),
      maxPoints: input.maxPoints ?? 500,
      aggregation: input.aggregation ?? "avg",
      fillEmpty: input.fillEmpty ?? false,
      downsample: input.downsample,
    }, { signal, timeoutMs }),
  );
  return response.series.map<MetricSeries>((series) => ({
    metric_key: series.metric,
    entity_id: series.agentId,
    tags: series.labels,
    type: series.type,
    unit: series.unit,
    retention_days: series.retentionDays,
    downsampled: series.downsampled,
    downsample_algorithm: series.aggregation,
    interval_seconds: series.interval ? Number(series.interval.seconds) : undefined,
    count: series.queryPoints.length,
    points: series.queryPoints.map((point) => ({
      time: point.observedAt ? timestampDate(point.observedAt).toISOString() : "",
      value: point.value ?? null,
      count: point.sampleCount,
      tags: series.labels,
      labels: point.labels,
    })),
  }));
};

export const listPublicMetricDefinitions = async (signal: AbortSignal) => {
  const response = await connectUnary(
    { signal },
    (requestSignal, timeoutMs) => connectClients.metrics.listMetricDefinitions({}, { signal: requestSignal, timeoutMs }),
  );
  return response.definitions.map<MetricDefinition>((definition) => ({
    name: definition.name,
    description: definition.description,
    type: definition.type,
    unit: definition.unit,
    retention_days: definition.retentionDays,
  }));
};

export const listPublicPingTasks = async (signal: AbortSignal) => {
  const response = await connectUnary(
    { signal },
    (requestSignal, timeoutMs) => connectClients.metrics.listPingTasks({}, { signal: requestSignal, timeoutMs }),
  );
  return response.tasks.map<PublicPingTask>((task) => ({
    id: Number(task.taskId),
    name: task.name,
    type: task.type,
    interval: task.interval ? Number(task.interval.seconds) : 0,
  }));
};

export const getPublicPingStats = async (input: {
  agentIds: string[];
  hours?: number;
  start?: Date;
  end?: Date;
  maxPoints?: number;
  signal: AbortSignal;
}) => {
  const end = input.end ?? new Date();
  const start = input.start ?? new Date(end.getTime() - (input.hours ?? 4) * 3_600_000);
  const response = await connectUnary(
    { signal: input.signal, timeoutMs: 30_000 },
    (signal, timeoutMs) => connectClients.metrics.getPingStats({
      agentIds: input.agentIds,
      startTime: timestampFromDate(start),
      endTime: timestampFromDate(end),
      maxPoints: input.maxPoints ?? 500,
    }, { signal, timeoutMs }),
  );
  return response.stats.map<PingMetricStat>((stat) => ({
    entity_id: stat.agentId,
    task_id: stat.taskId.toString(),
    name: stat.name,
    type: stat.type,
    interval: stat.probeInterval ? Number(stat.probeInterval.seconds) : 0,
    tags: stat.tags,
    total: stat.total,
    valid: stat.valid,
    loss: stat.lossPercent,
    loss_approximate: stat.lossApproximate,
    min: stat.minimum,
    max: stat.maximum,
    avg: stat.average,
    latest: stat.latest,
    p50: stat.p50,
    p99: stat.p99,
    stddev: stat.standardDeviation,
    p99_p50_ratio: stat.p99P50Ratio,
  }));
};

export const reportToLiveRecord = (report?: AgentReport): LiveRecord => {
  const resources = report?.resources;
  const network = report?.networkInterfaces.find((item) => item.name === "aggregate") ?? report?.networkInterfaces[0];
  const disk = report?.disks.find((item) => item.mountPoint === "aggregate") ?? report?.disks[0];
  const gpus = resources?.gpus ?? [];
  const gpuDevices = gpus.map((gpu) => ({
    name: gpu.name,
    memory_total: Number(gpu.memoryTotalBytes ?? 0n),
    memory_used: Number(gpu.memoryUsedBytes ?? 0n),
    utilization: gpu.utilizationPercent ?? 0,
    temperature: gpu.temperatureCelsius ?? 0,
  }));
  // Only devices that actually reported utilization count toward the average;
  // a model-only report must not average to a permanent zero.
  const measuredGpus = gpus.filter((gpu) => gpu.utilizationPercent !== undefined);
  const gpuAverage = measuredGpus.length
    ? measuredGpus.reduce((sum, gpu) => sum + (gpu.utilizationPercent ?? 0), 0) / measuredGpus.length
    : undefined;
  return {
    cpu: { usage: resources?.cpuPercent ?? 0 },
    ram: { used: Number(resources?.memoryUsedBytes ?? 0n) },
    swap: { used: Number(resources?.swapUsedBytes ?? 0n) },
    load: { load1: resources?.loadAverage[0] ?? 0, load5: resources?.loadAverage[1] ?? 0, load15: resources?.loadAverage[2] ?? 0 },
    disk: { used: Number(disk?.usedBytes ?? 0n) },
    network: {
      up: Number(network?.bytesSentPerSecond ?? 0n),
      down: Number(network?.bytesReceivedPerSecond ?? 0n),
      totalUp: Number(network?.bytesSent ?? 0n),
      totalDown: Number(network?.bytesReceived ?? 0n),
    },
    connections: { tcp: Number(resources?.tcpConnectionCount ?? 0n), udp: Number(resources?.udpConnectionCount ?? 0n) },
    gpu: gpus.length
      ? { count: gpus.length, average_usage: gpuAverage ?? 0, detailed_info: gpuDevices }
      : undefined,
    uptime: report?.system?.uptime ? Number(report.system.uptime.seconds) : 0,
    process: Number(resources?.processCount ?? 0n),
    message: report?.diagnosticMessage ?? "",
    updated_at: report?.observedAt ? timestampDate(report.observedAt).toISOString() : "",
  };
};

const RECENT_LIVE_METRICS = [
  "cpu.usage",
  "memory.used",
  "swap.used",
  "load.average",
  "disk.used",
  "net.in.rate",
  "net.out.rate",
  "net.total.up",
  "net.total.down",
  "process.count",
  "connections.tcp",
  "connections.udp",
  "gpu.usage",
  "gpu.device.usage",
  "gpu.memory.used",
  "gpu.memory.total",
  "gpu.temperature",
] as const;

export const queryRecentLiveRecords = async (input: {
  agentId: string;
  hours?: number;
  maxPoints?: number;
  signal: AbortSignal;
}) => {
  const series = await queryPublicMetrics({
    agentIds: [input.agentId],
    metrics: [...RECENT_LIVE_METRICS],
    hours: input.hours ?? 0.5,
    maxPoints: input.maxPoints ?? 150,
    aggregation: "avg",
    fillEmpty: false,
    signal: input.signal,
  });
  return metricSeriesToLiveRecords(series);
};
