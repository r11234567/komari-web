import { durationFromMs, timestampDate } from "@bufbuild/protobuf/wkt";
import type { Timestamp } from "@bufbuild/protobuf/wkt";
import {
  DashboardAlertKind as ProtoAlertKind,
  DashboardChart as ProtoChart,
  DashboardSection as ProtoSection,
} from "@komari/proto/komari/admin/v1/dashboard_pb";
import type {
  DashboardAlertItem as ProtoAlertItem,
  DashboardAlertSummary as ProtoAlertSummary,
  DashboardCharts as ProtoCharts,
  DashboardDatabaseStore as ProtoDatabaseStore,
  DashboardResourceRankItem as ProtoResourceRankItem,
  DashboardSummary as ProtoSummary,
} from "@komari/proto/komari/admin/v1/dashboard_pb";
import { connectClients, connectUnary } from "@/api/connect/client";
import type {
  DashboardAlertItemsResponse,
  DashboardAlertKind,
  DashboardAlertLatest,
  DashboardAlerts,
  DashboardAlertSummary,
  DashboardChartsData,
  DashboardData,
  DashboardDatabaseStatus,
  DashboardLatencySummary,
  DashboardResourceRankItem,
  DashboardTrafficBucket,
} from "@/utils/dashboard";

const byteCount = (value: bigint) => {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) ? numeric : Number.MAX_SAFE_INTEGER;
};

const trafficTrendWindow = durationFromMs(24 * 60 * 60 * 1000);
const trafficTrendInterval = durationFromMs(20 * 60 * 1000);

const trafficBucketLabel = (date: Date) => {
  const part = (value: number) => String(value).padStart(2, "0");
  return `${part(date.getMonth() + 1)}-${part(date.getDate())} ${part(date.getHours())}:${part(date.getMinutes())}`;
};

export async function requestTrafficTrend(signal: AbortSignal): Promise<DashboardTrafficBucket[]> {
  const response = await connectUnary({ signal }, (requestSignal, timeoutMs) =>
    connectClients.browser.getTrafficTrend(
      { window: trafficTrendWindow, interval: trafficTrendInterval },
      { signal: requestSignal, timeoutMs },
    ),
  );
  return response.buckets.map((bucket) => {
    const startTime = bucket.startTime ? timestampDate(bucket.startTime) : null;
    return {
      hour: startTime ? trafficBucketLabel(startTime) : "-",
      timestamp: startTime?.getTime() ?? 0,
      up: byteCount(bucket.uploadBytes),
      down: byteCount(bucket.downloadBytes),
    };
  });
}

const isoOrNull = (value?: Timestamp) => (value ? timestampDate(value).toISOString() : null);
const isoOrUndefined = (value?: Timestamp) => (value ? timestampDate(value).toISOString() : undefined);
const textOrUndefined = (value: string) => value || undefined;

const summarySectionByName: Record<string, ProtoSection> = {
  servers: ProtoSection.SERVERS,
  resources: ProtoSection.RESOURCES,
  storage: ProtoSection.STORAGE,
  return_route: ProtoSection.RETURN_ROUTE,
  alerts: ProtoSection.ALERTS,
};

const chartByName: Record<string, ProtoChart> = {
  traffic: ProtoChart.TRAFFIC,
  latency: ProtoChart.LATENCY,
  latency_jitter: ProtoChart.LATENCY_JITTER,
  packet_loss: ProtoChart.PACKET_LOSS,
};

const alertKindToProto: Record<DashboardAlertKind, ProtoAlertKind> = {
  offline: ProtoAlertKind.OFFLINE,
  resource: ProtoAlertKind.RESOURCE,
  latency_loss: ProtoAlertKind.LATENCY_LOSS,
  traffic: ProtoAlertKind.TRAFFIC,
  return_route: ProtoAlertKind.RETURN_ROUTE,
  billing: ProtoAlertKind.BILLING,
};

const alertKindFromProto = (kind: ProtoAlertKind): DashboardAlertKind | undefined => {
  switch (kind) {
    case ProtoAlertKind.OFFLINE:
      return "offline";
    case ProtoAlertKind.RESOURCE:
      return "resource";
    case ProtoAlertKind.LATENCY_LOSS:
      return "latency_loss";
    case ProtoAlertKind.TRAFFIC:
      return "traffic";
    case ProtoAlertKind.RETURN_ROUTE:
      return "return_route";
    case ProtoAlertKind.BILLING:
      return "billing";
    default:
      return undefined;
  }
};

