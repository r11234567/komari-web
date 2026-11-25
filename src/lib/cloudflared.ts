import { credentialHeader } from "../utils/credentialHeader.ts";

type CloudflaredAuthorization = { authorization: string; signal: AbortSignal };

export interface CloudflaredStatus {
  installed: boolean;
  running: boolean;
  message: string;
  errorMessage: string;
  logs: string[];
  pid?: number;
  binaryPath?: string;
  tokenStored: boolean;
  envTokenPresent: boolean;
}

export const CLOUDFLARED_STOP_CONFIRM_TEXT = "STOP CLOUDFLARED";

async function parseResponse<T>(response: Response): Promise<T> {
  const data = await response.json();
  if (!response.ok || data.status === "error") {
    throw new Error(data.message || `HTTP ${response.status}`);
  }
  return data.data as T;
}

export async function getCloudflaredStatus(): Promise<CloudflaredStatus> {
  const response = await fetch("/api/admin/settings/cloudflared");
  return parseResponse<CloudflaredStatus>(response);
}

export async function startCloudflared(
  token: string,
  { authorization, signal }: CloudflaredAuthorization,
): Promise<CloudflaredStatus> {
  const response = await fetch("/api/admin/settings/cloudflared/start", {
    method: "POST",
    signal,
    headers: {
      [credentialHeader]: authorization,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ token }),
  });
  return parseResponse<CloudflaredStatus>(response);
}

export async function stopCloudflared(
  currentPassword: string,
  confirmText: string,
  { authorization, signal }: CloudflaredAuthorization,
): Promise<CloudflaredStatus> {
  const response = await fetch("/api/admin/settings/cloudflared/stop", {
    method: "POST",
    signal,
    headers: {
      [credentialHeader]: authorization,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      current_password: currentPassword,
      confirm_text: confirmText,
    }),
  });
  return parseResponse<CloudflaredStatus>(response);
}

export async function removeCloudflaredToken({ authorization, signal }: CloudflaredAuthorization): Promise<CloudflaredStatus> {
  const response = await fetch("/api/admin/settings/cloudflared/remove-token", {
    method: "POST",
    signal,
    headers: { [credentialHeader]: authorization },
  });
  return parseResponse<CloudflaredStatus>(response);
}
