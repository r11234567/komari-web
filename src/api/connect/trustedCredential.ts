import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { TrustedCredentialService } from "@komari/proto/komari/credential/v1/credential_pb";

// Independent of workspace-aware clients: verification must be possible while
// the workspace is locked. All proofs stay in memory and use the live cookie.
export const trustedCredentialClient = createClient(TrustedCredentialService, createConnectTransport({
  baseUrl: typeof window === "undefined" ? "http://localhost" : window.location.origin,
  useBinaryFormat: true,
  defaultTimeoutMs: 30_000,
  fetch: (input, init) => fetch(input, { ...init, credentials: "same-origin" }),
}));

export const credentialHeader = "X-Komari-Credential-Authorization";
export const workspaceCredentialResource = (agentId: string, systemUser: string) => `workspace:${JSON.stringify([agentId, systemUser])}`;
