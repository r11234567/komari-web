import i18next from "i18next";

// Sensitive operations require a fresh, unused code. Never cache or replay a
// code from opening the terminal or entering the account page.
export function requestFileTwoFactor(): { code: string; challengeId: string } {
  const code = window.prompt(i18next.t(
    "file_manager.fresh_2fa_prompt",
    "Enter a fresh, unused 6-digit 2FA code for this file operation. Enable 2FA in Account first if needed.",
  ));
  if (code === null) throw new DOMException("Operation canceled", "AbortError");
  const trimmed = code.trim();
  if (!/^\d{6}$/.test(trimmed)) throw new Error(i18next.t("file_manager.invalid_2fa", "A 6-digit 2FA code is required"));
  return { code: trimmed, challengeId: "" };
}
