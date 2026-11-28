import { useState } from "react";
import { Badge, Button } from "@radix-ui/themes";
import type { TrafficEvidenceCoverage, TrafficEvidenceHour } from "@komari/proto/komari/metrics/v1/metrics_pb";
import { useTranslation } from "react-i18next";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { NodeBasicInfo } from "@/contexts/NodeListContext";
import { formatTrafficGB } from "@/utils/trafficDisplay";
import { attributedBytes, evidenceByteLabel, evidenceBytes, HOUR, hourBuckets, hourStart, observedTotals, todayBucketStart } from "@/utils/trafficEvidence";

export function CoverageDetails({ coverage, latest = false }: { coverage: TrafficEvidenceCoverage; latest?: boolean }) {
  const { t, i18n } = useTranslation();
  const label = (n: bigint) => evidenceByteLabel(n, i18n.resolvedLanguage ?? "en");
  const issues = latest ? coverage.latestIssues : coverage.issues;
  return (
    <details className="whitespace-normal" title={issues.map((issue) => t(`trafficEvidence.issues.${issue}`, { defaultValue: issue })).join(" · ")}>
      <summary className="cursor-pointer underline decoration-dotted">{t(`trafficEvidence.scope.${coverage.observationScope}`, { defaultValue: coverage.observationScope })}</summary>
      <div className="space-y-1">
        {issues.map((issue) => <div key={issue}>{t(`trafficEvidence.issues.${issue}`, { defaultValue: issue })}</div>)}
        {!!coverage.unmatchedIpBytes && <div>{t("trafficEvidence.unmatched", { value: label(coverage.unmatchedIpBytes) })}</div>}
        {!!coverage.invalidIpBytes && <div>{t("trafficEvidence.invalid", { value: label(coverage.invalidIpBytes) })}</div>}
      </div>
    </details>
  );
}

type View = "total" | "rx" | "tx";

