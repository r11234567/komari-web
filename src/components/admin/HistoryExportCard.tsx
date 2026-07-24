import { useNodeList } from "@/contexts/NodeListContext";
import { requestAdminData } from "@/lib/adminApi";
import { Button, Flex, Progress, Select, Text } from "@radix-ui/themes";
import { Download, FileDown, RotateCcw, X } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { SettingCard } from "./SettingCard";

type ExportType = "load" | "ping";
type ExportStatus = "queued" | "running" | "done" | "failed" | "cancelled";

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

/** Build a list of selectable hour values up to maxHours, using natural breakpoints. */
function buildRanges(maxHours: number): { hours: number; label: string }[] {
  const candidates = [
    { hours: 1, label: "1h" },
    { hours: 6, label: "6h" },
    { hours: 12, label: "12h" },
    { hours: 24, label: "1d" },
    { hours: 7 * 24, label: "7d" },
    { hours: 15 * 24, label: "15d" },
    { hours: 30 * 24, label: "30d" },
    { hours: 45 * 24, label: "45d" },
    { hours: 60 * 24, label: "60d" },
    { hours: 75 * 24, label: "75d" },
    { hours: 90 * 24, label: "90d" },
  ];
  const filtered = candidates.filter((r) => r.hours <= maxHours);
  // Always include the exact retention limit as the last option if it isn't already there.
  const last = filtered[filtered.length - 1];
  if (!last || last.hours !== maxHours) {
    const days = maxHours / 24;
    const label = Number.isInteger(days) ? `${days}d` : `${maxHours}h`;
    filtered.push({ hours: maxHours, label });
  }
  return filtered;
}

const exportStorageKey = "komari-lts-history-export-job";
const retentionStorageKey = "komari-lts-export-retention";

export function HistoryExportCard() {
  const { t } = useTranslation();
  const { nodeList } = useNodeList();
  const [type, setType] = React.useState<ExportType>("load");
  const [uuid, setUUID] = React.useState("");
  const [hours, setHours] = React.useState<number | null>(null);
  const [retention, setRetention] = React.useState<RetentionInfo | null>(null);
  const [job, setJob] = React.useState<ExportJob | null>(null);
  const [busy, setBusy] = React.useState(false);

  // Fetch retention info once on mount.
  React.useEffect(() => {
    const cached = window.sessionStorage.getItem(retentionStorageKey);
    if (cached) {
      try {
        setRetention(JSON.parse(cached) as RetentionInfo);
        return;
      } catch {
        // ignore, fetch fresh
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
      .catch(() => {
        // Fall back to a sensible default so the UI remains usable.
        setRetention({ resource_hours: 720, ping_hours: 24 });
      });
  }, []);

  // When type or retention changes, reset hours to the maximum allowed value.
  React.useEffect(() => {
    if (!retention) return;
    const maxHours = type === "ping" ? retention.ping_hours : retention.resource_hours;
    setHours(maxHours);
  }, [type, retention]);

  React.useEffect(() => {
    if (!uuid && nodeList?.length) setUUID(nodeList[0].uuid);
  }, [nodeList, uuid]);

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

  React.useEffect(() => {
    if (!job || (job.status !== "queued" && job.status !== "running")) return;
    const timer = window.setTimeout(() => {
      void requestAdminData<ExportJob>(
        `/api/admin/history/export/${job.id}`,
        t("settings.lts_database.export_status_error"),
      )
        .then(setJob)
        .catch((error) => {
          toast.error(error instanceof Error ? error.message : String(error));
        });
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [job, t]);

  const maxHours = retention
    ? type === "ping"
      ? retention.ping_hours
      : retention.resource_hours
    : null;
  const ranges = maxHours ? buildRanges(maxHours) : [];

  const startExport = async () => {
    if (!uuid) {
      toast.error(t("settings.lts_database.export_select_node"));
      return;
    }
    if (!hours) return;
    setBusy(true);
    try {
      const next = await requestAdminData<ExportJob>(
        "/api/admin/history/export",
        t("settings.lts_database.export_start_error"),
        {
          method: "POST",
          body: JSON.stringify({ type, uuid, hours, max_points: 5000 }),
        },
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
            <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
              <Select.Root value={type} onValueChange={(value) => setType(value as ExportType)}>
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
              <Select.Root
                value={hours !== null ? String(hours) : ""}
                onValueChange={(value) => setHours(Number(value))}
                disabled={ranges.length === 0}
              >
                <Select.Trigger aria-label={t("settings.lts_database.export_range")} />
                <Select.Content>
                  {ranges.map((range) => (
                    <Select.Item key={range.hours} value={String(range.hours)}>
                      {range.label}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </div>
            <Flex justify="end">
              <Button disabled={busy || !uuid || !hours} onClick={() => void startExport()}>
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
                  {new Date(job.start).toLocaleString()} - {new Date(job.end).toLocaleString()}
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