const selectedSections = (sections: string[]) => sections
  .map((section) => summarySectionByName[section])
  .filter((section): section is ProtoSection => section !== undefined);

const selectedCharts = (charts: string[]) => charts
  .map((chart) => chartByName[chart])
  .filter((chart): chart is ProtoChart => chart !== undefined);

const resourceRank = (items: ProtoResourceRankItem[]): DashboardResourceRankItem[] => items.map((item) => ({
  uuid: item.uuid,
  name: item.name,
  cpu: item.cpuPercent,
  memory: item.memoryPercent,
  disk: item.diskPercent,
  detail_url: textOrUndefined(item.detailUrl),
}));

const databaseStore = (store?: ProtoDatabaseStore): DashboardDatabaseStatus => ({
  driver: store?.driver ?? "",
  location: store?.location ?? "",
  size: store?.sizeBytes === undefined ? null : byteCount(store.sizeBytes),
  files: store?.files
    ? {
      database: byteCount(store.files.databaseBytes),
      wal: byteCount(store.files.walBytes),
      shm: byteCount(store.files.shmBytes),
    }
    : undefined,
  error: textOrUndefined(store?.error ?? ""),
});

const alertLatest = (item?: ProtoAlertItem): DashboardAlertLatest | undefined => item
  ? {
    title: item.title,
    node_name: textOrUndefined(item.nodeName),
    node_uuid: textOrUndefined(item.nodeUuid),
    task_id: item.taskId || undefined,
    task_name: textOrUndefined(item.taskName),
    occurred_at: isoOrUndefined(item.occurredAt),
    due_at: isoOrUndefined(item.dueAt),
  }
  : undefined;

const alertSummary = (summary?: ProtoAlertSummary): DashboardAlertSummary => ({
  current: summary?.current ?? 0,
  affected_nodes: summary?.affectedNodes ?? 0,
  recovered_today: summary?.recoveredToday ?? 0,
  latest_alert: alertLatest(summary?.latestAlert),
  error: textOrUndefined(summary?.error ?? ""),
});

const emptyAlerts = (): DashboardAlerts => ({
  resource: alertSummary(),
  offline: alertSummary(),
  latency_loss: alertSummary(),
  traffic: alertSummary(),
  return_route: alertSummary(),
  billing: alertSummary(),
});

const summaryData = (summary?: ProtoSummary): DashboardData => ({
  servers: {
    total: summary?.servers?.total ?? 0,
    online: summary?.servers?.online ?? 0,
    offline: summary?.servers?.offline ?? 0,
    offline_nodes: (summary?.servers?.offlineNodes ?? []).map((node) => ({
      uuid: node.uuid,
      name: node.name,
      region: node.region,
      last_seen: isoOrNull(node.lastSeen),
    })),
  },
  resources: {
    cpu: resourceRank(summary?.resources?.cpu ?? []),
    memory: resourceRank(summary?.resources?.memory ?? []),
    disk: resourceRank(summary?.resources?.disk ?? []),
  },
  database: {
    type: summary?.database?.type ?? "",
    size: summary?.database ? byteCount(summary.database.totalBytes) : 0,
    main: databaseStore(summary?.database?.main),
    monitoring: databaseStore(summary?.database?.monitoring),
    local_total: summary?.database?.localTotalBytes === undefined
      ? null
      : byteCount(summary.database.localTotalBytes),
  },
  storage: {
    database_files: summary?.storage ? byteCount(summary.storage.databaseFileBytes) : 0,
    wal: summary?.storage ? byteCount(summary.storage.walBytes) : 0,
    shm: summary?.storage ? byteCount(summary.storage.shmBytes) : 0,
    retention_days: summary?.storage?.retentionDays ?? 0,
    last_compacted_at: isoOrNull(summary?.storage?.lastCompactedAt),
  },
  return_route: {
    tasks: Number(summary?.returnRoute?.tasks ?? 0n),
    active: Number(summary?.returnRoute?.active ?? 0n),
    healthy: Number(summary?.returnRoute?.healthy ?? 0n),
    switched: Number(summary?.returnRoute?.switched ?? 0n),
    abnormal: Number(summary?.returnRoute?.abnormal ?? 0n),
    recent_events: Number(summary?.returnRoute?.recentEvents ?? 0n),
    latest_event: summary?.returnRoute?.latestEvent
      ? {
        id: Number(summary.returnRoute.latestEvent.id),
        task_name: summary.returnRoute.latestEvent.taskName,
        node_name: summary.returnRoute.latestEvent.nodeName,
        expected_line: summary.returnRoute.latestEvent.expectedLine,
        from_line: summary.returnRoute.latestEvent.fromLine,
        to_line: summary.returnRoute.latestEvent.toLine,
        kind: summary.returnRoute.latestEvent.kind,
        occurred_at: isoOrUndefined(summary.returnRoute.latestEvent.occurredAt) ?? "",
      }
      : undefined,
    error: textOrUndefined(summary?.returnRoute?.error ?? ""),
  },
  alerts: summary?.alerts
    ? {
      resource: alertSummary(summary.alerts.resource),
      offline: alertSummary(summary.alerts.offline),
      latency_loss: alertSummary(summary.alerts.latencyLoss),
      traffic: alertSummary(summary.alerts.traffic),
      return_route: alertSummary(summary.alerts.returnRoute),
      billing: alertSummary(summary.alerts.billing),
    }
    : emptyAlerts(),
  generated_at: isoOrUndefined(summary?.generatedAt) ?? new Date().toISOString(),
});

