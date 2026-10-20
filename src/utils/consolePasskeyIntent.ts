const INTENT_KEY = "komari:console-passkey-intent";
const MAX_AGE_MS = 60_000;

type IntentStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type IntentOptions = { storage?: IntentStorage; now?: number };

// This records navigation intent only. The caller must separately confirm login.
export function markConsolePasskeyIntent(path: string, options: IntentOptions = {}): void {
  try {
    (options.storage ?? window.sessionStorage).setItem(
      INTENT_KEY,
      JSON.stringify({ path, startedAt: options.now ?? Date.now() }),
    );
  } catch {
    // Authentication can continue when browser storage is unavailable.
  }
}

export function consumeConsolePasskeyIntent(path: string, options: IntentOptions = {}): boolean {
  try {
    const storage = options.storage ?? window.sessionStorage;
    const raw = storage.getItem(INTENT_KEY);
    storage.removeItem(INTENT_KEY);
    if (raw === null) return false;
    const intent = JSON.parse(raw);
    if (intent?.path !== path || typeof intent.startedAt !== "number") return false;
    const age = (options.now ?? Date.now()) - intent.startedAt;
    return Number.isFinite(age) && age >= 0 && age <= MAX_AGE_MS;
  } catch {
    return false;
  }
}

export function clearConsolePasskeyIntent(options: IntentOptions = {}): void {
  try {
    (options.storage ?? window.sessionStorage).removeItem(INTENT_KEY);
  } catch {
    // Storage may be unavailable in privacy-restricted contexts.
  }
}
