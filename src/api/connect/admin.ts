import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { JsonObject } from "@bufbuild/protobuf";
import type { Timestamp } from "@bufbuild/protobuf/wkt";
import {
  MetricMigrationState,
  type MetricDefinition as ProtoMetricDefinition,
} from "@komari/proto/komari/metrics/v1/metrics_pb";
import type {
  LocalizedText,
  Plugin as ProtoPlugin,
  PluginConfiguration as ProtoPluginConfiguration,
} from "@komari/proto/komari/plugin/v1/plugin_pb";
import type { I18nText } from "@/utils/i18nText";
import type {
  PluginConfiguration,
  PluginInfo,
} from "@/types/plugin";
import { connectClients, connectUnary } from "./client";

const textValue = (value?: LocalizedText): I18nText | undefined => {
  if (!value) return undefined;
  if (Object.keys(value.translations).length > 0) return { ...value.translations };
  return value.fallback || undefined;
};

const arbitraryValue = (value: unknown): unknown => {
  const kind = (value as { kind?: { value?: unknown } } | undefined)?.kind;
  return kind?.value;
};

const configurationValue = (
  configuration?: ProtoPluginConfiguration,
): PluginConfiguration | undefined => configuration ? {
  type: configuration.type,
  icon: configuration.icon,
  name: textValue(configuration.name),
  data: configuration.items.map((item) => ({
    key: item.key,
    name: textValue(item.name),
    required: item.required,
    type: item.type,
    options: item.options,
    default: arbitraryValue(item.defaultValue),
    help: textValue(item.help),
  })),
} : undefined;

const pluginValue = (plugin: ProtoPlugin): PluginInfo => ({
  short: plugin.shortName,
  name: textValue(plugin.name) ?? plugin.shortName,
  description: textValue(plugin.description),
  author: textValue(plugin.author),
  version: plugin.version,
  url: plugin.url,
  icon: plugin.icon,
  komari: plugin.komariVersionConstraint,
  entry: plugin.entry,
  permissions: plugin.permissions ? {
    node: plugin.permissions.node,
    allowSystemRPC: plugin.permissions.allowSystemRpc,
    allowRoutes: plugin.permissions.allowRoutes,
    allowHooks: plugin.permissions.allowHooks,
    allowHTMLInject: plugin.permissions.allowHtmlInject,
    allowExec: plugin.permissions.allowExec,
    allowListen: plugin.permissions.allowListen,
    allowAllFileAccess: plugin.permissions.allowAllFileAccess,
    maxHTTPBodyBytes: Number(plugin.permissions.maxHttpBodyBytes),
    maxChildOutputBytes: Number(plugin.permissions.maxChildOutputBytes),
    timeout: plugin.permissions.timeoutSeconds,
  } : undefined,
  configuration: configurationValue(plugin.configuration),
  pages: plugin.pages.map((page) => ({
    file: page.file,
    title: textValue(page.title),
    icon: page.icon,
    type: page.type === "redirect" ? "redirect" : "iframe",
    url: page.url,
    visibility: page.visibility === "public" ? "public" : "admin",
  })),
  enabled: plugin.enabled,
  running: plugin.running,
  last_error: plugin.lastError,
});

export const listAdminPlugins = async (signal: AbortSignal) => {
  const response = await connectUnary(
    { signal },
    (requestSignal, timeoutMs) => connectClients.plugin.listPlugins(
      {},
      { signal: requestSignal, timeoutMs },
    ),
  );
  return response.plugins.map(pluginValue);
};

export const setAdminPluginEnabled = async (input: {
  short: string;
  enabled: boolean;
  approved?: boolean;
  signal: AbortSignal;
}) => connectUnary(
  { signal: input.signal },
  (signal, timeoutMs) => connectClients.plugin.setPluginEnabled({
    shortName: input.short,
    enabled: input.enabled,
    permissionsApproved: input.approved ?? false,
  }, { signal, timeoutMs }),
);

