import { useMemo } from "react";
import { ArrowDown, ArrowUp, Gauge } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNodeList } from "@/contexts/NodeListContext";
import { useLiveData } from "@/contexts/LiveDataContext";
import { getOSImage } from "@/utils/osImageHelper";
import { formatBytes } from "@/utils/unitHelper";

interface ResourceSample {
  online: boolean;
  cpuUsage: number;
  ramUsed: number;
  diskUsed: number;
  networkDown: number;
  networkUp: number;
}

const normalizePercent = (value: number) =>
  Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0));

const usagePercent = (used: number, total: number) =>
  total > 0 ? normalizePercent((used / total) * 100) : 0;

const usageColor = (percent: number) => {
  if (percent >= 90) return "#dc143c";
  if (percent >= 70) return "#eab308";
  return "#3cb371";
};

const UsageMetric = ({
  label,
  detail,
  percent,
}: {
  label: string;
  detail: string;
  percent: number;
}) => (
  <div>
    <div className="flex items-baseline justify-between gap-1 text-[10px] leading-4">
      <span className="text-neutral-400">{label}</span>
      <span className="min-w-0 truncate font-medium text-neutral-100">{detail}</span>
    </div>
    <div className="mt-0.5 h-[3px] overflow-hidden rounded-full bg-neutral-800">
      <div
        className="h-full rounded-full transition-[width] duration-500"
        style={{
          backgroundColor: usageColor(normalizePercent(percent)),
          width: `${normalizePercent(percent)}%`,
        }}
      />
    </div>
  </div>
);

interface EditorResourceMonitorProps {
  uuid: string;
}

const EditorResourceMonitor = ({ uuid }: EditorResourceMonitorProps) => {
  const { t } = useTranslation();
  const { live_data, showCallout } = useLiveData();
  const { nodeList } = useNodeList(false) ?? { nodeList: [] };

  const node = useMemo(
    () => (nodeList ?? []).find((item) => item.uuid === uuid),
    [nodeList, uuid],
  );

  const sample = useMemo<ResourceSample | null>(() => {
    if (!uuid || !live_data || !showCallout) return null;
    const record = live_data.data.data[uuid];
    if (!record) return null;
    return {
      online: live_data.data.online.includes(uuid),
      cpuUsage: normalizePercent(record?.cpu?.usage ?? 0),
      ramUsed: record?.ram?.used ?? 0,
      diskUsed: record?.disk?.used ?? 0,
      networkDown: record?.network?.down ?? 0,
      networkUp: record?.network?.up ?? 0,
    };
  }, [live_data, showCallout, uuid]);

  return (
    <section className="shrink-0 border-t border-[#2b2b2b] bg-[#181818]" aria-label={t("terminal.resource_monitor.title", "资源小窗")}>
      <div className="flex h-7 items-center gap-1.5 px-2 text-[10px] font-semibold uppercase text-neutral-500">
        <Gauge size={12} className="shrink-0" />
        <span>{t("terminal.resource_monitor.title", "资源小窗")}</span>
        <img
          src={getOSImage(node?.os || "")}
          alt=""
          draggable={false}
          className="ml-auto h-3 w-3 shrink-0 object-contain"
        />
        <span className="max-w-[72px] truncate normal-case">{node?.name ?? uuid}</span>
      </div>

      <div className="space-y-1.5 px-2 pb-2">
        {!sample ? (
          <p className="pb-0.5 text-[10px] text-neutral-500">
            {t("terminal.resource_monitor.waiting", "等待数据...")}
          </p>
        ) : !sample.online ? (
          <p className="pb-0.5 text-[10px] text-red-300">
            {t("nodeCard.offline", "离线")}
          </p>
        ) : (
          <>
            <UsageMetric
              label="CPU"
              detail={`${sample.cpuUsage.toFixed(1)}%`}
              percent={sample.cpuUsage}
            />
            <UsageMetric
              label={t("nodeCard.ram", "内存")}
              detail={`${formatBytes(sample.ramUsed)} / ${formatBytes(node?.mem_total ?? 0)}`}
              percent={usagePercent(sample.ramUsed, node?.mem_total ?? 0)}
            />
            <UsageMetric
              label={t("nodeCard.disk", "磁盘")}
              detail={`${formatBytes(sample.diskUsed)} / ${formatBytes(node?.disk_total ?? 0)}`}
              percent={usagePercent(sample.diskUsed, node?.disk_total ?? 0)}
            />
            <div className="grid grid-cols-2 gap-x-1.5 pt-0.5">
              <div className="min-w-0">
                <div className="flex items-center gap-0.5 text-[10px] text-neutral-400">
                  <ArrowUp size={9} className="shrink-0" />
                  <span>{t("dashboard.uploadRate", "上传速率")}</span>
                </div>
                <p className="truncate text-[10px] font-medium text-neutral-100">
                  {formatBytes(sample.networkUp)}/s
                </p>
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-0.5 text-[10px] text-neutral-400">
                  <ArrowDown size={9} className="shrink-0" />
                  <span>{t("dashboard.downloadRate", "下载速率")}</span>
                </div>
                <p className="truncate text-[10px] font-medium text-neutral-100">
                  {formatBytes(sample.networkDown)}/s
                </p>
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
};

export default EditorResourceMonitor;