const latencySummary = (latency?: ProtoCharts["latency"]): DashboardLatencySummary => ({
  average: latency?.averageMs ?? 0,
  targets: latency?.targets ?? 0,
  points: (latency?.points ?? []).map((point) => ({
    time: isoOrUndefined(point.time) ?? "",
    average: point.averageMs,
  })),
  ranking: (latency?.ranking ?? []).map((item) => ({
    uuid: item.uuid,
    name: item.name,
    average: item.averageMs,
    detail_url: textOrUndefined(item.detailUrl),
  })),
  jitter_ranking: (latency?.jitterRanking ?? []).map((item) => ({
    uuid: item.uuid,
    name: item.name,
    previous: item.previousMs,
    current: item.currentMs,
    delta: item.deltaMs,
    detail_url: textOrUndefined(item.detailUrl),
  })),
  jitter_error: textOrUndefined(latency?.jitterError ?? ""),
  error: textOrUndefined(latency?.error ?? ""),
});

const chartsData = (charts?: ProtoCharts): DashboardChartsData => ({
  traffic: {
    today_up: charts?.traffic ? byteCount(charts.traffic.todayUploadBytes) : 0,
    today_down: charts?.traffic ? byteCount(charts.traffic.todayDownloadBytes) : 0,
    today_billable: charts?.traffic ? byteCount(charts.traffic.todayBillableBytes) : 0,
    // The intraday series is keyed by its server-rendered label, matching the
    // billing reporting zone; timestamp stays unused on this path.
    hourly: (charts?.traffic?.hourly ?? []).map((bucket) => ({
      hour: bucket.label,
      timestamp: 0,
      up: byteCount(bucket.uploadBytes),
      down: byteCount(bucket.downloadBytes),
    })),
    daily: (charts?.traffic?.daily ?? []).map((day) => ({
      day: day.day,
      up: byteCount(day.uploadBytes),
      down: byteCount(day.downloadBytes),
      billable: byteCount(day.billableBytes),
    })),
    ranking: (charts?.traffic?.ranking ?? []).map((item) => ({
      uuid: item.uuid,
      name: item.name,
      up: byteCount(item.uploadBytes),
      down: byteCount(item.downloadBytes),
      billable: byteCount(item.billableBytes),
      detail_url: textOrUndefined(item.detailUrl),
    })),
    history_ready: charts?.traffic?.historyReady ?? false,
    error: textOrUndefined(charts?.traffic?.error ?? ""),
  },
  latency: latencySummary(charts?.latency),
  packet_loss: {
    window_minutes: charts?.packetLoss?.windowMinutes ?? 0,
    ranking: (charts?.packetLoss?.ranking ?? []).map((item) => ({
      uuid: item.uuid,
      name: item.name,
      task_id: item.taskId,
      task_name: item.taskName,
      loss_rate: item.lossRate,
      lost: item.lost,
      total: item.total,
      valid: item.valid,
      detail_url: textOrUndefined(item.detailUrl),
    })),
    error: textOrUndefined(charts?.packetLoss?.error ?? ""),
  },
  generated_at: isoOrUndefined(charts?.generatedAt) ?? new Date().toISOString(),
});

