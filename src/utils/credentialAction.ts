// Match the backend's JSON encoding of public target identifiers. Go escapes
// U+2028/U+2029 even with HTML escaping disabled; preserve those bytes here.
function canonicalJson(value: unknown): string {
  return JSON.stringify(value).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

export async function credentialActionResource(action: string, targets: readonly string[]): Promise<string> {
  return `action:${action}:${await sha256Hex(canonicalJson(targets))}`;
}

export function restCredentialResource(method: string, path: string): string {
  return `rest:${method.toUpperCase()}:${path}`;
}

export const DEFAULT_EXECUTION_TIMEOUT_SECONDS = 5 * 60;
export const DEFAULT_EXECUTION_MAX_OUTPUT_BYTES = 1 << 20;

export interface ExecutionCredentialSpec {
  command: string;
  arguments?: readonly string[];
  environment?: Readonly<Record<string, string>>;
  workingDirectory?: string;
  timeoutSeconds?: number;
  maxOutputBytes?: number;
  runAsRoot?: boolean;
}

// Positional canonical tuple matching Go's credentialaction.ExecutionSpecDigest
// byte-for-byte so an approved execution grant cannot be replayed with a
// different command, arguments, environment, cwd, timeout, limit or privilege.
export async function executionSpecDigest(spec: ExecutionCredentialSpec): Promise<string> {
  const envPairs = Object.entries(spec.environment ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const payload = [
    "v1",
    spec.command,
    spec.arguments ? [...spec.arguments] : [],
    envPairs,
    spec.workingDirectory ?? "",
    Math.trunc(spec.timeoutSeconds ?? 0),
    Math.trunc(spec.maxOutputBytes ?? 0),
    Boolean(spec.runAsRoot),
  ];
  return `spec:${await sha256Hex(canonicalJson(payload))}`;
}

export async function executionCredentialTargets(
  agentIds: readonly string[],
  spec: ExecutionCredentialSpec,
): Promise<string[]> {
  const targets = [...agentIds];
  if (spec.runAsRoot) targets.push("run-as:root");
  targets.push(await executionSpecDigest(spec));
  return targets;
}

// Normalize execution parameters using the exact same defaults sent by
// createRemoteExecutions so the step-up proof and RPC payload never drift.
export function resolveExecutionDefaults(spec: {
  command: string;
  arguments?: readonly string[];
  environment?: Readonly<Record<string, string>>;
  workingDirectory?: string;
  timeoutMs?: number;
  maxOutputBytes?: bigint;
  runAsRoot?: boolean;
}) {
  const timeoutMs = spec.timeoutMs ?? DEFAULT_EXECUTION_TIMEOUT_SECONDS * 1000;
  const maxOutputBytes = spec.maxOutputBytes ?? BigInt(DEFAULT_EXECUTION_MAX_OUTPUT_BYTES);
  return {
    timeoutMs,
    timeoutSeconds: Math.trunc(timeoutMs / 1000),
    maxOutputBytes,
    credentialSpec: {
      command: spec.command,
      arguments: spec.arguments,
      environment: spec.environment,
      workingDirectory: spec.workingDirectory,
      timeoutSeconds: Math.trunc(timeoutMs / 1000),
      maxOutputBytes: Number(maxOutputBytes),
      runAsRoot: spec.runAsRoot ?? false,
    } satisfies ExecutionCredentialSpec,
  };
}

export const DEFAULT_RESCUE_TIMEOUT_SECONDS = 5 * 60;
export const DEFAULT_RESCUE_MAX_OUTPUT_BYTES = 256 * 1024;

export interface RescueCredentialSpec {
  arguments?: readonly string[];
  timeoutSeconds?: number;
  maxOutputBytes?: number;
  sshPort?: number;
}

export async function rescueSpecDigest(spec: RescueCredentialSpec): Promise<string> {
  const payload = [
    "v1",
    spec.arguments ? [...spec.arguments] : [],
    Math.trunc(spec.timeoutSeconds ?? 0),
    Math.trunc(spec.maxOutputBytes ?? 0),
    Math.trunc(spec.sshPort ?? 0),
  ];
  return `spec:${await sha256Hex(canonicalJson(payload))}`;
}

export async function rescueCredentialTargets(
  agentId: string,
  action: number,
  spec: RescueCredentialSpec,
): Promise<string[]> {
  return [
    agentId,
    String(Math.trunc(action)),
    String(Math.trunc(spec.sshPort ?? 0)),
    await rescueSpecDigest(spec),
  ];
}
