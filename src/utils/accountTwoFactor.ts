import { credentialHeader } from "./credentialHeader.ts";

export function buildEnableTwoFactorRequest(
  code: string,
  credentialToken?: string,
  signal?: AbortSignal,
): { url: string; init: RequestInit } {
  const headers: Record<string, string> = {};
  if (credentialToken) {
    headers[credentialHeader] = credentialToken;
  }
  return {
    url: `/api/admin/2fa/enable?code=${encodeURIComponent(code.trim())}`,
    init: {
      method: "POST",
      credentials: "same-origin",
      signal,
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
    },
  };
}
