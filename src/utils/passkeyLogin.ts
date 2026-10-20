const PASSKEY_LOGIN_MARKER_KEY = "komari:passkey-login-redirect";
const PASSKEY_LOGIN_MARKER_MAX_AGE_MS = 60_000;

export function markPasskeyLogin(): void {
  try {
    sessionStorage.setItem(PASSKEY_LOGIN_MARKER_KEY, String(Date.now()));
  } catch {
    // Passkey login can still complete when browser storage is unavailable.
  }
}

export function consumePasskeyLoginMarker(nowMs: number = Date.now()): boolean {
  try {
    const markedAt = Number(sessionStorage.getItem(PASSKEY_LOGIN_MARKER_KEY));
    sessionStorage.removeItem(PASSKEY_LOGIN_MARKER_KEY);
    return (
      Number.isFinite(markedAt) &&
      nowMs - markedAt >= 0 &&
      nowMs - markedAt <= PASSKEY_LOGIN_MARKER_MAX_AGE_MS
    );
  } catch {
    return false;
  }
}

export function clearPasskeyLoginMarker(): void {
  try {
    sessionStorage.removeItem(PASSKEY_LOGIN_MARKER_KEY);
  } catch {
    // Storage may be unavailable in privacy-restricted contexts.
  }
}
