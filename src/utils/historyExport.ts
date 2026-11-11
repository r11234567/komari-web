export type ExportMode = "summary" | "raw" | "sample30s";
export type ExportJob = {
  id: string; owner: string; uuid: string; node_name: string; category: string;
  mode: ExportMode; format_version: number; status: string; phase: string;
  progress_kind: string; phase_completed: number; phase_total: number;
  decoded_records: number; written_rows: number; output_bytes: number;
  completed_input_bytes: number; confirmed_checkpoint: number;
  created_at: string; start: string; end: string; ready_at?: string;
  expires_at?: string; last_heartbeat_at: string; last_progress_at: string;
  wait_reason?: string; error?: string; filename?: string; sha256?: string;

  retry_at?: string;
  cpu_core_limit: number; cpu_share_limit: number; snapshot_id?: string;
  phase_started_at?: string; phase_active_seconds?: number;
  waiting_since?: string; wait_seconds?: number; current_wait_seconds?: number;
  throughput?: { at: string; window_seconds: number; rows_per_second: number; output_bytes_per_second: number; decoded_records_per_second: number };
  phase_eta?: { state: string; scope: string; reason?: string; low_seconds?: number; high_seconds?: number };
  current_input?: { index: number; total: number; kind: string };
  resources?: { scope: string; at: string; sample_seconds: number; cpu_share?: number; effective_cpus: number; cpu_throttled_seconds: number; memory_current_bytes: number; io_budget_waiting: boolean; io_budget_wait_seconds: number };
};
export function phaseETAMinutes(job: ExportJob): [number, number] | undefined {
  const eta = job.phase_eta;
  if (!["running", "publishing"].includes(job.status) || eta?.state !== "stable" || eta.scope !== "phase" ||
      !Number.isFinite(eta.low_seconds) || !Number.isFinite(eta.high_seconds) ||
      (eta.low_seconds ?? 0) <= 0 || (eta.high_seconds ?? 0) < (eta.low_seconds ?? 0)) return undefined;
  return [Math.max(1, Math.floor(eta.low_seconds! / 60)), Math.max(1, Math.ceil(eta.high_seconds! / 60))];
}
export function phaseProgress(job: ExportJob): number | undefined {
  if (job.status === "done") return 100;
  if (!Number.isFinite(job.phase_total) || job.phase_total <= 0 ||
      !Number.isFinite(job.phase_completed) || job.progress_kind === "indeterminate") return undefined;
  return Math.min(100, Math.max(0, job.phase_completed / job.phase_total * 100));
}
export function exportPollDelay(visible: boolean, failures: number): number {
  return Math.min(60_000, (visible ? 5_000 : 30_000) * Math.pow(2, Math.min(3, Math.max(0, failures))));
}
export function exportActions(job: ExportJob): string[] {
  if (job.status === "failed") return ["retry", "cancel"];
  if (job.status === "paused") return ["resume", "cancel"];
  if (job.phase === "publishing" || job.status === "publishing") return [];
  if (["queued", "running", "recovering", "retry_wait"].includes(job.status)) return ["pause", "cancel"];
  return [];
}
