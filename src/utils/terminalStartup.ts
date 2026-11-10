export type TerminalStartupPhase = "authorizing" | "creating" | "waiting-agent" | "waiting-output" | "reconnecting" | "ready" | "closed";

export function observeTerminalStartup(current: TerminalStartupPhase, observation: {
  agentAttached?: boolean;
  outputBytes?: number;
  closed?: boolean;
}): TerminalStartupPhase {
  if (observation.closed || current === "closed") return "closed";
  if ((observation.outputBytes ?? 0) > 0) return "ready";
  if (observation.agentAttached === false && (current === "ready" || current === "reconnecting")) return "reconnecting";
  if (current === "ready" || (current === "reconnecting" && observation.agentAttached)) return "ready";
  return observation.agentAttached ? "waiting-output" : "waiting-agent";
}
