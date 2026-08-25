import { connectClients, connectUnary } from "@/api/connect/client";

// The console has always modelled a probe task with `interval` in seconds and
// snake_case flags. The adapter keeps that shape so the task pages render
// unchanged while the transport moves to Connect.
export interface PingTaskInput {
  id?: number;
  name?: string;
  target?: string;
  type?: string;
  interval?: number;
  clients?: string[];
  default_on?: boolean;
  weight?: number;
}

export interface PingTaskRecord extends PingTaskInput {
  id: number;
  name: string;
  target: string;
  type: string;
  interval: number;
  clients: string[];
  default_on: boolean;
  weight: number;
}

const anySignal = (signal?: AbortSignal) => signal ?? new AbortController().signal;

const toProto = (task: PingTaskInput) => ({
  id: task.id ?? 0,
  name: task.name ?? "",
  target: task.target ?? "",
  type: task.type ?? "",
  intervalSeconds: task.interval ?? 0,
  clients: task.clients ?? [],
  defaultOn: task.default_on ?? false,
  weight: task.weight ?? 0,
});

export async function listPingTasks(signal?: AbortSignal): Promise<PingTaskRecord[]> {
  const response = await connectUnary({ signal: anySignal(signal) }, (requestSignal, timeoutMs) =>
    connectClients.pingTask.listPingTasks({}, { signal: requestSignal, timeoutMs }),
  );
  return response.tasks.map((task) => ({
    id: task.id,
    name: task.name,
    target: task.target,
    type: task.type,
    interval: task.intervalSeconds,
    clients: task.clients,
    default_on: task.defaultOn,
    weight: task.weight,
  }));
}

export async function createPingTask(input: {
  name: string;
  target: string;
  type: string;
  interval: number;
  clients: string[];
  default_on: boolean;
  signal?: AbortSignal;
}): Promise<number> {
  const response = await connectUnary({ signal: anySignal(input.signal) }, (requestSignal, timeoutMs) =>
    connectClients.pingTask.createPingTask(
      {
        name: input.name,
        target: input.target,
        type: input.type,
        intervalSeconds: input.interval,
        clients: input.clients,
        defaultOn: input.default_on,
      },
      { signal: requestSignal, timeoutMs },
    ),
  );
  return response.taskId;
}

export const updatePingTasks = (tasks: PingTaskInput[], signal?: AbortSignal) => connectUnary(
  { signal: anySignal(signal) },
  (requestSignal, timeoutMs) => connectClients.pingTask.updatePingTasks(
    { tasks: tasks.map(toProto) },
    { signal: requestSignal, timeoutMs },
  ),
);

export const deletePingTasks = (ids: number[], signal?: AbortSignal) => connectUnary(
  { signal: anySignal(signal) },
  (requestSignal, timeoutMs) => connectClients.pingTask.deletePingTasks(
    { ids },
    { signal: requestSignal, timeoutMs },
  ),
);

export const reorderPingTasks = (
  weights: Record<string | number, number>,
  signal?: AbortSignal,
) => connectUnary(
  { signal: anySignal(signal) },
  (requestSignal, timeoutMs) => connectClients.pingTask.reorderPingTasks(
    {
      weights: Object.fromEntries(
        Object.entries(weights).map(([id, weight]) => [Number(id), weight]),
      ),
    },
    { signal: requestSignal, timeoutMs },
  ),
);
