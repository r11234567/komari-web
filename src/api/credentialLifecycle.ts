export type CredentialPolicy = {
  revision: number;
  idle_days: number;
  absolute_days: number;
  migration_grace_days: number;
  warning_days: number;
};
export type AgentCredentialStatus = {
  agent_id: string;
  name: string;
  generation: number;
  protocol: number;
  fingerprint: string;
  status: "active" | "migration" | "expiring" | "expired" | "revoked";
  access_expires_at: string;
  idle_expires_at: string;
  absolute_expires_at: string | null;
  last_refresh_at: string | null;
  migration_grace_until: string | null;
  recovery_until: string | null;
  last_approved_at: string | null;
  can_reapprove: boolean;
};
export type CredentialLifecycle = {
  policy: CredentialPolicy;
  credentials: AgentCredentialStatus[];
  total: number;
  page: number;
  page_size: number;
};
export const credentialLifecyclePath = "/api/admin/agent-credentials";

export function validCredentialPolicy(policy: CredentialPolicy): boolean {
  return Number.isSafeInteger(policy.revision) && policy.revision > 0 &&
    [policy.idle_days, policy.absolute_days, policy.migration_grace_days, policy.warning_days].every(Number.isSafeInteger) &&
    policy.idle_days >= 1 && policy.idle_days <= 30 &&
    policy.absolute_days >= 30 && policy.absolute_days <= 365 && policy.absolute_days >= policy.idle_days &&
    policy.migration_grace_days >= 1 && policy.migration_grace_days <= 90 &&
    policy.warning_days >= 1 && policy.warning_days <= 30;
}
async function responseData(response: Response) {
  const body = await response.json();
  if (!response.ok || body.status !== "success") throw new Error(body.message || "凭据操作失败，请刷新后重试");
  return body.data;
}
export async function loadCredentialLifecycle(page: number, signal: AbortSignal): Promise<CredentialLifecycle> {
  if (!Number.isSafeInteger(page) || page < 1) throw new Error("无效页码");
  return responseData(await fetch(credentialLifecyclePath + "?page=" + page, { credentials: "same-origin", signal }));
}
export type CredentialLifecycleAction =
  | { kind: "policy"; policy: CredentialPolicy }
  | { kind: "reapprove"; agent: AgentCredentialStatus };
export function credentialActionPath(action: CredentialLifecycleAction): string {
  return action.kind === "policy" ? credentialLifecyclePath + "/policy" :
    credentialLifecyclePath + "/" + encodeURIComponent(action.agent.agent_id) + "/reapprove";
}
export async function applyCredentialLifecycle(action: CredentialLifecycleAction, token: string, signal: AbortSignal): Promise<void> {
  if (!token) throw new Error("需要新的可信凭据验证");
  if (action.kind === "policy" && !validCredentialPolicy(action.policy)) throw new Error("凭据期限设置无效");
  const body = action.kind === "policy" ? action.policy :
    { generation: action.agent.generation, fingerprint: action.agent.fingerprint };
  await responseData(await fetch(credentialActionPath(action), {
    method: "POST", credentials: "same-origin", signal,
    headers: { "Content-Type": "application/json", "X-Komari-Credential-Authorization": token },
    body: JSON.stringify(body),
  }));
}