export const getAdminPluginLogs = async (short: string, signal: AbortSignal) => {
  const response = await connectUnary(
    { signal },
    (requestSignal, timeoutMs) => connectClients.plugin.getPluginLogs(
      { shortName: short },
      { signal: requestSignal, timeoutMs },
    ),
  );
  return response.logs;
};

export const deleteAdminPlugin = (short: string, signal: AbortSignal) => connectUnary(
  { signal },
  (requestSignal, timeoutMs) => connectClients.plugin.deletePlugin(
    { shortName: short },
    { signal: requestSignal, timeoutMs },
  ),
);

export const getAdminPluginConfiguration = async (short: string, signal: AbortSignal) => {
  const response = await connectUnary(
    { signal },
    (requestSignal, timeoutMs) => connectClients.plugin.getPluginConfiguration(
      { shortName: short },
      { signal: requestSignal, timeoutMs },
    ),
  );
  return {
    configuration: configurationValue(response.configuration),
    data: (response.values ?? {}) as Record<string, unknown>,
  };
};

export const setAdminPluginConfiguration = (input: {
  short: string;
  values: Record<string, unknown>;
  signal: AbortSignal;
}) => connectUnary(
  { signal: input.signal },
  (signal, timeoutMs) => connectClients.plugin.setPluginConfiguration({
    shortName: input.short,
    values: input.values as JsonObject,
  }, { signal, timeoutMs }),
);

export interface AdminMetricDefinition {
  name: string;
  description?: I18nText | null;
  type: string;
  unit?: string;
  retention_days: number;
  metadata?: Record<string, string>;
}

const metricDefinitionValue = (definition: ProtoMetricDefinition): AdminMetricDefinition => ({
  name: definition.name,
  description: definition.description,
  type: definition.type,
  unit: definition.unit,
  retention_days: definition.retentionDays,
  metadata: definition.metadata,
});

export const listAdminMetricDefinitions = async (signal: AbortSignal) => {
  const response = await connectUnary(
    { signal },
    (requestSignal, timeoutMs) => connectClients.metrics.listMetricDefinitions(
      {},
      { signal: requestSignal, timeoutMs },
    ),
  );
  return response.definitions.map(metricDefinitionValue);
};

export const updateAdminMetricDefinition = async (input: {
  name: string;
  retentionDays: number;
  signal: AbortSignal;
}) => {
  const response = await connectUnary(
    { signal: input.signal },
    (signal, timeoutMs) => connectClients.metrics.updateMetricDefinition({
      name: input.name,
      retentionDays: input.retentionDays,
    }, { signal, timeoutMs }),
  );
  if (!response.definition) throw new Error("metric definition response is empty");
  return metricDefinitionValue(response.definition);
};

export interface DownsamplingPolicy {
  enabled: boolean;
  raw_retention: string;
  minute_retention_minutes: number;
  five_minute_retention_minutes: number;
  hour_retention_hours: number;
}

const downsamplingPolicyValue = (policy: {
  enabled: boolean;
  rawRetention: string;
  minuteRetentionMinutes: number;
  fiveMinuteRetentionMinutes: number;
  hourRetentionHours: number;
}): DownsamplingPolicy => ({
  enabled: policy.enabled,
  raw_retention: policy.rawRetention,
  minute_retention_minutes: policy.minuteRetentionMinutes,
  five_minute_retention_minutes: policy.fiveMinuteRetentionMinutes,
  hour_retention_hours: policy.hourRetentionHours,
});

export const getAdminDownsamplingPolicy = async (signal: AbortSignal) => {
  const response = await connectUnary(
    { signal },
    (requestSignal, timeoutMs) => connectClients.metrics.getDownsamplingPolicy(
      {},
      { signal: requestSignal, timeoutMs },
    ),
  );
  if (!response.policy) throw new Error("downsampling policy response is empty");
  return downsamplingPolicyValue(response.policy);
};

