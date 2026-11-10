import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { connectClients } from "../../../src/api/connect/client";
import { workspaceState, rememberWorkspaceSession } from "../../../src/api/connect/workspace";
import { sendRemoteSessionInput, watchRemoteSession } from "../../../src/api/connect/remote";
import {
  AcknowledgeSessionEventsResponseSchema, SendSessionCommandResponseSchema,
  WatchSessionResponseSchema,
} from "@komari/proto/komari/webssh/v1/webssh_pb";

// Exercise the production adapter and workspace guards. Only the generated
// client's wire boundary is synthetic; no real panel or Agent is contacted.
const agentId = "synthetic-adapter-agent", sessionId = "synthetic-adapter-session";
const grant = { agentId, systemUser: "alice", token: "synthetic-adapter-grant",
  expiresAt: Date.now() + 60_000, idleExpiresAt: Date.now() + 60_000, controller: new AbortController() };
workspaceState.install(grant);
rememberWorkspaceSession(sessionId, agentId, grant.token);
let commandError = Code.Unknown;
const state = { watches: [] as string[], commands: [] as { sequence: string; bytes: number[] }[], acks: [] as string[] };
connectClients.webssh.acknowledgeSessionEvents = async (request) => {
  state.acks.push(String(request.acceptedSequence));
  return create(AcknowledgeSessionEventsResponseSchema, { acceptedSequence: request.acceptedSequence });
};
connectClients.webssh.watchSession = async function* (request) {
  state.watches.push(String(request.afterSequence));
  if (state.watches.length === 1) {
    yield create(WatchSessionResponseSchema, { agentAttached: true, event: {
      sessionId, sequence: 1n, event: { case: "output", value: new TextEncoder().encode("before") },
    } });
    throw new ConnectError("network error", Code.Unknown);
  }
  yield create(WatchSessionResponseSchema, { agentAttached: true, event: {
    sessionId, sequence: 2n, event: { case: "output", value: new TextEncoder().encode("after") },
  } });
};
connectClients.webssh.sendSessionCommand = async (request) => {
  state.commands.push({ sequence: String(request.sequence), bytes: Array.from(request.command?.case === "input" ? request.command.value : []) });
  if (state.commands.length === 1 || commandError !== Code.Unknown) {
    throw new ConnectError(commandError === Code.Unknown ? "network error" : "permission denied", commandError);
  }
  return create(SendSessionCommandResponseSchema, { acceptedSequence: request.sequence });
};
Object.assign(window, { adapterAudit: {
  state,
  async watch() {
    const received: string[] = [];
    for await (const response of watchRemoteSession({ sessionId, signal: new AbortController().signal })) {
      received.push(response.reconnecting ? "reconnecting" : response.event ? String(response.event.sequence) : "observation");
    }
    return received;
  },
  send: () => sendRemoteSessionInput({ sessionId, sequence: 7n, data: new TextEncoder().encode("once\n"), signal: new AbortController().signal }),
  deny: () => { commandError = Code.PermissionDenied; },
  lock: () => workspaceState.invalidate(agentId),
} });
