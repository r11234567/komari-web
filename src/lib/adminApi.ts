export type AdminResponse<T> = {
  status: "success" | "error";
  message?: string;
  data?: T;
  code?: string;
};

export async function requestAdminData<T>(
  input: RequestInfo | URL,
  fallbackMessage: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: init?.body
      ? { "Content-Type": "application/json", ...init.headers }
      : init?.headers,
    cache: "no-store",
  });

  let payload: AdminResponse<T>;
  try {
    payload = (await response.json()) as AdminResponse<T>;
  } catch {
    throw new Error(fallbackMessage);
  }

  if (!response.ok || payload.status !== "success" || payload.data === undefined) {
    throw new Error(payload.message || fallbackMessage);
  }
  return payload.data;
}

