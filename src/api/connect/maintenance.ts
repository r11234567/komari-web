import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { Timestamp } from "@bufbuild/protobuf/wkt";
import { connectClients, connectUnary } from "@/api/connect/client";

const isoString = (value?: Timestamp) => (value ? timestampDate(value).toISOString() : "");

const anySignal = (signal?: AbortSignal) => signal ?? new AbortController().signal;

export interface AdminSessionEntry {
  uuid: string;
  session: string;
  user_agent: string;
  ip: string;
  login_method: string;
  latest_online: string;
  latest_ip: string;
  latest_user_agent: string;
  expires: string;
  created_at: string;
}

export interface AdminSessionList {
  current: string;
  data: AdminSessionEntry[];
}

export async function listAdminSessions(signal?: AbortSignal): Promise<AdminSessionList> {
  const response = await connectUnary({ signal: anySignal(signal) }, (requestSignal, timeoutMs) =>
    connectClients.maintenance.listSessions({}, { signal: requestSignal, timeoutMs }),
  );
  return {
    current: response.currentSession,
    data: response.sessions.map((session) => ({
      uuid: session.uuid,
      session: session.session,
      user_agent: session.userAgent,
      ip: session.ip,
      login_method: session.loginMethod,
      latest_online: isoString(session.latestOnline),
      latest_ip: session.latestIp,
      latest_user_agent: session.latestUserAgent,
      expires: isoString(session.expires),
      created_at: isoString(session.createdAt),
    })),
  };
}

export const deleteAdminSession = (session: string, signal?: AbortSignal) => connectUnary(
  { signal: anySignal(signal) },
  (requestSignal, timeoutMs) => connectClients.maintenance.deleteSession(
    { session },
    { signal: requestSignal, timeoutMs },
  ),
);

export const deleteAllAdminSessions = (signal?: AbortSignal) => connectUnary(
  { signal: anySignal(signal) },
  (requestSignal, timeoutMs) => connectClients.maintenance.deleteAllSessions(
    {},
    { signal: requestSignal, timeoutMs },
  ),
);

export interface AuditLogEntry {
  id: number;
  ip: string;
  uuid: string;
  message: string;
  msg_type: string;
  time: string;
}

export interface AuditLogPage {
  logs: AuditLogEntry[];
  total: number;
}

export async function listAuditLogs(
  limit: number,
  page: number,
  messageType = "",
  signal?: AbortSignal,
): Promise<AuditLogPage> {
  const response = await connectUnary({ signal: anySignal(signal) }, (requestSignal, timeoutMs) =>
    connectClients.maintenance.listAuditLogs(
      { limit, page, messageType },
      { signal: requestSignal, timeoutMs },
    ),
  );
  return {
    logs: response.logs.map((entry) => ({
      id: Number(entry.id),
      ip: entry.ip,
      uuid: entry.uuid,
      message: entry.message,
      msg_type: entry.messageType,
      time: isoString(entry.time),
    })),
    total: Number(response.total),
  };
}

export interface ClipboardEntry {
  id: number;
  text: string;
  name: string;
  remark: string;
  weight: number;
  createdAt: string;
  updatedAt: string;
}

const clipboardEntry = (entry: {
  id: number;
  text: string;
  name: string;
  remark: string;
  weight: number;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}): ClipboardEntry => ({
  id: entry.id,
  text: entry.text,
  name: entry.name,
  remark: entry.remark,
  weight: entry.weight,
  createdAt: isoString(entry.createdAt),
  updatedAt: isoString(entry.updatedAt),
});

export async function listClipboardEntries(signal?: AbortSignal): Promise<ClipboardEntry[]> {
  const response = await connectUnary({ signal: anySignal(signal) }, (requestSignal, timeoutMs) =>
    connectClients.maintenance.listClipboardEntries({}, { signal: requestSignal, timeoutMs }),
  );
  return response.entries.map(clipboardEntry);
}

export async function createClipboardEntry(input: {
  name: string;
  text: string;
  remark: string;
  weight: number;
  signal?: AbortSignal;
}): Promise<ClipboardEntry | null> {
  const response = await connectUnary({ signal: anySignal(input.signal) }, (requestSignal, timeoutMs) =>
    connectClients.maintenance.createClipboardEntry(
      { name: input.name, text: input.text, remark: input.remark, weight: input.weight },
      { signal: requestSignal, timeoutMs },
    ),
  );
  return response.entry ? clipboardEntry(response.entry) : null;
}

