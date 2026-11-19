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
