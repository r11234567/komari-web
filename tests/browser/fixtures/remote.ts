import { state } from "./state";
import { workspaceState } from "./workspace";

// All credentials, identifiers and output here are synthetic test fixtures.
export async function createRemoteSession(input: { agentId: string }) {
  const grant = workspaceState.grants.get(input.agentId);
  if (!grant || !workspaceState.valid(grant)) throw new Error("Synthetic transport: locked workspace");
  state.creates.push({ ...input, signal: undefined });
  return { sessionId: "synthetic-session" };
}
export async function* watchRemoteSession(input: { signal: AbortSignal }) {
  yield { agentAttached: true };
  yield { event: { event: { case: "output", value: new TextEncoder().encode("Clipboard sample\r\n") } } };
  await new Promise(resolve => setTimeout(resolve, 30));
  state.ready = true;
  await new Promise<void>((resolve) => {
    if (input.signal.aborted) resolve();
    else input.signal.addEventListener("abort", () => resolve(), { once: true });
  });
}
export async function sendRemoteSessionInput(input: { data: Uint8Array }) {
  state.inputs.push(Array.from(input.data));
}
export async function sendRemoteSessionResize() {}
export async function closeRemoteSession(input: unknown) { state.closes.push(input); }