export function TrafficHourPanel({ rows, now, count, node }: { rows: TrafficEvidenceHour[]; now: number; count: number; node: NodeBasicInfo }) {
  const { t, i18n } = useTranslation();
  const [view, setView] = useState<View>("total");
  const locale = i18n.resolvedLanguage ?? "en";
  const label = (n: bigint) => evidenceByteLabel(n, locale);
  const time = (n: number) => new Date(n * 1_000).toLocaleString(locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "shortOffset" });
  const current = hourStart(now);
  const chart = hourBuckets(rows, now, 24);
  const range = hourBuckets(rows, now, count);
  const available = range.flatMap(({ row }) => row ? [row] : []);
  const chartRows = chart.flatMap(({ row }) => row ? [row] : []);
  const { firstFull, omittedEdge } = todayBucketStart(now);
  const today = available.filter((row) => Number(row.hourUtc?.seconds) >= firstFull);
  const currentRow = chart[chart.length - 1].row;
  const maxBytes = chartRows.reduce((max, row) => evidenceBytes(row)[view] > max ? evidenceBytes(row)[view] : max, 1n);
  const account = node.trafficAccounting;
  const billing = account?.cycleAvailable && Number.isFinite(account.billable)
    ? node.traffic_limit - account.billable : undefined;
  const cards = [
    { title: t("trafficEvidence.liveHour"), value: currentRow ? label(evidenceBytes(currentRow).total) : "—",
      note: currentRow?.through ? t("trafficEvidence.observedUntil", { value: time(Number(currentRow.through.seconds)) }) : t("trafficEvidence.noLive") },
    { title: t("trafficEvidence.today"), value: today.length ? label(observedTotals(today).total) : "—",
      note: t(omittedEdge ? "trafficEvidence.todayEdge" : "trafficEvidence.observedOnly") },
    { title: t("trafficEvidence.window24"), value: chartRows.length ? label(observedTotals(chartRows).total) : "—",
      note: t("trafficEvidence.recordedBuckets", { n: chartRows.length, total: 24 }) },
    { title: t("trafficEvidence.billing"), value: node.traffic_limit <= 0 ? t("trafficEvidence.unlimited")
      : billing == null ? "—" : billing < 0 ? t("trafficEvidence.overQuota", { value: formatTrafficGB(-billing) }) : formatTrafficGB(billing),
      note: t("trafficEvidence.billingNote", { rule: account?.countingType || node.traffic_limit_type || "—" }) },
  ];
  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => <div key={card.title} className="rounded-lg border p-3">
          <div className="text-sm text-muted-foreground">{card.title}</div>
          <div className="text-xl font-semibold tabular-nums">{card.value}</div>
          <div className="text-xs text-muted-foreground">{card.note}</div>
        </div>)}
      </div>
      <section className="space-y-2 rounded-lg border p-3" aria-label={t("trafficEvidence.chart")}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-medium">{t("trafficEvidence.chart")}</h3>
          <div className="flex gap-1">
            {(["total", "rx", "tx"] as const).map((key) => <Button type="button" key={key} size="1" aria-pressed={view === key}
              variant={view === key ? "solid" : "soft"} onClick={() => setView(key)}>{t(`trafficEvidence.${key}`)}</Button>)}
          </div>
        </div>
        <div className="grid h-32 grid-cols-[repeat(24,minmax(0,1fr))] gap-1">
          {chart.map(({ start, row }) => {
            const value = evidenceBytes(row)[view];
            const known = row ? attributedBytes(row)?.[view] : undefined;
            const fraction = value === 0n ? 0 : Number(known ?? 0n) / Number(value) * 100;
            const tip = `${time(start)} · ${row ? label(value) : t("trafficEvidence.missing")}${known == null ? "" : ` · ${t("trafficEvidence.attributed")}: ${label(known)}`}`;
            return <div key={start} tabIndex={0} aria-label={tip} title={tip}
              className={`flex flex-col justify-end rounded-sm outline-offset-1 focus-visible:outline ${!row ? "border border-dashed border-[var(--gray-6)]" : ""} ${start === current ? "outline outline-[var(--accent-8)]" : ""}`}>
              {row && <div className={`overflow-hidden rounded-sm ${known == null ? "bg-[var(--gray-9)]" : "bg-[var(--blue-7)]"}`}
                style={{ height: `${Math.max(2, Number(value) / Number(maxBytes) * 100)}%` }}>
                <div className="bg-[var(--blue-10)]" style={{ height: `${fraction}%` }} />
              </div>}
            </div>;
          })}
        </div>
        <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground"><span>{time(chart[0].start)}</span><span>{time(current)}</span></div>
        <div className="flex flex-wrap gap-3 text-xs">
          <span className="text-[var(--blue-11)]">■ {t("trafficEvidence.attributed")}</span>
          <span className="text-[var(--blue-9)]">■ {t("trafficEvidence.unattributed")}</span>
          <span className="text-[var(--gray-11)]">■ {t("trafficEvidence.legacy")}</span>
          <span>□ {t("trafficEvidence.missing")}</span>
        </div>
      </section>
      {!available.length ? <p className="rounded-lg border p-4 text-sm">{t("trafficEvidence.noHours")}</p> : <Table>
        <TableHeader><TableRow>{["period", "coverage", "service", "rx", "tx", "total"].map((name) =>
          <TableHead key={name}>{t(`trafficEvidence.${name}`)}</TableHead>)}</TableRow></TableHeader>
        <TableBody>
          {range.slice().reverse().map(({ start, row }) => {
            if (!row) return null;
            const observed = evidenceBytes(row);
            const assigned = attributedBytes(row);
            const coverage = row.coverage;
            const elapsed = start === current ? Math.max(0, Math.min(HOUR, Number(row.through?.seconds ?? 0n) - start)) : HOUR;
            const gap = coverage ? Math.max(0, elapsed - coverage.coveredSeconds) : undefined;
            const sources = Object.entries(row.attributedServices);
            const percent = (value: bigint) => observed.total > 0n ? Number(value * 1_000n / observed.total) / 10 : 0;
            const format = (n: bigint) => <span title={`${n.toLocaleString(locale)} B`}>{label(n)}</span>;
            return <TableRow key={start}>
              <TableCell>{time(start)} – {time(start + HOUR)} {start === current && <Badge color="blue">{t("trafficEvidence.collecting")}</Badge>}</TableCell>
              <TableCell>{coverage ? <div>
                <Badge color={gap || row.partial ? "amber" : "green"}>{t("trafficEvidence.coveredSeconds", { got: coverage.coveredSeconds, total: elapsed })}</Badge>
                <CoverageDetails coverage={coverage} />
              </div> : <Badge color={row.partial ? "amber" : "gray"}>{t(row.partial ? "trafficEvidence.legacyPartial" : "trafficEvidence.legacy")}</Badge>}</TableCell>
              <TableCell>
                {assigned ? (!observed.total ? "—" : [
                  ...sources.map(([key, n]) => `${t(`trafficEvidence.groups.${key}`, { defaultValue: key })} ${percent(n.rxBytes + n.txBytes)}%`),
                  `${t("trafficEvidence.unattributed")} ${percent(observed.total - assigned.total)}%`,
                ].join(" · ")) : t("trafficEvidence.legacy")}
                {!!Object.keys(row.services).length && <details><summary className="cursor-pointer">{t("trafficEvidence.rawCounters")}</summary>
                  {Object.entries(row.services).map(([key, n]) => <div key={key}>{t(`trafficEvidence.groups.${key}`, { defaultValue: key })} · ↓ {format(n.rxBytes)} · ↑ {format(n.txBytes)}</div>)}
                </details>}
              </TableCell>
              <TableCell>{format(observed.rx)}</TableCell><TableCell>{format(observed.tx)}</TableCell><TableCell>{format(observed.total)}</TableCell>
            </TableRow>;
          })}
        </TableBody>
        <TableFooter><TableRow><TableCell colSpan={3}>{t("trafficEvidence.observedOnly")} · {t("trafficEvidence.recordedBuckets", { n: available.length, total: count })}</TableCell>
          {(["rx", "tx", "total"] as const).map((key) => <TableCell key={key}>{label(observedTotals(available)[key])}</TableCell>)}
        </TableRow></TableFooter>
      </Table>}
    </div>
  );
}
