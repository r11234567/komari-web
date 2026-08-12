export interface RequestBudget {
  signal: AbortSignal;
  timeoutMs: number;
}

export const DEFAULT_UNARY_DEADLINE_MS = 15_000;
export const DEFAULT_STREAM_DEADLINE_MS = 30 * 60_000;

export async function withRequestBudget<T>(
  externalSignal: AbortSignal,
  timeoutMs: number,
  operation: (budget: RequestBudget) => Promise<T>,
): Promise<T> {
  if (externalSignal.aborted) {
    throw externalSignal.reason ?? new DOMException("Request aborted", "AbortError");
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError("timeoutMs must be a positive finite number");
  }
  const deadline = AbortSignal.timeout(timeoutMs);
  const signal = AbortSignal.any([externalSignal, deadline]);
  return operation({ signal, timeoutMs });
}
