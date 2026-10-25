import type { TerminalSessionApi } from "../../../src/pages/terminal/TerminalSession";
export const state = {
  creates: [] as unknown[],
  inputs: [] as number[][],
  closes: [] as unknown[],
  api: null as TerminalSessionApi | null,
  ready: false,
};
Object.assign(window, { terminalAudit: state });
