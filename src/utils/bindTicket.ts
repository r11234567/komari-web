const BIND_TICKET_KEY = "komari:bind-ticket";
const LEGACY_BIND_TICKET_EXP_KEY = "komari:bind-ticket-exp";
const BIND_TICKET_VERSION = 1;

export type StoredBindTicket = {
  version: 1;
  ticket: string;
  expiresAt: number;
};

function parseStoredBindTicket(raw: string | null): StoredBindTicket | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredBindTicket>;
    if (
      parsed.version !== BIND_TICKET_VERSION ||
      typeof parsed.ticket !== "string" ||
      parsed.ticket.length === 0 ||
      typeof parsed.expiresAt !== "number" ||
      !Number.isFinite(parsed.expiresAt)
    ) {
      return null;
    }
    return {
      version: BIND_TICKET_VERSION,
      ticket: parsed.ticket,
      expiresAt: parsed.expiresAt,
    };
  } catch {
    return null;
  }
}

function readStoredBindTicket(): StoredBindTicket | null {
  if (typeof window === "undefined") return null;
  try {
    return parseStoredBindTicket(window.sessionStorage?.getItem(BIND_TICKET_KEY) ?? null);
  } catch {
    return null;
  }
}

export function getStoredBindTicket(): StoredBindTicket | null {
  const stored = readStoredBindTicket();
  if (!stored || Date.now() >= stored.expiresAt) {
    return null;
  }
  return stored;
}

export function setStoredBindTicket(
  ticket: string,
  durationSeconds: number = 120,
): boolean {
  if (
    typeof window === "undefined" ||
    ticket.length === 0 ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0
  ) {
    return false;
  }
  const record: StoredBindTicket = {
    version: BIND_TICKET_VERSION,
    ticket,
    expiresAt: Date.now() + durationSeconds * 1000,
  };
  try {
    window.sessionStorage.setItem(BIND_TICKET_KEY, JSON.stringify(record));
    const stored = readStoredBindTicket();
    if (!stored || stored.ticket !== record.ticket || stored.expiresAt !== record.expiresAt) {
      return false;
    }
    try {
      window.sessionStorage.removeItem(LEGACY_BIND_TICKET_EXP_KEY);
    } catch {
      // The new atomic record is valid; legacy cleanup is best-effort.
    }
    return true;
  } catch {
    return false;
  }
}

export function clearStoredBindTicket(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(BIND_TICKET_KEY);
    window.sessionStorage.removeItem(LEGACY_BIND_TICKET_EXP_KEY);
  } catch {
    // Storage may be blocked by browser privacy settings.
  }
}

export function getBindTicketRemainingSeconds(): number {
  const stored = getStoredBindTicket();
  if (!stored) return 0;
  return Math.max(0, Math.floor((stored.expiresAt - Date.now()) / 1000));
}

export function formatTicketTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}
