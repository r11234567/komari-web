import { useNodeList } from "@/contexts/NodeListContext";
import { requestAdminData } from "@/lib/adminApi";
import { Button, Flex, Progress, Select, Text, TextField } from "@radix-ui/themes";
import { Download, FileDown, RotateCcw, X } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { SettingCard } from "./SettingCard";

type ExportCategory = "resource" | "network" | "latency" | "all";
type ExportStatus = "queued" | "running" | "done" | "failed" | "cancelled";
type RangeMode = "quick" | "custom";

type ExportJob = {
  id: string;
  type: ExportCategory;
  category: ExportCategory;
  node_name: string;
  status: ExportStatus;
  progress: number;
  start: string;
  end: string;
  created_at: string;
  expires_at: string;
  filename?: string;
  size?: number;
  error?: string;
};

type RetentionInfo = {
  resource_hours: number;
  ping_hours: number;
};

/** Format hours to a short human-readable label. */
function fmtHours(h: number): string {
  if (h < 24) return `${h}h`;
  const d = h / 24;
  return Number.isInteger(d) ? `${d}d` : `${h}h`;
}

/**
 * Build the quick-select shortcut list.
 * Fixed entries: 1h 6h 12h 1d 7d 15d, then 15-day increments up to maxHours.
 */
function buildRanges(maxHours: number): { hours: number; label: string }[] {
  const result: { hours: number; label: string }[] = [];
  const fixed = [1, 6, 12, 24, 7 * 24, 15 * 24];
  for (const h of fixed) {
    if (h <= maxHours) result.push({ hours: h, label: fmtHours(h) });
  }
  // 15-day steps starting at 30d
  for (let days = 30; days * 24 <= maxHours; days += 15) {
    if (!result.find((r) => r.hours === days * 24)) {
      result.push({ hours: days * 24, label: `${days}d` });
    }
  }
  // Always include exact retention ceiling if not already present
  const last = result[result.length - 1];
  if (!last || last.hours < maxHours) {
    result.push({ hours: maxHours, label: fmtHours(maxHours) });
  }
  return result;
}

/** Convert a datetime-local value ("YYYY-MM-DDTHH:mm") to RFC3339. */
function localInputToRFC3339(value: string): string {
  if (!value) return "";
  // datetime-local gives local time; Date constructor treats it as local
  return new Date(value).toISOString();
}

