export async function getBindAuthorizationExpiry(signal: AbortSignal): Promise<number | null> {
  const response = await fetch("/api/public/bind/ticket", {
    credentials: "same-origin",
    cache: "no-store",
    signal,
  });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error("Failed to read bind authorization");
  const { data } = await response.json();
  const remaining = data?.expires_in;
  if (typeof remaining !== "number" || !Number.isFinite(remaining) || remaining <= 0) {
    return null;
  }
  return Date.now() + remaining * 1000;
}

export function formatTicketTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}
