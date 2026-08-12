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

export const LiveDataProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [live_data, setLiveData] = useState<LiveDataResponse | null>(null);
  const liveDataRef = useRef<LiveDataResponse | null>(null);
  const [showCallout, setShowCallout] = useState(false);
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
    const controller = new AbortController();
    const refreshCallbacks = refreshCallbacksRef.current;
    let afterEventId = "";

    const waitToReconnect = () =>
      new Promise<void>((resolve) => {
        const timer = window.setTimeout(resolve, 2_000);
        controller.signal.addEventListener(
          "abort",
          () => {
            window.clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      });

    const watch = async () => {
      while (!controller.signal.aborted) {
        try {
          for await (const event of browser.watchAgentStatus(
            { agentIds: [], afterEventId },
            { signal: controller.signal, timeoutMs: 0 },
          )) {
            const agent = event.agent;
            if (!agent || controller.signal.aborted) continue;
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
            }
            setShowCallout(true);
          }
        } catch (error) {
          if (controller.signal.aborted) return;
          console.error("Connect status stream failed:", error);
          setShowCallout(false);
        }
        if (!controller.signal.aborted) await waitToReconnect();
      }
    };

    void watch();
    return () => {
      controller.abort(new DOMException("Provider unmounted", "AbortError"));
      refreshCallbacks.clear();
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
