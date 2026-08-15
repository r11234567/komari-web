import { durationFromMs } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import type { Execution, ExecutionEvent } from "@komari/proto/komari/exec/v1/exec_pb";
import type { FileCommand, SessionClosed, SessionEvent } from "@komari/proto/komari/webssh/v1/webssh_pb";
import { connectClients, connectUnary } from "./client";
import { DEFAULT_STREAM_DEADLINE_MS } from "./deadline";

const reconnectableStreamError = (error: unknown) =>
  error instanceof ConnectError &&
  [Code.Canceled, Code.DeadlineExceeded, Code.Unavailable].includes(error.code);

const waitToReconnect = (signal: AbortSignal) => new Promise<void>((resolve) => {
  const timer = window.setTimeout(resolve, 500);
  signal.addEventListener("abort", () => {
    window.clearTimeout(timer);
    resolve();
  }, { once: true });
});

export async function createRemoteExecutions(input: {
  agentIds: string[];
  command: string;
  twoFactorCode: string;
  timeoutMs?: number;
  maxOutputBytes?: bigint;
  idempotencyKey: string;
  signal: AbortSignal;
}): Promise<Execution[]> {
  const response = await connectUnary(
    { signal: input.signal, timeoutMs: 30_000 },
    (signal, timeoutMs) => connectClients.execution.createExecution({
      agentIds: input.agentIds,
      command: input.command,
      timeout: durationFromMs(input.timeoutMs ?? 5 * 60_000),
      maxOutputBytes: input.maxOutputBytes ?? BigInt(1 << 20),
      idempotencyKey: input.idempotencyKey,
      twoFactor: { code: input.twoFactorCode, challengeId: "" },
    }, { signal, timeoutMs }),
  );
  if (response.executions.length > 0) return response.executions;
  return response.execution ? [response.execution] : [];
}

export async function listRemoteAgentCapabilities(signal: AbortSignal) {
  const response = await connectUnary(
    { signal, timeoutMs: 15_000 },
    (requestSignal, timeoutMs) => connectClients.browser.listAgents(
      {},
      { signal: requestSignal, timeoutMs },
    ),
  );
  return response.agents;
}

export async function* watchRemoteExecution(input: {
  executionId: string;
  afterSequence?: bigint;
  signal: AbortSignal;
  timeoutMs?: number;
}): AsyncIterable<{ event?: ExecutionEvent }> {
  let afterSequence = input.afterSequence ?? 0n;
  const timeoutMs = input.timeoutMs ?? DEFAULT_STREAM_DEADLINE_MS;
  while (!input.signal.aborted) {
    const deadline = AbortSignal.timeout(timeoutMs);
    const signal = AbortSignal.any([input.signal, deadline]);
    try {
      for await (const response of connectClients.execution.watchExecution({
        executionId: input.executionId,
        afterSequence,
      }, { signal, timeoutMs })) {
        if (response.event) afterSequence = response.event.sequence;
        yield response;
      }
      return;
    } catch (error) {
      if (input.signal.aborted) return;
      if (!deadline.aborted && !reconnectableStreamError(error)) throw error;
      await waitToReconnect(input.signal);
    }
  }
}

export const cancelRemoteExecution = (input: {
  executionId: string;
  reason: string;
  twoFactorCode: string;
  signal: AbortSignal;
}) => connectUnary(
  { signal: input.signal, timeoutMs: 10_000 },
  (signal, timeoutMs) => connectClients.execution.cancelExecution({
    executionId: input.executionId,
    reason: input.reason,
    twoFactor: { code: input.twoFactorCode, challengeId: "" },
  }, { signal, timeoutMs }),
);

