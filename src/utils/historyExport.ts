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
  cpu_core_limit: number; cpu_share_limit: number; snapshot_id?: string;
};
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
  if (job.status === "queued" || job.status === "running") return ["pause", "cancel"];
  return [];
}
