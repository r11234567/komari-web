import type { TrafficEvidenceCoverage, TrafficEvidenceHour } from "@komari/proto/komari/metrics/v1/metrics_pb";

export const HOUR = 3_600;
export const FRESH_SECONDS = 60;
export const hourStart = (seconds: number) => Math.floor(seconds / HOUR) * HOUR;

export function hourBuckets(rows: TrafficEvidenceHour[], now: number, count: number) {
  const current = hourStart(now);
  const byStart = new Map(rows.map((row) => [Number(row.hourUtc?.seconds), row]));
  return Array.from({ length: count }, (_, i) => {
    const start = current - (count - 1 - i) * HOUR;
    return { start, row: byStart.get(start) };
  });
}

export function evidenceBytes(row?: TrafficEvidenceHour) {
  const rx = row?.observed?.rxBytes ?? 0n;
  const tx = row?.observed?.txBytes ?? 0n;
  return { rx, tx, total: rx + tx };
}

export function attributedBytes(row: TrafficEvidenceHour) {
  const observed = evidenceBytes(row);
  let rx = 0n, tx = 0n;
  for (const bytes of Object.values(row.attributedServices)) {
    rx += bytes.rxBytes;
    tx += bytes.txBytes;
  }
  if (!row.coverage || row.coverage.observationScope === "mixed" || rx > observed.rx || tx > observed.tx || rx < 0n || tx < 0n) return undefined;
  return { rx, tx, total: rx + tx };
}

export function observedTotals(rows: readonly TrafficEvidenceHour[]) {
  return rows.reduce((sum, row) => {
    const value = evidenceBytes(row);
    return { rx: sum.rx + value.rx, tx: sum.tx + value.tx, total: sum.total + value.total };
  }, { rx: 0n, tx: 0n, total: 0n });
}

export function coverageNeedsAttention(coverage?: TrafficEvidenceCoverage) {
  return coverage?.latestIssues.some((issue) =>
    ["sample_gap", "incomplete_slice", "invalid_ip", "collector_changed", "clock_overlap", "read_error"].includes(issue),
  ) ?? false;
}

export function evidenceFresh(through: number, received: number, now: number) {
  return through > 0 && received > 0 && through <= now && received <= now &&
    now - through <= FRESH_SECONDS && now - received <= FRESH_SECONDS;
}

export function evidenceByteLabel(count: bigint, locale: string) {
  const tiers = [
    [1_000_000_000_000n, "TB"], [1_000_000_000n, "GB"], [1_000_000n, "MB"], [1_000n, "kB"], [1n, "B"],
  ] as const;
  const [unit, name] = tiers.find(([factor]) => count >= factor) ?? tiers[4];
  return `${(Number(count) / Number(unit)).toLocaleString(locale, { maximumFractionDigits: 2 })} ${name}`;
}

export function todayBucketStart(now: number) {
  const midnight = new Date(now * 1_000);
  midnight.setHours(0, 0, 0, 0);
  const exact = midnight.getTime() / 1_000;
  const firstFull = Math.ceil(exact / HOUR) * HOUR;
  return { firstFull, omittedEdge: firstFull !== exact };
}
