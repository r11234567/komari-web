export const API_TOKEN_SCOPES = [
  { value: "nodes:read", label: "读取节点信息" },
  { value: "metrics:read", label: "读取历史指标与探测结果" },
] as const;

export interface ApiTokenInput {
  name: string;
  scopes: string[];
  agentIds: string[];
  allAgents: boolean;
  expiresAt: { seconds: bigint; nanos: number };
  allowedCidrs: string[];
  replacesTokenId: string;
}

// Same public policy binding as apiTokenCreateTargets on the server.
export function apiTokenPolicyTargets(input: ApiTokenInput): string[] {
  return [input.name, JSON.stringify(input.scopes), JSON.stringify(input.agentIds), String(input.allAgents),
    `${input.expiresAt.seconds}:${input.expiresAt.nanos}`, JSON.stringify(input.allowedCidrs), input.replacesTokenId];
}

export function apiTokenExpiryInput(now = Date.now()): string {
  const date = new Date(now + 30 * 86400_000);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
