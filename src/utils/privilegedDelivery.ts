import type { GetNodeConfigStateResponse, PrivilegedRevision } from "@komari/proto/komari/config/v1/config_pb";

// History pages must never determine the active snapshot or approval target.
export function appliedSnapshot(state: GetNodeConfigStateResponse) {
  return state.appliedRevision > 0n && state.applied?.revision === state.appliedRevision
    ? state.applied : undefined;
}

export function confirmationStillCurrent(expected: PrivilegedRevision, current: PrivilegedRevision | undefined, needsConfirmation: number) {
  return current?.state === needsConfirmation && current.revision === expected.revision &&
    current.configHash === expected.configHash && current.approvalGeneration === expected.approvalGeneration;
}

export function acceptState(current: GetNodeConfigStateResponse | undefined, next: GetNodeConfigStateResponse) {
  return !current || next.updateSequence >= current.updateSequence;
}

export function boundedRemoteSettings<T extends { remoteControlEnabled: boolean; websshEnabled: boolean; executionEnabled: boolean }>(settings: T): T {
  return { ...settings, websshEnabled: settings.remoteControlEnabled && settings.websshEnabled,
    executionEnabled: settings.remoteControlEnabled && settings.executionEnabled };
}
