import React from "react";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { AgentSummary } from "@komari/proto/komari/browser/v1/browser_pb";
import { connectUnary } from "../api/connect/client";
import { useConnect } from "./ConnectContext";
import { TRAFFIC_ACCOUNTING_CHANGED, trafficAccountingView, type TrafficAccountingView } from "@/utils/trafficDisplay";

export type NodeBasicInfo = {
  /** 节点唯一标识符 */
  uuid: string;
  /** 节点名称 */
  name: string;
  /** CPU型号 */
  cpu_name: string;
  /** 虚拟化 */
  virtualization: string;
  /** 系统架构 */
  arch: string;
  /** CPU核心数 */
  cpu_cores: number;
  /** 操作系统 */
  os: string;
  /** 内核版本 */
  kernel_version: string;
  /** GPU型号 */
  gpu_name: string;
  /** 地区标识 */
  region: string;
  /** 总内存(字节) */
  mem_total: number;
  /** 总交换空间(字节) */
  swap_total: number;
  /** 总磁盘空间(字节) */
  disk_total: number;
  /** 版本号 */
  version: string;
  /** 权重 */
  weight: number;
  /** 价格 */
  price: number;
  tags: string;
  /** 账单周期（天）*/
  billing_cycle: number;
  /** 货币 */
  currency: string;
  /** 分组 */
  group: string;
  /** 流量阈值 */
  traffic_limit: number;
  /** 流量阈值类型 */
  traffic_limit_type: undefined | "sum" | "max" | "min" | "up" | "down";
  trafficAccounting?: TrafficAccountingView;
  /** 过期时间 */
  expired_at: string;
  /** 创建时间 */
  created_at: string;
  /** 更新时间 */
  updated_at: string;
  ipv4?: string;
  ipv6?: string;
};

interface NodeListContextType {
  nodeList: NodeBasicInfo[] | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
}

const NODE_LIST_CONTEXT_KEY = "__komariNodeListContext" as const;

type NodeListContextGlobal = typeof globalThis & {
  [NODE_LIST_CONTEXT_KEY]?: React.Context<NodeListContextType | undefined>;
};

const globalNodeListContext = globalThis as NodeListContextGlobal;
const NodeListContext =
  globalNodeListContext[NODE_LIST_CONTEXT_KEY] ??
  (globalNodeListContext[NODE_LIST_CONTEXT_KEY] =
    React.createContext<NodeListContextType | undefined>(undefined));

const sameNodeBasicInfo = (left: NodeBasicInfo, right: NodeBasicInfo) =>
  (Object.keys(right) as Array<keyof NodeBasicInfo>).every(
    (key) => key === "trafficAccounting"
      ? JSON.stringify(left[key]) === JSON.stringify(right[key])
      : left[key] === right[key],
  );

