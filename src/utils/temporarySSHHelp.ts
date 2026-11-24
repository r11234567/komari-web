const diagnosticCodes = new Set([
  "SSH_CONFIG_MISSING",
  "SSH_CONFIG_INVALID",
  "SSH_NFT_READ_FAILED",
  "SSH_NFT_RULES_INVALID",
  "SSH_STATE_INVALID",
  "SSH_HELPER_UPDATE_REQUIRED",
  "SSH_STATUS_UNAVAILABLE",
]);

export function temporarySSHHelpURL(language: string, code?: string): string {
  const chinese = /^zh(?:[-_]|$)/i.test(language);
  const filename = chinese ? "temporary-ssh.zh-CN.md" : "temporary-ssh.md";
  const section = code && diagnosticCodes.has(code)
    ? code.toLowerCase()
    : chinese ? "申请并验证" : "request-and-confirm-access";
  return `https://github.com/r11234567/komari/blob/main/docs/${filename}#${section}`;
}
