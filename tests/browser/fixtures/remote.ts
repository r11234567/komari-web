import { state } from "./state";

// All credentials, identifiers and output here are synthetic test fixtures.
export async function createRemoteSession(input: { twoFactorCode: string }) {
  state.creates.push({ ...input, signal: undefined });
  if (new URLSearchParams(location.search).get("twofa") === "1" && input.twoFactorCode !== "123456") {
    throw new Error("Synthetic transport: fresh test 2FA required");
  }
  return { sessionId: "synthetic-session" };
}
export async function* watchRemoteSession(input: { signal: AbortSignal }) {
  yield { event: { event: { case: "output", value: new Uint8Array() } } };
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
