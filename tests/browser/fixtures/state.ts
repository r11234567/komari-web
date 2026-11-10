import type { TerminalSessionApi } from "../../../src/pages/terminal/TerminalSession";
export const state = {
  creates: [] as unknown[],
  inputs: [] as number[][],
  closes: [] as unknown[],
  verifications: [] as { purpose: number; resource: string }[],
  proofs: [] as { challengeId: string; proof: { code: string } }[],
  unlocks: [] as { agentId: string; systemUser: string }[],
  api: null as TerminalSessionApi | null,
  ready: false,
};
Object.assign(window, { terminalAudit: state });