export const NodeListProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [nodeList, setNodeList] = React.useState<NodeBasicInfo[] | null>(null);
  const [isLoading, setIsLoading] = React.useState<boolean>(true);
  const [error, setError] = React.useState<string | null>(null);
  const { browser } = useConnect();
  const refreshSeqRef = React.useRef(0);
  const mountedRef = React.useRef(true);
  const activeRequest = React.useRef<AbortController | null>(null);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      activeRequest.current?.abort(
        new DOMException("Provider unmounted", "AbortError"),
      );
    };
  }, []);

  const refresh = React.useCallback(() => {
    // Login does not render node data. A private site's guest must not poll
    // protected node reads and surface repeated 401 notices while entering OTP.
    if (["/login", "/bind-login"].includes(window.location.pathname.replace(/\/$/, ""))) {
      setIsLoading(false);
      return;
    }
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      return;
    }
    const refreshSeq = ++refreshSeqRef.current;
    activeRequest.current?.abort(
      new DOMException("Superseded", "AbortError"),
    );
    const controller = new AbortController();
    activeRequest.current = controller;
    // setIsLoading(true);
    setError(null);
    const request = async () => {
      const response = await connectUnary(
        { signal: controller.signal },
        (signal, timeoutMs) => browser.listAgents({}, { signal, timeoutMs }),
      );
      return response.agents.map(agentSummaryToNode);
    };

    void request()
      .then((list) => {
        if (!mountedRef.current || refreshSeq !== refreshSeqRef.current) return;
        setNodeList((previous) => {
          if (!previous) return list;
          const previousByUuid = new Map(
            previous.map((node) => [node.uuid, node]),
          );
          let changed = previous.length !== list.length;
          const shared = list.map((node, index) => {
            const previousNode = previousByUuid.get(node.uuid);
            if (previousNode && sameNodeBasicInfo(previousNode, node)) {
              if (previous[index] !== previousNode) changed = true;
              return previousNode;
            }
            changed = true;
            return node;
          });
          return changed ? shared : previous;
        });
      })
      .catch((err: any) => {
        if (!mountedRef.current || refreshSeq !== refreshSeqRef.current) return;
        if (err?.name === "AbortError") return;
        setError(err?.message || "An error occurred while fetching data");
        // Keep previous list on error so the page doesn't blank out
      })
      .finally(() => {
        if (!mountedRef.current || refreshSeq !== refreshSeqRef.current) return;
        if (activeRequest.current === controller) activeRequest.current = null;
        setIsLoading(false);
      });
  }, [browser]);

  React.useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 15_000);
    window.addEventListener(TRAFFIC_ACCOUNTING_CHANGED, refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener(TRAFFIC_ACCOUNTING_CHANGED, refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [refresh]);

  const contextValue = React.useMemo(
    () => ({ nodeList, isLoading, error, refresh }),
    [nodeList, isLoading, error, refresh],
  );

  return (
    <NodeListContext.Provider value={contextValue}>
      {children}
    </NodeListContext.Provider>
  );
};

const agentSummaryToNode = (agent: AgentSummary): NodeBasicInfo => {
  const basic = agent.basicInfo;
  return {
    uuid: agent.agentId,
    name: agent.name,
    cpu_name: basic?.cpuName ?? "",
    virtualization: basic?.virtualization ?? "",
    arch: basic?.architecture ?? "",
    cpu_cores: basic?.cpuCores ?? 0,
    os: basic?.os ?? "",
    kernel_version: basic?.kernelVersion ?? "",
    gpu_name: basic?.gpuName ?? "",
    region: basic?.region ?? "",
    mem_total: Number(basic?.memoryTotalBytes ?? 0n),
    swap_total: Number(basic?.swapTotalBytes ?? 0n),
    disk_total: Number(basic?.diskTotalBytes ?? 0n),
    version: basic?.agentVersion ?? "",
    weight: basic?.weight ?? 0,
    price: basic?.price ?? 0,
    tags: basic?.tags ?? "",
    billing_cycle: basic?.billingCycleDays ?? 0,
    currency: basic?.currency ?? "",
    group: basic?.group ?? "",
    traffic_limit: Number(basic?.trafficLimitBytes ?? 0n),
    trafficAccounting: trafficAccountingView(agent.trafficAccounting),
    traffic_limit_type: (basic?.trafficLimitType ||
      undefined) as NodeBasicInfo["traffic_limit_type"],
    expired_at: basic?.expiresAt
      ? timestampDate(basic.expiresAt).toISOString()
      : "",
    created_at: basic?.createdAt
      ? timestampDate(basic.createdAt).toISOString()
      : "",
    updated_at: basic?.updatedAt
      ? timestampDate(basic.updatedAt).toISOString()
      : "",
    ipv4: basic?.ipv4 || undefined,
    ipv6: basic?.ipv6 || undefined,
  };
};

export function useNodeList(): NodeListContextType;
export function useNodeList(required: false): NodeListContextType | undefined;
export function useNodeList(required = true) {
  const context = React.useContext(NodeListContext);
  if (!context && required) {
    throw new Error("useNodeList must be used within a NodeListProvider");
  }
  return context;
}
