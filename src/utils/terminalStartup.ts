export type TerminalStartupPhase = "authorizing" | "creating" | "waiting-agent" | "waiting-output" | "ready" | "closed";

export function observeTerminalStartup(current: TerminalStartupPhase, observation: {
  agentAttached?: boolean;
  outputBytes?: number;
  closed?: boolean;
}): TerminalStartupPhase {
  if (observation.closed || current === "closed") return "closed";
  if ((observation.outputBytes ?? 0) > 0 || current === "ready") return "ready";
  return observation.agentAttached ? "waiting-output" : "waiting-agent";
}
