import { useNodeList } from "@/contexts/NodeListContext";
import { requestAdminData } from "@/lib/adminApi";
import { Input } from "@/components/ui/input";
import { Button, Flex, Progress, Select, Text } from "@radix-ui/themes";
import { Download, FileDown, RotateCcw, X } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { SettingCard } from "./SettingCard";

type ExportType = "load" | "ping";
type ExportStatus = "queued" | "running" | "done" | "failed" | "cancelled";
type RangeMode = "quick" | "custom";

type ExportJob = {
  id: string;
  type: ExportType;
  status: ExportStatus;
  progress: number;
  start: string;
  end: string;
  created_at: string;
  expires_at: string;
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

  const [type, setType] = React.useState<ExportType>("load");
  const [uuid, setUUID] = React.useState("");
  const [retention, setRetention] = React.useState<RetentionInfo | null>(null);

  // Range mode: quick shortcut or custom date range
  const [rangeMode, setRangeMode] = React.useState<RangeMode>("quick");
  const [quickHours, setQuickHours] = React.useState<number | null>(null);
  const [customStart, setCustomStart] = React.useState("");
  const [customEnd, setCustomEnd] = React.useState("");

  const [job, setJob] = React.useState<ExportJob | null>(null);
  const [busy, setBusy] = React.useState(false);

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

  // When type or retention changes, reset quick selection to max
  React.useEffect(() => {
    if (!retention) return;
    const maxHours = type === "ping" ? retention.ping_hours : retention.resource_hours;
    setQuickHours(maxHours);
    setRangeMode("quick");
    setCustomStart("");
    setCustomEnd("");
  }, [type, retention]);

  React.useEffect(() => {
    if (!uuid && nodeList?.length) setUUID(nodeList[0].uuid);
  }, [nodeList, uuid]);

  // Resume a pending job from localStorage
  React.useEffect(() => {
    const saved = window.localStorage.getItem(exportStorageKey);
    if (!saved) return;
    void requestAdminData<ExportJob>(
      `/api/admin/history/export/${saved}`,
      t("settings.lts_database.export_status_error"),
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
        t("settings.lts_database.export_status_error"),
      )
        .then(setJob)
        .catch((error) => toast.error(error instanceof Error ? error.message : String(error)));
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [job, t]);

  const maxHours = retention
    ? type === "ping" ? retention.ping_hours : retention.resource_hours
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
      toast.error(t("settings.lts_database.export_select_node"));
      return;
    }
    setBusy(true);
    try {
      let body: Record<string, unknown>;
      if (rangeMode === "custom" && customStart && customEnd) {
        body = {
          type, uuid,
          start: localInputToRFC3339(customStart),
          end: localInputToRFC3339(customEnd),
          max_points: 5000,
        };
      } else {
        body = { type, uuid, hours: quickHours, max_points: 5000 };
      }
      const next = await requestAdminData<ExportJob>(
        "/api/admin/history/export",
        t("settings.lts_database.export_start_error"),
        { method: "POST", body: JSON.stringify(body) },
      );
      setJob(next);
      window.localStorage.setItem(exportStorageKey, next.id);
      toast.success(t("settings.lts_database.export_started"));
    } catch (error) {
      toast.error(t("settings.lts_database.export_start_error"), {
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
      title={t("settings.lts_database.export_title")}
      description={t("settings.lts_database.export_description")}
    >
      <Flex direction="column" className="w-full pt-3" gap="3">
        {!job ? (
          <>
            {/* Type + node selectors */}
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              <Select.Root value={type} onValueChange={(v) => setType(v as ExportType)}>
                <Select.Trigger aria-label={t("settings.lts_database.export_type")} />
                <Select.Content>
                  <Select.Item value="load">{t("settings.lts_database.export_resources")}</Select.Item>
                  <Select.Item value="ping">Ping</Select.Item>
                </Select.Content>
              </Select.Root>
              <Select.Root value={uuid} onValueChange={setUUID}>
                <Select.Trigger placeholder={t("settings.lts_database.export_select_node")} />
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
                {t("settings.lts_database.export_range")}
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
                {t("settings.lts_database.export_custom_range")}
              </Text>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                <Input
                  type="datetime-local"
                  value={customStart}
                  min={minDatetime}
                  max={customEnd || maxDatetime}
                  disabled={rangeMode === "quick" && !!quickHours && !customStart && !customEnd ? false : false}
                  onChange={(e) => handleCustomStart(e.target.value)}
                  placeholder={t("settings.lts_database.export_custom_start")}
                />
                <Input
                  type="datetime-local"
                  value={customEnd}
                  min={customStart || minDatetime}
                  max={maxDatetime}
                  onChange={(e) => handleCustomEnd(e.target.value)}
                  placeholder={t("settings.lts_database.export_custom_end")}
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
                  {t("settings.lts_database.export_clear_custom")}
                </Button>
              )}
            </div>

            <Flex justify="end">
              <Button disabled={busy || !canSubmit} onClick={() => void startExport()}>
                <FileDown size={16} />
                {t("settings.lts_database.export_generate")}
              </Button>
            </Flex>
          </>
        ) : (
          <>
            <Flex justify="between" align="center" gap="3" wrap="wrap">
              <div>
                <Text as="div" size="2" weight="medium">
                  {job.type === "load" ? t("settings.lts_database.export_resources") : "Ping"}
                </Text>
                <Text as="div" size="1" color="gray">
                  {new Date(job.start).toLocaleString()} – {new Date(job.end).toLocaleString()}
                </Text>
              </div>
              <Text size="2">{t(`settings.lts_database.export_status_${job.status}`)}</Text>
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
                    {t("settings.lts_database.export_download")}
                  </a>
                </Button>
              ) : null}
              {!running ? (
                <Button variant="soft" onClick={reset}>
                  <RotateCcw size={16} />
                  {t("settings.lts_database.export_new")}
                </Button>
              ) : null}
            </Flex>
          </>
        )}
      </Flex>
    </SettingCard>
  );
}
