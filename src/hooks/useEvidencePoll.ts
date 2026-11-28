import { useCallback, useEffect, useState } from "react";

export function useEvidencePoll<T>(load: (signal: AbortSignal) => Promise<T>, delay = 10_000) {
  const [state, setState] = useState<{ data?: T; error?: boolean }>({});
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((n) => n + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pending = false;
    let failures = 0;
    async function run() {
      if (pending || controller.signal.aborted || document.hidden) return;
      clearTimeout(timer);
      pending = true;
      try {
        const data = await load(controller.signal);
        if (!controller.signal.aborted) setState({ data });
        failures = 0;
      } catch {
        if (!controller.signal.aborted) setState((old) => ({ ...old, error: true }));
        failures++;
      } finally {
        pending = false;
        if (!controller.signal.aborted && !document.hidden) {
          timer = setTimeout(run, Math.min(delay * 2 ** failures, 60_000));
        }
      }
    }
    function visibility() {
      if (document.hidden) clearTimeout(timer);
      else void run();
    }
    void run();
    document.addEventListener("visibilitychange", visibility);
    return () => {
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [delay, load, revision]);
  return { ...state, refresh };
}