/** Convert an ISO timestamp to datetime-local input value. */
function isoToLocalInput(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  // format: YYYY-MM-DDTHH:mm (local time, no seconds)
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

const exportStorageKey = "komari-lts-history-export-job";
const retentionStorageKey = "komari-lts-export-retention";

export function HistoryExportCard() {
  const { t } = useTranslation();
  const { nodeList } = useNodeList();

  const [category, setCategory] = React.useState<ExportCategory>("resource");
  const [uuid, setUUID] = React.useState("");
  const [retention, setRetention] = React.useState<RetentionInfo | null>(null);

  // Range mode: quick shortcut or custom date range
  const [rangeMode, setRangeMode] = React.useState<RangeMode>("quick");
  const [quickHours, setQuickHours] = React.useState<number | null>(null);
  const [customStart, setCustomStart] = React.useState("");
  const [customEnd, setCustomEnd] = React.useState("");

  const [job, setJob] = React.useState<ExportJob | null>(null);
  const [readyExports, setReadyExports] = React.useState<ExportJob[]>([]);
  const [selectedReadyID, setSelectedReadyID] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const refreshReadyExports = React.useCallback(async () => {
    try {
      const exports = await requestAdminData<ExportJob[]>(
        "/api/admin/history/export",
        "Failed to read generated exports",
      );
      setReadyExports(exports);
      setSelectedReadyID((current) =>
        current && exports.some((item) => item.id === current)
          ? current
          : (exports[0]?.id ?? ""),
      );
    } catch {
      // Keep the last successfully loaded list while the server is unavailable.
    }
  }, []);

  // Fetch retention once on mount
  React.useEffect(() => {
    const cached = window.sessionStorage.getItem(retentionStorageKey);
    if (cached) {
      try {
        setRetention(JSON.parse(cached) as RetentionInfo);
        return;
      } catch {
        // fall through to fetch
      }
    }
    void requestAdminData<RetentionInfo>(
      "/api/admin/history/export/retention",
      "Failed to read export retention",
    )
      .then((info) => {
        setRetention(info);
        window.sessionStorage.setItem(retentionStorageKey, JSON.stringify(info));
      })
      .catch(() => setRetention({ resource_hours: 720, ping_hours: 24 }));
  }, []);

  // When category or retention changes, reset quick selection to max.
  React.useEffect(() => {
    if (!retention) return;
    const maxHours = category === "latency"
      ? retention.ping_hours
      : category === "all"
        ? Math.min(retention.resource_hours, retention.ping_hours)
        : retention.resource_hours;
    setQuickHours(maxHours);
    setRangeMode("quick");
    setCustomStart("");
    setCustomEnd("");
  }, [category, retention]);

  React.useEffect(() => {
    void refreshReadyExports();
    const timer = window.setInterval(() => void refreshReadyExports(), 10_000);
    return () => window.clearInterval(timer);
  }, [refreshReadyExports]);

  React.useEffect(() => {
    if (!uuid && nodeList?.length) setUUID(nodeList[0].uuid);
  }, [nodeList, uuid]);

  // Resume a pending job from localStorage
  React.useEffect(() => {
    const saved = window.localStorage.getItem(exportStorageKey);
    if (!saved) return;
    void requestAdminData<ExportJob>(
      `/api/admin/history/export/${saved}`,
      t("settings.lts_database.export_status_error", "读取导出状态失败"),
    )
      .then(setJob)
      .catch(() => window.localStorage.removeItem(exportStorageKey));
  }, [t]);

  // Poll running jobs
  React.useEffect(() => {
    if (!job || (job.status !== "queued" && job.status !== "running")) return;
    const timer = window.setTimeout(() => {
      void requestAdminData<ExportJob>(
        `/api/admin/history/export/${job.id}`,
        t("settings.lts_database.export_status_error", "读取导出状态失败"),
      )
        .then((next) => {
          setJob(next);
          if (next.status === "done") void refreshReadyExports();
        })
        .catch((error) => toast.error(error instanceof Error ? error.message : String(error)));
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [job, refreshReadyExports, t]);

  const maxHours = retention
    ? category === "latency"
      ? retention.ping_hours
      : category === "all"
        ? Math.min(retention.resource_hours, retention.ping_hours)
        : retention.resource_hours
    : null;
  const ranges = maxHours ? buildRanges(maxHours) : [];

  const maxDatetime = isoToLocalInput(new Date().toISOString());
  const minDatetime = maxHours
    ? isoToLocalInput(new Date(Date.now() - maxHours * 3600_000).toISOString())
    : "";

  // Custom date handlers — selecting any date switches to custom mode
  const handleCustomStart = (v: string) => {
    setCustomStart(v);
    if (v) { setRangeMode("custom"); setQuickHours(null); }
  };
  const handleCustomEnd = (v: string) => {
    setCustomEnd(v);
    if (v) { setRangeMode("custom"); setQuickHours(null); }
  };

  // Quick shortcut handler — switches back to quick mode
  const handleQuickSelect = (h: number) => {
    setQuickHours(h);
    setRangeMode("quick");
    setCustomStart("");
    setCustomEnd("");
  };

  const canSubmit =
    !!uuid &&
    (rangeMode === "quick" ? !!quickHours : !!(customStart && customEnd));

  const startExport = async () => {
    if (!uuid) {
      toast.error(t("settings.lts_database.export_select_node", "请选择节点"));
      return;
    }
    setBusy(true);
    try {
      let body: Record<string, unknown>;
      if (rangeMode === "custom" && customStart && customEnd) {
        body = {
          category, uuid,
          start: localInputToRFC3339(customStart),
          end: localInputToRFC3339(customEnd),
        };
      } else {
        body = { category, uuid, hours: quickHours };
      }
      const next = await requestAdminData<ExportJob>(
        "/api/admin/history/export",
        t("settings.lts_database.export_start_error", "创建导出任务失败"),
        { method: "POST", body: JSON.stringify(body) },
      );
      setJob(next);
      window.localStorage.setItem(exportStorageKey, next.id);
      toast.success(t("settings.lts_database.export_started", "导出任务已开始"));
    } catch (error) {
      toast.error(t("settings.lts_database.export_start_error", "创建导出任务失败"), {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  const cancelExport = async () => {
    if (!job) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/history/export/${job.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setJob({ ...job, status: "cancelled" });
      window.localStorage.removeItem(exportStorageKey);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setJob(null);
    window.localStorage.removeItem(exportStorageKey);
  };

  const running = job?.status === "queued" || job?.status === "running";

  return (
    <SettingCard
      title={t("settings.lts_database.export_title", "导出历史数据")}
      description={t("settings.lts_database.export_description", "按节点和时间范围生成可取消的 CSV 导出任务。")}
    >
      <Flex direction="column" className="w-full pt-3" gap="3">
        {!job ? (
          <>
            {/* Category + node selectors */}
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              <Select.Root value={category} onValueChange={(v) => setCategory(v as ExportCategory)}>
                <Select.Trigger aria-label={t("settings.lts_database.export_type", "导出类型")} />
                <Select.Content>
                  <Select.Item value="resource">{t("settings.lts_database.export_resources", "资源")}</Select.Item>
                  <Select.Item value="network">{t("settings.lts_database.export_network", "网络")}</Select.Item>
                  <Select.Item value="latency">{t("settings.lts_database.export_latency", "延迟")}</Select.Item>
                  <Select.Item value="all">{t("settings.lts_database.export_all", "全部")}</Select.Item>
                </Select.Content>
              </Select.Root>
              <Select.Root value={uuid} onValueChange={setUUID}>
                <Select.Trigger placeholder={t("settings.lts_database.export_select_node", "请选择节点")} />
                <Select.Content>
                  {(nodeList ?? []).map((node) => (
                    <Select.Item key={node.uuid} value={node.uuid}>{node.name}</Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </div>

            {/* Quick shortcuts */}
            <div>
              <Text as="div" size="1" color="gray" mb="1">
                {t("settings.lts_database.export_range", "时间范围")}
              </Text>
              <Flex wrap="wrap" gap="1">
                {ranges.map((r) => (
                  <Button
                    key={r.hours}
                    size="1"
                    variant={rangeMode === "quick" && quickHours === r.hours ? "solid" : "soft"}
                    disabled={rangeMode === "custom"}
                    onClick={() => handleQuickSelect(r.hours)}
                  >
                    {r.label}
                  </Button>
                ))}
              </Flex>
            </div>

            {/* Custom date range */}
            <div>
              <Text as="div" size="1" color="gray" mb="1">
                {t("settings.lts_database.export_custom_range", "自定义范围")}
              </Text>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                <TextField.Root
                  type="datetime-local"
                  value={customStart}
                  min={minDatetime}
                  max={customEnd || maxDatetime}
                  onChange={(e) => handleCustomStart(e.target.value)}
                  placeholder={t("settings.lts_database.export_custom_start", "开始时间")}
                />
                <TextField.Root
                  type="datetime-local"
                  value={customEnd}
                  min={customStart || minDatetime}
                  max={maxDatetime}
                  onChange={(e) => handleCustomEnd(e.target.value)}
                  placeholder={t("settings.lts_database.export_custom_end", "结束时间")}
                />
              </div>
              {rangeMode === "custom" && (
                <Button
                  size="1"
                  variant="ghost"
                  color="gray"
                  mt="1"
                  onClick={() => {
                    setCustomStart("");
                    setCustomEnd("");
                    setRangeMode("quick");
                    if (maxHours) setQuickHours(maxHours);
                  }}
                >
                  <X size={12} />
                  {t("settings.lts_database.export_clear_custom", "清除自定义范围")}
                </Button>
              )}
            </div>

            <Flex justify="end">
              <Button disabled={busy || !canSubmit} onClick={() => void startExport()}>
                <FileDown size={16} />
                {t("settings.lts_database.export_generate", "生成 CSV")}
              </Button>
            </Flex>
          </>
        ) : (
          <>
            <Flex justify="between" align="center" gap="3" wrap="wrap">
              <div>
                <Text as="div" size="2" weight="medium">
                  {t(`settings.lts_database.export_${job.category ?? job.type}`, job.category ?? job.type)}
                </Text>
                <Text as="div" size="1" color="gray">
                  {new Date(job.start).toLocaleString()} – {new Date(job.end).toLocaleString()}
                </Text>
              </div>
              <Text size="2">{t(`settings.lts_database.export_status_${job.status}`, job.status)}</Text>
            </Flex>
            {running ? <Progress value={job.progress} /> : null}
            {job.error ? <Text size="2" color="red">{job.error}</Text> : null}
            <Flex justify="end" gap="2">
              {running ? (
                <Button color="red" variant="soft" disabled={busy} onClick={() => void cancelExport()}>
                  <X size={16} />
                  {t("common.cancel")}
                </Button>
              ) : job.status === "done" ? (
                <Button asChild>
                  <a href={`/api/admin/history/export/${job.id}/download`}>
                    <Download size={16} />
                    {t("settings.lts_database.export_download", "下载")}
                  </a>
                </Button>
              ) : null}
              {!running ? (
                <Button variant="soft" onClick={reset}>
                  <RotateCcw size={16} />
                  {t("settings.lts_database.export_new", "新建导出")}
                </Button>
              ) : null}
            </Flex>
          </>
        )}

        <div className="border-t border-gray-6 pt-3">
          <Text as="div" size="2" weight="medium" mb="2">
            {t("settings.lts_database.export_ready", "可直接下载的数据")}
          </Text>
          <Flex gap="2" align="center" wrap="wrap">
            <div className="min-w-0 flex-1">
              <Select.Root
                value={selectedReadyID}
                onValueChange={setSelectedReadyID}
                disabled={readyExports.length === 0}
              >
                <Select.Trigger
                  className="w-full"
                  placeholder={t("settings.lts_database.export_ready_empty", "暂无可下载数据")}
                />
                <Select.Content>
                  {readyExports.map((item) => (
                    <Select.Item key={item.id} value={item.id}>
                      {item.node_name} - {new Date(item.start).toLocaleString()} ~ {new Date(item.end).toLocaleString()} - {t(
                        `settings.lts_database.export_${item.category ?? item.type}`,
                        item.category ?? item.type,
                      )} - {new Date(item.created_at).toLocaleString()}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </div>
            {selectedReadyID ? (
              <Button asChild>
                <a href={`/api/admin/history/export/${selectedReadyID}/download`}>
                  <Download size={16} />
                  {t("settings.lts_database.export_download", "下载")}
                </a>
              </Button>
            ) : (
              <Button disabled>
                <Download size={16} />
                {t("settings.lts_database.export_download", "下载")}
              </Button>
            )}
          </Flex>
          <Text as="div" size="1" color="gray" mt="1">
            {t("settings.lts_database.export_ready_ttl", "生成文件保留 48 小时，列表会自动更新。")}
          </Text>
        </div>
      </Flex>
    </SettingCard>
  );
}
