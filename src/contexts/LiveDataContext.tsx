import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AgentStatus } from "@komari/proto/komari/browser/v1/browser_pb";
import { reportToLiveRecord } from "@/api/connect/public";
import type {
  LiveDataResponse,
  Record as LiveRecord,
} from "../types/LiveData";
import { useConnect } from "./ConnectContext";

const sameStringArray = (left: string[], right: string[]) =>
  left.length === right.length &&
  left.every((value, index) => value === right[index]);

const sameLiveRecord = (left: LiveRecord, right: LiveRecord) =>
  left.cpu.usage === right.cpu.usage &&
  left.ram.used === right.ram.used &&
  left.swap.used === right.swap.used &&
  left.load.load1 === right.load.load1 &&
  left.load.load5 === right.load.load5 &&
  left.load.load15 === right.load.load15 &&
  left.disk.used === right.disk.used &&
  left.network.up === right.network.up &&
  left.network.down === right.network.down &&
  left.network.totalUp === right.network.totalUp &&
  left.network.totalDown === right.network.totalDown &&
  left.connections.tcp === right.connections.tcp &&
  left.connections.udp === right.connections.udp &&
  left.gpu?.average_usage === right.gpu?.average_usage &&
  Boolean(left.gpu) === Boolean(right.gpu) &&
  left.uptime === right.uptime &&
  left.process === right.process &&
  left.message === right.message &&
  left.updated_at === right.updated_at;

interface LiveDataContextType {
  live_data: LiveDataResponse | null;
  showCallout: boolean;
  onRefresh: (callback: (data: LiveDataResponse) => void) => () => void;
}

const LiveDataContext = createContext<LiveDataContextType>({
  live_data: null,
  showCallout: true,
  onRefresh: () => () => {},
});

const LIVE_DATA_CHANNEL = "komari:live-data-channel";
const LIVE_DATA_LOCK = "komari:live-stream-leader-lock";
const INITIAL_BACKOFF_MS = 1_500;
const MAX_BACKOFF_MS = 30_000;

