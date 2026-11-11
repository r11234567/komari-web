import { useAccount } from "@/contexts/AccountContext";
import { useNodeList } from "@/contexts/NodeListContext";
import { requestAdminData } from "@/lib/adminApi";
import { exportActions, exportPollDelay, phaseProgress, phaseETAMinutes, type ExportJob, type ExportMode } from "@/utils/historyExport";
import { Button, Flex, Progress, Select, Text, TextField } from "@radix-ui/themes";
import React from "react";
import { useTranslation } from "react-i18next";
import { SettingCard } from "./SettingCard";

type Retention = { resource_hours: number; ping_hours: number; worker_available: boolean; worker_error?: string; cpu_core_limit: number };
const modes: ExportMode[] = ["summary", "raw", "sample30s"];
const modeNames = { summary: "图表汇总 CSV", raw: "原始观测 CSV", sample30s: "30 秒采样 CSV（兼容）" };
const descriptions = {
  summary: "按图表相同计划导出统计桶，标注聚合算法、样本数、真实来源精度和缺口；不是原始观测。",
  raw: "逐条实际观测，保留原始时间、身份、标签、数值与单位。历史明细需要读取并解压冷归档，可能耗时 1–2 小时或更久。",
  sample30s: "每条序列每个 30 秒槽只取时间最早的实际样本；同槽其他观测不输出，不计算平均值。仍可能需要完整解压历史归档。",
};

function displayTime(value:string, fallback:string) { return value && !value.startsWith("0001-") ? value : fallback; }

