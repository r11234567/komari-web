function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class AdminRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function requestAdminData<T>(
  input: RequestInfo | URL,
  fallbackMessage: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(input, init);
  let payload: unknown;

  try {
    payload = await response.json();
  } catch {
    throw new Error(fallbackMessage);
  }

  const message =
    isRecord(payload) && typeof payload.message === "string"
      ? payload.message
      : fallbackMessage;
  if (
    !response.ok ||
    !isRecord(payload) ||
    payload.status !== "success" ||
    !("data" in payload)
  ) {
    throw new AdminRequestError(message, response.status);
  }

  return payload.data as T;
}
