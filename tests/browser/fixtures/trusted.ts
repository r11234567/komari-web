import { state } from "./state";
export { credentialHeader, workspaceCredentialResource } from "../../../src/api/connect/trustedCredential";

// Synthetic transport around the real verification form; no production bypass.
export const trustedCredentialClient = {
  async listTrustedCredentialProviders() { return { providers: [{ id: "native:totp", displayName: "Fixture TOTP" }] }; },
  async beginVerification(request: { purpose: number; resource: string }) {
    state.verifications.push({ ...request });
    return { challengeId: `challenge-${state.verifications.length}`, promptType: "otp", prompt: { length: 6, charset: "numeric" } };
  },
  async completeVerification(request: { challengeId: string; proof: { code: string } }) {
    state.proofs.push(request);
    if (request.proof.code !== "123456") throw new Error("Synthetic transport: invalid test OTP");
    return { authorization: { grantToken: "synthetic-scoped-proof" } };
  },
  async cancelVerification() { return {}; },
};