export const LiveDataProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [live_data, setLiveData] = useState<LiveDataResponse | null>(null);
  const liveDataRef = useRef<LiveDataResponse | null>(null);
  const [showCallout, setShowCallout] = useState(true);
  const refreshCallbacksRef = useRef<Set<(data: LiveDataResponse) => void>>(
    new Set(),
  );
  const { browser } = useConnect();

  const onRefresh = useCallback((callback: (data: LiveDataResponse) => void) => {
    refreshCallbacksRef.current.add(callback);
    return () => refreshCallbacksRef.current.delete(callback);
  }, []);

  const notifyRefreshCallbacks = useCallback((data: LiveDataResponse) => {
    refreshCallbacksRef.current.forEach((callback) => callback(data));
  }, []);

  useEffect(() => {
    const rootController = new AbortController();
    const rootSignal = rootController.signal;
    let channel: BroadcastChannel | null = null;

    try {
      if (typeof BroadcastChannel !== "undefined") {
        channel = new BroadcastChannel(LIVE_DATA_CHANNEL);
        channel.onmessage = (event) => {
          if (event.data?.type === "LIVE_DATA_UPDATE" && event.data.payload) {
            const next = event.data.payload as LiveDataResponse;
            liveDataRef.current = next;
            setLiveData(next);
            notifyRefreshCallbacks(next);
            setShowCallout(true);
          }
        };
      }
    } catch {
      // BroadcastChannel unavailable; proceed with direct connection
    }

    const broadcastUpdate = (next: LiveDataResponse) => {
      try {
        channel?.postMessage({
          type: "LIVE_DATA_UPDATE",
          payload: next,
        });
      } catch {
        // Channel post failed; ignore
      }
    };

    let backoffMs = INITIAL_BACKOFF_MS;
    let afterEventId = "";

    const waitWithBackoff = (signal: AbortSignal) =>
      new Promise<void>((resolve) => {
        if (signal.aborted) {
          resolve();
          return;
        }

        // If tab is hidden, pause reconnecting until it becomes visible
        const computeDelay = () => {
          const jitter = (Math.random() - 0.5) * 0.4; // +/- 20%
          const delay = Math.min(MAX_BACKOFF_MS, Math.round(backoffMs * (1 + jitter)));
          backoffMs = Math.min(MAX_BACKOFF_MS, Math.round(backoffMs * 1.8));
          return Math.max(1_000, delay);
        };

        let timer: number | null = null;

        const cleanup = () => {
          if (timer !== null) {
            window.clearTimeout(timer);
            timer = null;
          }
          document.removeEventListener("visibilitychange", onVisibilityChange);
          signal.removeEventListener("abort", onAbort);
        };

        const onAbort = () => {
          cleanup();
          resolve();
        };

        const onVisibilityChange = () => {
          if (document.visibilityState === "visible") {
            // Wake up immediately upon tab becoming visible
            cleanup();
            resolve();
          }
        };

        if (typeof document !== "undefined" && document.visibilityState === "hidden") {
          document.addEventListener("visibilitychange", onVisibilityChange);
          signal.addEventListener("abort", onAbort, { once: true });
          return;
        }

        signal.addEventListener("abort", onAbort, { once: true });
        document.addEventListener("visibilitychange", onVisibilityChange);
        timer = window.setTimeout(() => {
          cleanup();
          resolve();
        }, computeDelay());
      });

    const runStreamLoop = async (signal: AbortSignal) => {
      while (!signal.aborted) {
        // Pause while tab is hidden
        if (typeof document !== "undefined" && document.visibilityState === "hidden") {
          await new Promise<void>((resolve) => {
            const onVis = () => {
              if (document.visibilityState === "visible") {
                document.removeEventListener("visibilitychange", onVis);
                signal.removeEventListener("abort", onAbort);
                resolve();
              }
            };
            const onAbort = () => {
              document.removeEventListener("visibilitychange", onVis);
              resolve();
            };
            document.addEventListener("visibilitychange", onVis);
            signal.addEventListener("abort", onAbort, { once: true });
          });
          if (signal.aborted) break;
        }

        try {
          const stream = browser.watchAgentStatus(
            { agentIds: [], afterEventId },
            { signal, timeoutMs: 0 },
          );
          setShowCallout(true);
          for await (const event of stream) {
            if (signal.aborted) break;
            const agent = event.agent;
            if (!agent) continue;

            // Reset backoff on receiving live events
            backoffMs = INITIAL_BACKOFF_MS;
            afterEventId = agent.eventId || afterEventId;

            const previous = liveDataRef.current?.data ?? {
              online: [],
              data: {},
            };
            const onlineSet = new Set(previous.online);
            if (agent.status === AgentStatus.ONLINE) onlineSet.add(agent.agentId);
            else onlineSet.delete(agent.agentId);
            const nextOnline = [...onlineSet];
            const nextRecord = reportToLiveRecord(event.latestReport);
            const oldRecord = previous.data[agent.agentId];
            const data =
              oldRecord && sameLiveRecord(oldRecord, nextRecord)
                ? previous.data
                : { ...previous.data, [agent.agentId]: nextRecord };
            const online = sameStringArray(previous.online, nextOnline)
              ? previous.online
              : nextOnline;
            const live: LiveDataResponse =
              liveDataRef.current &&
              data === previous.data &&
              online === previous.online
                ? liveDataRef.current
                : { data: { online, data }, status: "ok" };

            if (live !== liveDataRef.current) {
              liveDataRef.current = live;
              setLiveData(live);
              notifyRefreshCallbacks(live);
              broadcastUpdate(live);
            }
            setShowCallout(true);
          }
        } catch (error) {
          if (signal.aborted) return;
          console.error("Connect status stream encountered error, backing off:", error);
          setShowCallout(false);
        }

        if (!signal.aborted) {
          await waitWithBackoff(signal);
        }
      }
    };

    // Leader election via Web Locks API (or direct streaming fallback)
    const startLeaderElection = async () => {
      if (typeof navigator !== "undefined" && "locks" in navigator) {
        try {
          await navigator.locks.request(LIVE_DATA_LOCK, { signal: rootSignal }, async () => {
            if (rootSignal.aborted) return;
            await runStreamLoop(rootSignal);
          });
          return;
        } catch (err: any) {
          if (err?.name === "AbortError") return;
          // Fall back to direct stream loop if lock request failed
        }
      }
      await runStreamLoop(rootSignal);
    };

    void startLeaderElection();

    return () => {
      rootController.abort(new DOMException("Provider unmounted", "AbortError"));
      try {
        channel?.close();
      } catch {
        // Channel close safe ignore
      }
      refreshCallbacksRef.current.clear();
    };
  }, [browser, notifyRefreshCallbacks]);

  const contextValue = useMemo(
    () => ({ live_data, showCallout, onRefresh }),
    [live_data, showCallout, onRefresh],
  );

  return (
    <LiveDataContext.Provider value={contextValue}>
      {children}
    </LiveDataContext.Provider>
  );
};

export const useLiveData = () => useContext(LiveDataContext);

export default LiveDataContext;