export function HistoryExportCard() {
  const { t } = useTranslation(); const { account } = useAccount(); const { nodeList } = useNodeList();
  const [mode, setMode] = React.useState<ExportMode>("raw");
  const [category, setCategory] = React.useState("resource"); const [uuid, setUUID] = React.useState("");
  const [hours, setHours] = React.useState(24); const [start, setStart] = React.useState(""); const [end, setEnd] = React.useState("");
  const [aggregation, setAggregation] = React.useState("avg"); const [interval, setInterval] = React.useState(0);
  const [retention, setRetention] = React.useState<Retention | null>(null);
  const [jobs, setJobs] = React.useState<ExportJob[]>([]); const [error, setError] = React.useState(""); const [busy, setBusy] = React.useState(false);
  const [revision, refresh] = React.useReducer((n: number) => n + 1, 0);
  const owner = account?.logged_in ? account.uuid : "";

  React.useEffect(() => { if (!uuid && nodeList?.length) setUUID(nodeList[0].uuid); }, [nodeList, uuid]);
  React.useEffect(() => {
    let active = true; let failures = 0; let timer: ReturnType<typeof setTimeout>; setRetention(null);
    const loadCapabilities = async () => {
      try {
        const info = await requestAdminData<Retention>("/api/admin/history/export/retention", t("history_export.capability_error"));
        if (active) setRetention(info);
      } catch (e) {
        failures++;
        if (active) {
          setError(`${t("history_export.list_unavailable")}: ${e instanceof Error ? e.message : String(e)}`);
          timer = setTimeout(() => void loadCapabilities(), exportPollDelay(document.visibilityState === "visible", failures));
        }
      }
    };
    if (owner) void loadCapabilities();
    return () => { active = false; clearTimeout(timer); };
  }, [owner, revision, t]);
  React.useEffect(() => {
    let active = true; let timer: ReturnType<typeof setTimeout>; let failures = 0; let etag = "";
    setJobs([]); setError("");
    if (!owner) return () => { active = false; };
    const poll = async () => {
      try {
        const response = await fetch("/api/admin/history/export", { credentials: "same-origin", cache: "no-store", headers: etag ? { "If-None-Match": etag } : undefined });
        if (response.status === 401 || response.status === 403) { if (active) setJobs([]); throw new Error(t("history_export.list_forbidden")); }
        if (response.status !== 304) {
          if (!response.ok) throw new Error(`${t("history_export.list_unavailable")} (${response.status})`);
          const body = await response.json();
          etag = response.headers.get("ETag") ?? "";
          if (active) setJobs(body.data ?? []);
        }
        if (active) setError(""); failures = 0;
      } catch (e) { failures++; if (active) setError(`${t("history_export.list_unavailable")}: ${e instanceof Error ? e.message : String(e)}`); }
      if (active) timer = setTimeout(() => void poll(), exportPollDelay(document.visibilityState === "visible", failures));
    };
    void poll(); return () => { active = false; clearTimeout(timer); };
  }, [owner, revision, t]);

  const maxHours = retention ? category === "latency" ? retention.ping_hours : category === "all" ? Math.min(retention.resource_hours, retention.ping_hours) : retention.resource_hours : 24;
  const ranges = [1, 6, 12, 24, 168, 360]; for (let d = 30; d * 24 <= maxHours; d += 15) ranges.push(d * 24);
  if (!ranges.includes(maxHours)) ranges.push(maxHours);
  const create = async () => {
    setBusy(true); setError("");
    try {
      const range = start ? { start: new Date(start).toISOString(), end: end ? new Date(end).toISOString() : new Date().toISOString() } : { hours: Math.min(hours, maxHours) };
      await requestAdminData<ExportJob>("/api/admin/history/export", t("history_export.create_error"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ uuid, category, mode, format_version: 2, aggregation, interval_seconds: interval, ...range }) });
      refresh();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const control = async (id: string, action: string) => {
    setBusy(true); try {
      await requestAdminData(`/api/admin/history/export/${id}/${action}`, t("history_export.control_error"), { method: "POST" }); refresh();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  return <SettingCard title={t("settings.lts_database.background_exports", "后台导出任务")} description={t("settings.lts_database.background_exports_description", "关闭页面不影响任务；完成后返回任务列表下载。所有任务共享 CPU 硬上限，最多占实例有效算力的 10%。")}>
    <Flex direction="column" gap="3" className="w-full min-w-0 [overflow-wrap:anywhere]" data-testid="history-export-card">
      <Flex gap="3" wrap="wrap">
        <Select.Root value={uuid || undefined} onValueChange={setUUID}><Select.Trigger aria-label={t("history_export.node")} placeholder={t("history_export.select_node")} /><Select.Content>{nodeList?.map(n => <Select.Item key={n.uuid} value={n.uuid}>{n.name || n.uuid}</Select.Item>)}</Select.Content></Select.Root>
        <Select.Root value={category} onValueChange={setCategory}><Select.Trigger aria-label={t("history_export.category")} /><Select.Content>{["resource", "network", "latency", "all"].map(c => <Select.Item key={c} value={c}>{t(`settings.lts_database.export_${c}`, c)}</Select.Item>)}</Select.Content></Select.Root>
        <Select.Root value={mode} onValueChange={v => setMode(v as ExportMode)}><Select.Trigger aria-label={t("history_export.mode")} /><Select.Content>{modes.map(m => <Select.Item key={m} value={m}>{t(`settings.lts_database.export_mode_${m}`, modeNames[m])}</Select.Item>)}</Select.Content></Select.Root>
      </Flex>
      <Text size="2" color="gray">{t(`settings.lts_database.export_mode_${mode}_description`, descriptions[mode])}</Text>
      <Flex gap="2" wrap="wrap">{ranges.filter(h => h <= maxHours).map(h => <Button type="button" size="1" variant={!start && h === hours ? "solid" : "soft"} key={h} onClick={() => { setHours(h); setStart(""); setEnd(""); }}>{h < 24 ? `${h}h` : `${h / 24}d`}</Button>)}</Flex>
      <Flex gap="2" wrap="wrap"><Text as="label" size="2">{t("history_export.start")} <TextField.Root aria-label={t("history_export.start_time")} type="datetime-local" value={start} onChange={e => setStart(e.target.value)} /></Text><Text as="label" size="2">{t("history_export.end")} <TextField.Root aria-label={t("history_export.end_time")} type="datetime-local" value={end} onChange={e => setEnd(e.target.value)} /></Text></Flex>
      {mode === "summary" && <Flex gap="2" wrap="wrap"><Select.Root value={aggregation} onValueChange={setAggregation}><Select.Trigger aria-label={t("history_export.algorithm")} /><Select.Content>{["avg", "min", "max", "sum", "count", "p95", "stddev"].map(a => <Select.Item key={a} value={a}>{a}</Select.Item>)}</Select.Content></Select.Root><Text as="label" size="2">{t("history_export.interval")}<TextField.Root type="number" min={0} value={interval} onChange={e => setInterval(Number(e.target.value))} /></Text></Flex>}
      {retention && !retention.worker_available && <Text role="status" color="amber" size="2">{t("history_export.worker_unavailable", {reason: retention.worker_error})}</Text>}
      <Text size="2" color="gray">{t("history_export.snapshot_policy")}</Text>
      <Flex gap="2" wrap="wrap"><Button onClick={() => void create()} disabled={busy || !uuid || !owner || !retention?.worker_available} data-testid="create-background-export">{t("history_export.create")}</Button><Button variant="soft" onClick={refresh}>{t("history_export.refresh")}</Button></Flex>
      {error && <Text role="alert" color="red" size="2">{error}</Text>}
      <div aria-live="polite" data-testid="export-task-list">{jobs.filter(job => job.owner === owner).map(job => {
        const percent = phaseProgress(job);
        const eta = phaseETAMinutes(job);
        return <Flex key={job.id} direction="column" gap="2" className="rounded-md border p-3 mb-3" data-testid={`export-job-${job.id}`}>
          <Text weight="bold">{job.node_name} · {t(`settings.lts_database.export_mode_${job.mode}`,modeNames[job.mode])} · {t(`history_export.status.${job.status}`,job.status)} / {job.status === "recovering" ? t("history_export.validating_checkpoint") : t(`history_export.phase.${job.phase}`,job.phase)}</Text>
          <Text size="1" color="gray">{job.start} → {job.end} · {job.id} · v{job.format_version}</Text>
          {percent !== undefined && <><Progress value={percent} /><Text size="1">{job.status === "done" ? t("history_export.complete") : t("history_export.phase_progress", {done:job.phase_completed,total:job.phase_total,percent:percent.toFixed(1)})}</Text></>}
          {job.status === "recovering" && job.checkpoint_verification && <><Progress value={job.checkpoint_verification.total_bytes > 0 ? Math.min(100, job.checkpoint_verification.verified_bytes / job.checkpoint_verification.total_bytes * 100) : 0} /><Text size="2">{t("history_export.checkpoint_verification", {done:(job.checkpoint_verification.verified_bytes/1048576).toFixed(2),total:(job.checkpoint_verification.total_bytes/1048576).toFixed(2)})}</Text></>}
          {percent === undefined && !(job.status === "recovering" && job.checkpoint_verification) && <Text size="2">{t("history_export.unknown")}</Text>}
          <Text size="2">{t("history_export.counters", {decoded:job.decoded_records.toLocaleString(),rows:job.written_rows.toLocaleString(),size:(job.output_bytes / 1048576).toFixed(2),checkpoint:job.confirmed_checkpoint})}</Text>
          <Text size="1" color="gray">{t("history_export.heartbeat", {heartbeat:displayTime(job.last_heartbeat_at,t("history_export.waiting_worker")),progress:displayTime(job.last_progress_at,t("history_export.not_started")),cores:job.cpu_core_limit})}</Text>
          {job.phase_started_at && <Text size="1" color="gray">{t("history_export.phase_started", {at:displayTime(job.phase_started_at,""),seconds:Math.round(job.phase_active_seconds ?? 0)})}</Text>}
          {job.throughput && job.throughput.window_seconds > 0 && ["running","publishing"].includes(job.status) && <Text size="2">{t("history_export.throughput", {seconds:Math.round(job.throughput.window_seconds),rows:job.throughput.rows_per_second.toFixed(1),size:(job.throughput.output_bytes_per_second/1024).toFixed(1)})}</Text>}
          {eta && <Text size="2">{t("history_export.phase_eta", {low:eta[0],high:eta[1]})}</Text>}
          {!eta && !["done","expired","cancelled","failed"].includes(job.status) && <Text size="1" color="gray">{t("history_export.eta_unavailable")}</Text>}
          {job.current_input && <Text size="1" color="gray">{t("history_export.current_input", {index:job.current_input.index,total:job.current_input.total,kind:job.current_input.kind})}</Text>}
          {job.resources?.scope === "worker_group" && <Text size="1" color="gray">{t("history_export.resource_usage", {cpu:job.resources.cpu_share === undefined ? "—" : (job.resources.cpu_share*100).toFixed(2),memory:(job.resources.memory_current_bytes/1048576).toFixed(1),throttled:job.resources.cpu_throttled_seconds.toFixed(1),io:job.resources.io_budget_wait_seconds.toFixed(1)})}{job.resources.io_budget_waiting ? ` · ${t("history_export.io_budget_waiting")}` : ""}</Text>}
          {job.waiting_since && !job.waiting_since.startsWith("0001-") && <Text size="1" color="gray">{t("history_export.waiting_since", {at:displayTime(job.waiting_since,""),seconds:Math.round(job.current_wait_seconds ?? 0)})}</Text>}
          {job.wait_reason && <Text size="2" color="amber">{t("history_export.wait_reason", {reason:t(`history_export.wait.${job.wait_reason}`,job.wait_reason)})}</Text>}{job.error && <Text size="2" color="red">{job.error}</Text>}
          {job.status === "retry_wait" && job.retry_at && <Text size="2">{t("history_export.retry_at", {at:job.retry_at})}</Text>}
          <Flex gap="2" wrap="wrap">{exportActions(job).map(action => <Button key={action} size="1" variant="soft" disabled={busy} onClick={() => void control(job.id, action)}>{t(`history_export.${action}`)}</Button>)}{job.status === "done" && <Button asChild size="1"><a href={`/api/admin/history/export/${job.id}/download`}>{t("history_export.download", {mode:job.mode})}</a></Button>}</Flex>
          {job.status === "done" && <Text size="1" color="gray">{t("history_export.ready", {expires:job.expires_at,hash:job.sha256})}</Text>}
        </Flex>;
      })}</div>
    </Flex>
  </SettingCard>;
}