export const setAdminDownsamplingPolicy = async (input: DownsamplingPolicy & { signal: AbortSignal }) => {
  const response = await connectUnary(
    { signal: input.signal, timeoutMs: 30_000 },
    (signal, timeoutMs) => connectClients.metrics.setDownsamplingPolicy({
      enabled: input.enabled,
      minuteRetentionMinutes: input.minute_retention_minutes,
      fiveMinuteRetentionMinutes: input.five_minute_retention_minutes,
      hourRetentionHours: input.hour_retention_hours,
    }, { signal, timeoutMs }),
  );
  if (!response.policy) throw new Error("downsampling policy response is empty");
  return downsamplingPolicyValue(response.policy);
};

export type MigrationStatus = "idle" | "running" | "completed" | "failed" | "canceled";

export interface MigrationStatusResponse {
  status: MigrationStatus;
  is_running: boolean;
  source_driver: string;
  source_dsn: string;
  target_driver: string;
  target_dsn: string;
  total_metrics: number;
  metrics_done: number;
  current_metric: string;
  migrated_points: number;
  start_time?: string;
  end_time?: string;
  error?: string;
}

const migrationState = (state: MetricMigrationState): MigrationStatus => ({
  [MetricMigrationState.RUNNING]: "running",
  [MetricMigrationState.COMPLETED]: "completed",
  [MetricMigrationState.FAILED]: "failed",
  [MetricMigrationState.CANCELED]: "canceled",
}[state] as MigrationStatus | undefined) ?? "idle";

const migrationValue = (migration?: {
  state: MetricMigrationState;
  isRunning: boolean;
  sourceDriver: string;
  sourceDsn: string;
  targetDriver: string;
  targetDsn: string;
  totalMetrics: number;
  metricsDone: number;
  currentMetric: string;
  migratedPoints: bigint;
  startedAt?: Timestamp;
  finishedAt?: Timestamp;
  error: string;
}): MigrationStatusResponse => ({
  status: migrationState(migration?.state ?? MetricMigrationState.IDLE),
  is_running: migration?.isRunning ?? false,
  source_driver: migration?.sourceDriver ?? "",
  source_dsn: migration?.sourceDsn ?? "",
  target_driver: migration?.targetDriver ?? "",
  target_dsn: migration?.targetDsn ?? "",
  total_metrics: migration?.totalMetrics ?? 0,
  metrics_done: migration?.metricsDone ?? 0,
  current_metric: migration?.currentMetric ?? "",
  migrated_points: Number(migration?.migratedPoints ?? 0n),
  start_time: migration?.startedAt ? timestampDate(migration.startedAt).toISOString() : undefined,
  end_time: migration?.finishedAt ? timestampDate(migration.finishedAt).toISOString() : undefined,
  error: migration?.error || undefined,
});

export const getAdminMetricMigrationStatus = async (signal: AbortSignal) => {
  const response = await connectUnary(
    { signal },
    (requestSignal, timeoutMs) => connectClients.metrics.getMetricMigrationStatus(
      {},
      { signal: requestSignal, timeoutMs },
    ),
  );
  return migrationValue(response.migration);
};

export const startAdminMetricMigration = async (sourceDsn: string, signal: AbortSignal) => {
  const response = await connectUnary(
    { signal },
    (requestSignal, timeoutMs) => connectClients.metrics.startMetricMigration(
      { sourceDsn },
      { signal: requestSignal, timeoutMs },
    ),
  );
  return migrationValue(response.migration);
};

export const cancelAdminMetricMigration = async (signal: AbortSignal) => {
  const response = await connectUnary(
    { signal },
    (requestSignal, timeoutMs) => connectClients.metrics.cancelMetricMigration(
      {},
      { signal: requestSignal, timeoutMs },
    ),
  );
  return migrationValue(response.migration);
};