export const updateClipboardEntry = (input: {
  id: number;
  name?: string;
  text?: string;
  remark?: string;
  weight?: number;
  signal?: AbortSignal;
}) => connectUnary(
  { signal: anySignal(input.signal) },
  (requestSignal, timeoutMs) => connectClients.maintenance.updateClipboardEntry(
    {
      id: input.id,
      name: input.name,
      text: input.text,
      remark: input.remark,
      weight: input.weight,
    },
    { signal: requestSignal, timeoutMs },
  ),
);

export const deleteClipboardEntries = (ids: number[], signal?: AbortSignal) => connectUnary(
  { signal: anySignal(signal) },
  (requestSignal, timeoutMs) => connectClients.maintenance.deleteClipboardEntries(
    { ids },
    { signal: requestSignal, timeoutMs },
  ),
);

export interface DatabaseStoreStatus {
  driver: string;
  location: string;
  size: number | null;
  action: string;
  files?: { database: number; wal: number; shm: number };
  error?: string;
}

export interface DatabaseStatus {
  type: string;
  size: number;
  main: DatabaseStoreStatus;
  monitoring: DatabaseStoreStatus;
  local_total: number | null;
}

const byteCount = (value: bigint) => {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) ? numeric : Number.MAX_SAFE_INTEGER;
};

const storeStatus = (store?: {
  driver: string;
  location: string;
  sizeBytes?: bigint;
  action: string;
  files?: { databaseBytes: bigint; walBytes: bigint; shmBytes: bigint };
  error: string;
}): DatabaseStoreStatus => ({
  driver: store?.driver ?? "",
  location: store?.location ?? "",
  size: store?.sizeBytes === undefined ? null : byteCount(store.sizeBytes),
  action: store?.action ?? "",
  files: store?.files
    ? {
      database: byteCount(store.files.databaseBytes),
      wal: byteCount(store.files.walBytes),
      shm: byteCount(store.files.shmBytes),
    }
    : undefined,
  error: store?.error || undefined,
});

export async function getDatabaseStatus(signal?: AbortSignal): Promise<DatabaseStatus> {
  const response = await connectUnary({ signal: anySignal(signal) }, (requestSignal, timeoutMs) =>
    connectClients.maintenance.getDatabaseStatus({}, { signal: requestSignal, timeoutMs }),
  );
  const status = response.status;
  return {
    type: status?.type ?? "",
    size: status ? byteCount(status.totalBytes) : 0,
    main: storeStatus(status?.main),
    monitoring: storeStatus(status?.monitoring),
    local_total: status?.localTotalBytes === undefined ? null : byteCount(status.localTotalBytes),
  };
}

export interface DatabaseMaintenanceOutcome {
  driver: string;
  action: string;
  before: number | null;
  after: number | null;
  success: boolean;
  error?: string;
  size_error?: string;
}

export interface DatabaseMaintenanceReport {
  before: number;
  after: number;
  size: number;
  all_succeeded: boolean;
  main: DatabaseMaintenanceOutcome;
  monitoring: DatabaseMaintenanceOutcome;
}

const maintenanceOutcome = (result?: {
  driver: string;
  action: string;
  beforeBytes?: bigint;
  afterBytes?: bigint;
  success: boolean;
  error: string;
  sizeError: string;
}): DatabaseMaintenanceOutcome => ({
  driver: result?.driver ?? "",
  action: result?.action ?? "",
  before: result?.beforeBytes === undefined ? null : byteCount(result.beforeBytes),
  after: result?.afterBytes === undefined ? null : byteCount(result.afterBytes),
  success: result?.success ?? false,
  error: result?.error || undefined,
  size_error: result?.sizeError || undefined,
});

export async function vacuumDatabase(signal?: AbortSignal): Promise<DatabaseMaintenanceReport> {
  const response = await connectUnary(
    { signal: anySignal(signal), timeoutMs: 30 * 60_000 },
    (requestSignal, timeoutMs) => connectClients.maintenance.vacuumDatabase(
      {},
      { signal: requestSignal, timeoutMs },
    ),
  );
  const result = response.result;
  return {
    before: result ? byteCount(result.beforeBytes) : 0,
    after: result ? byteCount(result.afterBytes) : 0,
    size: result ? byteCount(result.sizeBytes) : 0,
    all_succeeded: result?.allSucceeded ?? false,
    main: maintenanceOutcome(result?.main),
    monitoring: maintenanceOutcome(result?.monitoring),
  };
}