// The dashboard aggregates scan the metric store and the traffic ledger, so
// they are budgeted against the server's own 30s policy rather than the shorter
// default unary deadline. The REST bridge these replaced had no client timeout
// at all, and a 15s cap would fail the heavy series on large deployments.
const DASHBOARD_AGGREGATE_TIMEOUT_MS = 30_000;

export async function requestDashboardSummary(
  sections: string[],
  rankingLimit: number,
  signal: AbortSignal,
): Promise<DashboardData> {
  const response = await connectUnary({ signal, timeoutMs: DASHBOARD_AGGREGATE_TIMEOUT_MS }, (requestSignal, timeoutMs) =>
    connectClients.dashboard.getDashboardSummary(
      { sections: selectedSections(sections), rankingLimit },
      { signal: requestSignal, timeoutMs },
    ),
  );
  return summaryData(response.summary);
}

export async function requestDashboardChartSeries(
  charts: string[],
  rankingLimit: number,
  signal: AbortSignal,
): Promise<DashboardChartsData> {
  const response = await connectUnary({ signal, timeoutMs: DASHBOARD_AGGREGATE_TIMEOUT_MS }, (requestSignal, timeoutMs) =>
    connectClients.dashboard.getDashboardCharts(
      { charts: selectedCharts(charts), rankingLimit },
      { signal: requestSignal, timeoutMs },
    ),
  );
  return chartsData(response.charts);
}

const ALERT_ITEMS_CACHE_TTL_MS = 30_000;
const alertItemsCache = new Map<string, {
  expiresAt: number;
  response: DashboardAlertItemsResponse;
}>();
const pendingAlertItems = new Map<string, Promise<DashboardAlertItemsResponse>>();

const alertItemsCacheKey = (kind: DashboardAlertKind, accountKey: string) => `${accountKey}:${kind}`;

export function getDashboardAlertItemsSnapshot(
  kind: DashboardAlertKind,
  accountKey = "authenticated",
): DashboardAlertItemsResponse | null {
  const key = alertItemsCacheKey(kind, accountKey);
  const cached = alertItemsCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    alertItemsCache.delete(key);
    return null;
  }
  return cached.response;
}

export async function requestDashboardAlertItems(
  kind: DashboardAlertKind,
  signal?: AbortSignal,
  accountKey = "authenticated",
): Promise<DashboardAlertItemsResponse> {
  const cached = getDashboardAlertItemsSnapshot(kind, accountKey);
  if (cached) return cached;
  const data = await requestDashboardAlertItemList(
    kind,
    signal ?? new AbortController().signal,
  );
  const normalized = { ...data, items: Array.isArray(data.items) ? data.items : [] };
  alertItemsCache.set(alertItemsCacheKey(kind, accountKey), {
    expiresAt: Date.now() + ALERT_ITEMS_CACHE_TTL_MS,
    response: normalized,
  });
  return normalized;
}

export function prefetchDashboardAlertItems(
  kind: DashboardAlertKind,
  accountKey = "authenticated",
): Promise<DashboardAlertItemsResponse> {
  const cached = getDashboardAlertItemsSnapshot(kind, accountKey);
  if (cached) return Promise.resolve(cached);
  const key = alertItemsCacheKey(kind, accountKey);
  const pending = pendingAlertItems.get(key);
  if (pending) return pending;
  const request = requestDashboardAlertItems(kind, undefined, accountKey)
    .finally(() => {
      if (pendingAlertItems.get(key) === request) pendingAlertItems.delete(key);
    });
  pendingAlertItems.set(key, request);
  return request;
}

export async function requestDashboardAlertItemList(
  kind: DashboardAlertKind,
  signal: AbortSignal,
): Promise<DashboardAlertItemsResponse> {
  const response = await connectUnary({ signal }, (requestSignal, timeoutMs) =>
    connectClients.dashboard.listDashboardAlertItems(
      { kind: alertKindToProto[kind] },
      { signal: requestSignal, timeoutMs },
    ),
  );
  const items = response.items.flatMap((item) => {
    const itemKind = alertKindFromProto(item.kind) ?? kind;
    const latest = alertLatest(item);
    return latest ? [{ ...latest, kind: itemKind }] : [];
  });
  return {
    kind: alertKindFromProto(response.kind) ?? kind,
    items,
    generated_at: isoOrUndefined(response.generatedAt) ?? new Date().toISOString(),
  };
}