export async function createRemoteSession(input: {
  agentId: string;
  rows: number;
  columns: number;
  twoFactorCode: string;
  signal: AbortSignal;
}) {
  const response = await connectUnary(
    { signal: input.signal, timeoutMs: 15_000 },
    (signal, timeoutMs) => connectClients.webssh.createSession({
      start: {
        agentId: input.agentId,
        shell: "",
        size: { rows: input.rows, columns: input.columns },
        workingDirectory: "",
        twoFactor: { code: input.twoFactorCode, challengeId: "" },
      },
    }, { signal, timeoutMs }),
  );
  if (!response.started) throw new Error("Connect terminal did not return a session");
  return response.started;
}

export const sendRemoteSessionInput = (input: {
  sessionId: string;
  sequence: bigint;
  data: Uint8Array;
  signal: AbortSignal;
}) => connectUnary(
  { signal: input.signal, timeoutMs: 10_000 },
  (signal, timeoutMs) => connectClients.webssh.sendSessionCommand({
    sessionId: input.sessionId,
    sequence: input.sequence,
    command: { case: "input", value: input.data },
  }, { signal, timeoutMs }),
);

export const sendRemoteSessionResize = (input: {
  sessionId: string;
  sequence: bigint;
  rows: number;
  columns: number;
  signal: AbortSignal;
}) => connectUnary(
  { signal: input.signal, timeoutMs: 10_000 },
  (signal, timeoutMs) => connectClients.webssh.sendSessionCommand({
    sessionId: input.sessionId,
    sequence: input.sequence,
    command: { case: "resize", value: { rows: input.rows, columns: input.columns } },
  }, { signal, timeoutMs }),
);

export const sendRemoteFileCommand = (input: {
  sessionId: string;
  sequence: bigint;
  command: FileCommand;
  signal: AbortSignal;
}) => connectUnary(
  { signal: input.signal, timeoutMs: 30_000 },
  (signal, timeoutMs) => connectClients.webssh.sendSessionCommand({
    sessionId: input.sessionId,
    sequence: input.sequence,
    command: { case: "file", value: input.command },
  }, { signal, timeoutMs }),
);

export const acknowledgeRemoteSessionEvents = (input: {
  sessionId: string;
  acceptedSequence: bigint;
  signal: AbortSignal;
}) => connectUnary(
  { signal: input.signal, timeoutMs: 10_000 },
  (signal, timeoutMs) => connectClients.webssh.acknowledgeSessionEvents({
    sessionId: input.sessionId,
    acceptedSequence: input.acceptedSequence,
  }, { signal, timeoutMs }),
);

export async function* watchRemoteSession(input: {
  sessionId: string;
  afterSequence?: bigint;
  signal: AbortSignal;
}): AsyncIterable<{ event?: SessionEvent }> {
  let afterSequence = input.afterSequence ?? 0n;
  while (!input.signal.aborted) {
    const deadline = AbortSignal.timeout(DEFAULT_STREAM_DEADLINE_MS);
    const signal = AbortSignal.any([input.signal, deadline]);
    try {
      for await (const response of connectClients.webssh.watchSession({
        sessionId: input.sessionId,
        afterSequence,
      }, { signal, timeoutMs: DEFAULT_STREAM_DEADLINE_MS })) {
        if (response.event) {
          afterSequence = response.event.sequence;
          yield response;
          await acknowledgeRemoteSessionEvents({
            sessionId: input.sessionId,
            acceptedSequence: afterSequence,
            signal: AbortSignal.any([input.signal, AbortSignal.timeout(10_000)]),
          });
          if (response.event.event.case === "closed") return;
        }
      }
      return;
    } catch (error) {
      if (input.signal.aborted) return;
      if (!deadline.aborted && !reconnectableStreamError(error)) throw error;
      await waitToReconnect(input.signal);
    }
  }
}

export async function closeRemoteSession(input: {
  sessionId: string;
  reason: string;
  signal: AbortSignal;
}): Promise<SessionClosed | undefined> {
  const response = await connectUnary(
    { signal: input.signal, timeoutMs: 10_000 },
    (signal, timeoutMs) => connectClients.webssh.closeSession({
      sessionId: input.sessionId,
      reason: input.reason,
    }, { signal, timeoutMs }),
  );
  return response.closed;
}
