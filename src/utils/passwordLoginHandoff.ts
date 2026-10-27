// Navigation metadata only. Authentication remains in the server's HttpOnly,
// cookie-bound preauthentication flow; never persist passwords, OTPs or tokens.
export type PasswordFactorProvider = { id: string; displayName: string };
export type PasswordLoginHandoff = { expiresAt: number; providers: PasswordFactorProvider[] };
export const PASSWORD_LOGIN_HANDOFF_KEY = "komari:password-login-handoff";
const MAX_AGE = 3 * 60_000;

export function savePasswordLoginHandoff(providers: PasswordFactorProvider[], expiresAt: number): void {
  window.sessionStorage.setItem(PASSWORD_LOGIN_HANDOFF_KEY, JSON.stringify({
    expiresAt, providers: providers.map(({ id, displayName }) => ({ id, displayName })),
  }));
}

export function readPasswordLoginHandoff(): PasswordLoginHandoff | null {
  try {
    const raw = window.sessionStorage.getItem(PASSWORD_LOGIN_HANDOFF_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw);
    const now = Date.now();
    if (!Number.isFinite(value?.expiresAt) || value.expiresAt <= now || value.expiresAt > now + MAX_AGE ||
        !Array.isArray(value.providers) || !value.providers.length || value.providers.length > 32 ||
        !value.providers.every((p: PasswordFactorProvider) => typeof p?.id === "string" && p.id.length > 0 && p.id.length <= 256 && typeof p.displayName === "string")) {
      clearPasswordLoginHandoff();
      return null;
    }
    return { expiresAt: value.expiresAt, providers: value.providers.map(({ id, displayName }: PasswordFactorProvider) => ({ id, displayName })) };
  } catch { return null; }
}

export function clearPasswordLoginHandoff(): void {
  try { window.sessionStorage.removeItem(PASSWORD_LOGIN_HANDOFF_KEY); } catch { /* Storage may be disabled. */ }
}
