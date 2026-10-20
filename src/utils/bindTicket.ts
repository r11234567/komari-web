const BIND_TICKET_KEY = "komari:bind-ticket";
const BIND_TICKET_EXP_KEY = "komari:bind-ticket-exp";

export function getStoredBindTicket(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const ticket = window.sessionStorage?.getItem(BIND_TICKET_KEY);
    const exp = Number(window.sessionStorage?.getItem(BIND_TICKET_EXP_KEY));
    if (ticket && Number.isFinite(exp) && Date.now() < exp) {
      return ticket;
    }
  } catch {
    // sessionStorage not available
  }
  return null;
}

export function setStoredBindTicket(ticket: string, durationSeconds: number = 120): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage?.setItem(BIND_TICKET_KEY, ticket);
    window.sessionStorage?.setItem(BIND_TICKET_EXP_KEY, String(Date.now() + durationSeconds * 1000));
  } catch {
    // ignore
  }
}

export function clearStoredBindTicket(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage?.removeItem(BIND_TICKET_KEY);
    window.sessionStorage?.removeItem(BIND_TICKET_EXP_KEY);
  } catch {
    // ignore
  }
}

export function getBindTicketRemainingSeconds(): number {
  if (typeof window === "undefined") return 0;
  try {
    const exp = Number(window.sessionStorage?.getItem(BIND_TICKET_EXP_KEY));
    if (Number.isFinite(exp)) {
      return Math.max(0, Math.floor((exp - Date.now()) / 1000));
    }
  } catch {
    // ignore
  }
  return 0;
}

export function formatTicketTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}
