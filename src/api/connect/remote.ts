import { workspaceAccess, rememberWorkspaceSession, workspaceSessionAccess, workspaceSessionValid, forgetWorkspaceSession } from "./workspace";
import { durationFromMs } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import type { Execution, ExecutionEvent } from "@komari/proto/komari/exec/v1/exec_pb";
import type { FileCommand, SessionClosed, SessionEvent } from "@komari/proto/komari/webssh/v1/webssh_pb";
import { connectClients, connectUnary } from "./client";
import { createTerminalEventAcknowledger } from "../../utils/terminalTransport";
import { DEFAULT_STREAM_DEADLINE_MS } from "./deadline";

export const reconnectableStreamError = (error: unknown) =>
  (error instanceof TypeError && /fetch|network|load/i.test(error.message)) ||
  (error instanceof ConnectError && (
    [Code.Canceled, Code.DeadlineExceeded, Code.Unavailable].includes(error.code) ||
    (error.code === Code.Unknown && /^(network error|failed to fetch|networkerror|load failed)/i.test(error.rawMessage))
  ));

const waitToReconnect = (signal: AbortSignal) => new Promise<void>((resolve) => {
  const finish = () => {
    clearTimeout(timer);
    signal.removeEventListener("abort", finish);
    resolve();
  };
  const timer = setTimeout(finish, 500);
  signal.addEventListener("abort", finish, { once: true });
  if (signal.aborted) finish();
});

export async function createRemoteExecutions(input: {
  agentIds: string[];
  command: string;
  runAsRoot?: boolean;
  authorizationToken: string;
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
      runAsRoot: input.runAsRoot ?? false,
      timeout: durationFromMs(input.timeoutMs ?? 5 * 60_000),
      maxOutputBytes: input.maxOutputBytes ?? BigInt(1 << 20),
      idempotencyKey: input.idempotencyKey,
      twoFactor: { authorizationToken: input.authorizationToken },
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
  authorizationToken: string;
  signal: AbortSignal;
}) => connectUnary(
  { signal: input.signal, timeoutMs: 10_000 },
  (signal, timeoutMs) => connectClients.execution.cancelExecution({
    executionId: input.executionId,
    reason: input.reason,
    twoFactor: { authorizationToken: input.authorizationToken },
  }, { signal, timeoutMs }),
);

export async function createRemoteSession(input: {
  agentId: string;
  rows: number;
  columns: number;
  signal: AbortSignal;
}) {
  const access = await workspaceAccess(input.agentId, input.signal);
  const response = await connectUnary(
    { signal: access.signal, timeoutMs: 15_000 },
    (signal, timeoutMs) => connectClients.webssh.createSession({
      start: {
        agentId: input.agentId,
        shell: "",
        size: { rows: input.rows, columns: input.columns },
        workingDirectory: "",
      },
    }, { signal, timeoutMs, headers: access.headers }),
  );
  if (!response.started) throw new Error("Connect terminal did not return a session");
  rememberWorkspaceSession(response.started.sessionId, input.agentId, access.headers["X-Komari-Workspace-Grant"]);
  return response.started;
}

// Commands have a stable server-side sequence. Retrying that exact command is
// safe even when the response was lost; never generate a new sequence or shell.
async function retrySessionCommand<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
  const until = Date.now() + 30_000;
  for (;;) {
    signal.throwIfAborted();
    try {
      return await operation();
    } catch (error) {
      if (signal.aborted || !reconnectableStreamError(error) || Date.now() >= until) throw error;
      await waitToReconnect(signal);
    }
  }
}

export const sendRemoteSessionInput = (input: {
  sessionId: string;
  sequence: bigint;
  data: Uint8Array;
  signal: AbortSignal;
}) => retrySessionCommand(input.signal,()=>connectUnary(
  { signal: input.signal, timeoutMs: 10_000 },
  (signal, timeoutMs) => connectClients.webssh.sendSessionCommand({
    sessionId: input.sessionId,
    sequence: input.sequence,
    command: { case: "input", value: input.data },
  }, { ...workspaceSessionAccess(input.sessionId, signal), timeoutMs }),
));

export const sendRemoteSessionResize = (input: {
  sessionId: string;
  sequence: bigint;
  rows: number;
  columns: number;
  signal: AbortSignal;
}) => retrySessionCommand(input.signal,()=>connectUnary(
  { signal: input.signal, timeoutMs: 10_000 },
  (signal, timeoutMs) => connectClients.webssh.sendSessionCommand({
    sessionId: input.sessionId,
    sequence: input.sequence,
    command: { case: "resize", value: { rows: input.rows, columns: input.columns } },
  }, { ...workspaceSessionAccess(input.sessionId, signal), timeoutMs }),
));

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
  }, { ...workspaceSessionAccess(input.sessionId, signal), timeoutMs }),
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
  }, { ...workspaceSessionAccess(input.sessionId, signal), timeoutMs }),
);

export async function* watchRemoteSession(input: {
  sessionId: string;
  afterSequence?: bigint;
  signal: AbortSignal;
}): AsyncIterable<{ event?: SessionEvent; agentAttached?: boolean; reconnecting?: boolean }> {
  let afterSequence = input.afterSequence ?? 0n;
  while (!input.signal.aborted) {
    const deadline = AbortSignal.timeout(DEFAULT_STREAM_DEADLINE_MS);
    const connection = new AbortController();
    const signal = AbortSignal.any([input.signal, deadline, connection.signal]);
    let acknowledgementError: unknown;
    const acknowledger = createTerminalEventAcknowledger({
      signal,
      acknowledge: (acceptedSequence) => acknowledgeRemoteSessionEvents({
        sessionId: input.sessionId, acceptedSequence, signal,
      }),
      onError: (error) => {
        acknowledgementError = error;
        connection.abort();
      },
    });
    try {
      for await (const response of connectClients.webssh.watchSession({
        sessionId: input.sessionId,
        afterSequence,
      }, { ...workspaceSessionAccess(input.sessionId, signal), timeoutMs: DEFAULT_STREAM_DEADLINE_MS })) {
        // Empty startup/heartbeat observations do not advance the replay cursor.
        if (!response.event) { yield response; continue; }
        if (response.event) {
          yield response;
          // Advance only after the consumer accepted this event. WatchSession
          // cumulatively ACKs this same cursor when resuming after a disconnect.
          afterSequence = response.event.sequence;
          acknowledger.accept(afterSequence);
          if (response.event.event.case === "closed") { forgetWorkspaceSession(input.sessionId); return; }
        }
      }
      return;
    } catch (error) {
      if (input.signal.aborted) return;
      if (!workspaceSessionValid(input.sessionId)) return;
      const cause = acknowledgementError ?? error;
      if (!deadline.aborted && !reconnectableStreamError(cause)) throw cause;
      yield { reconnecting: true };
      await waitToReconnect(input.signal);
    } finally {
      acknowledger.dispose();
      connection.abort();
    }
  }
}

export async function closeRemoteSession(input: {
  sessionId: string;
  reason: string;
  signal: AbortSignal;
}): Promise<SessionClosed | undefined> {
  if (!workspaceSessionValid(input.sessionId)) { forgetWorkspaceSession(input.sessionId); return; }
  const response = await connectUnary(
    { signal: input.signal, timeoutMs: 10_000 },
    (signal, timeoutMs) => connectClients.webssh.closeSession({
      sessionId: input.sessionId,
      reason: input.reason,
    }, { ...workspaceSessionAccess(input.sessionId, signal), timeoutMs }),
  );
  forgetWorkspaceSession(input.sessionId);
  return response.closed;
}
