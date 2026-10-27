import { useNodeList } from "@/contexts/NodeListContext";
import { formatTrafficGB, trafficResetDescription, trafficResetInstant } from "@/utils/trafficDisplay";

export default function TrafficUsageSummary({ uuid }: { uuid: string }) {
  const context = useNodeList(false);
  const value = context?.nodeList?.find((node) => node.uuid === uuid)?.trafficAccounting;
  if (!value) return null;
  const unavailable = !value.cycleAvailable && (value.resetDay ?? 0) > 0;
  return <div className="km-traffic-accounting text-xs text-[var(--gray-11)] space-y-1" aria-label="流量计费周期">
    <div>{value.cycleAvailable ? "本期计费" : "Agent 累计"}：{formatTrafficGB(value.billable)}（{value.countingType}） · ↑ {formatTrafficGB(value.up)} / ↓ {formatTrafficGB(value.down)}</div>
    <div>{trafficResetDescription(value)}</div>
    {value.nextReset && <div>下次重置：{trafficResetInstant(value.nextReset, value.resetTimezone)}</div>}
    {unavailable && <div role="status">本期历史不完整，暂显示 Agent 累计；请按提供商真实用量校准。</div>}
  </div>;
}
