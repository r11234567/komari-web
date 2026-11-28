import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Badge, Button, Callout, Dialog, Select, Tabs, TextField } from "@radix-ui/themes";
import { timestampDate, type Timestamp } from "@bufbuild/protobuf/wkt";
import type {
  TrafficEvidenceNode,
  TrafficEvidenceBytes,
  TrafficEvidenceIncident,
  TrafficEvidencePeer,
} from "@komari/proto/komari/metrics/v1/metrics_pb";
import { TrafficMonitoringState } from "@komari/proto/komari/report/v1/report_pb";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { connectUnary } from "@/api/connect/client";
import AdminPageTitle, { AdminSectionTitle } from "@/components/admin/AdminPageTitle";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useConnect } from "@/contexts/ConnectContext";
import { useNodeList, type NodeBasicInfo } from "@/contexts/NodeListContext";
import { CoverageDetails, TrafficHourPanel } from "@/components/admin/TrafficHourPanel";
import { useEvidencePoll } from "@/hooks/useEvidencePoll";
import { coverageNeedsAttention, evidenceByteLabel, evidenceFresh } from "@/utils/trafficEvidence";

function localTime(value: Timestamp | undefined, language: string) {
  return value ? timestampDate(value).toLocaleString(language) : "—";
}

function bytes(value: bigint | undefined, language: string) {
  const count = value ?? 0n;
  return <span className="tabular-nums" title={`${count.toLocaleString(language)} B`}>{evidenceByteLabel(count, language)}</span>;
}

function DirectionCells({ value }: { value: TrafficEvidenceBytes | undefined }) {
  const { i18n } = useTranslation();
  return <><TableCell>{bytes(value?.rxBytes, i18n.resolvedLanguage ?? "en")}</TableCell><TableCell>{bytes(value?.txBytes, i18n.resolvedLanguage ?? "en")}</TableCell></>;
}

function PeerTable({ label, peers, other }: { label: string; peers: TrafficEvidencePeer[]; other: bigint }) {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage ?? "en";
  return (
    <section className="min-w-0 space-y-2" aria-label={label}>
      <AdminSectionTitle>{label}</AdminSectionTitle>
      <Table>
        <TableHeader><TableRow><TableHead>{t("trafficEvidence.address")}</TableHead><TableHead>{t("trafficEvidence.bytes")}</TableHead></TableRow></TableHeader>
        <TableBody>
          {peers.map((peer) => <TableRow key={peer.ip}><TableCell className="break-all font-mono">{peer.ip}</TableCell><TableCell>{bytes(peer.bytes, language)}</TableCell></TableRow>)}
          {other > 0n && <TableRow><TableCell>{t("trafficEvidence.otherPeers")}</TableCell><TableCell>{bytes(other, language)}</TableCell></TableRow>}
          {!peers.length && other === 0n && <TableRow><TableCell colSpan={2}>{t("trafficEvidence.noPeers")}</TableCell></TableRow>}
        </TableBody>
      </Table>
    </section>
  );
}

function IncidentDetail({ agentId, selected, close, onRead }: { agentId: string; selected: TrafficEvidenceIncident; close: () => void; onRead: () => void }) {
  const { metrics } = useConnect();
  const { t, i18n } = useTranslation();
  const [state, setState] = useState<{ row?: TrafficEvidenceIncident; error?: boolean }>({});
  useEffect(() => {
    const controller = new AbortController();
    void connectUnary({ signal: controller.signal }, (signal, timeoutMs) =>
      metrics.getTrafficEvidenceIncident({ agentId, incidentId: selected.id }, { signal, timeoutMs }),
    ).then(
      async (result) => {
        if (controller.signal.aborted || !result.incident) return;
        setState({ row: result.incident });
        try {
          await connectUnary({ signal: controller.signal }, (signal, timeoutMs) =>
            metrics.markTrafficEvidenceRead({ agentId, incidentId: selected.id }, { signal, timeoutMs }),
          );
          if (!controller.signal.aborted) onRead();
        } catch {
          if (!controller.signal.aborted) setState({ row: result.incident, error: true });
        }
      },
      () => { if (!controller.signal.aborted) setState({ error: true }); },
    );
    return () => controller.abort();
  }, [agentId, metrics, onRead, selected.id]);
  const language = i18n.resolvedLanguage ?? "en";
  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) close(); }}>
      <Dialog.Content maxWidth="54rem">
        <Dialog.Title>{t("trafficEvidence.detail")}</Dialog.Title>
        <Dialog.Description size="2" className="mb-4">
          {t(`trafficEvidence.reasons.${selected.reason}`, { defaultValue: selected.reason })} · {selected.interfaceName} · {selected.sampler}
          <br />
          {localTime(selected.start, language)} – {localTime(selected.end, language)}
        </Dialog.Description>
        {state.error && <Callout.Root color="red"><Callout.Text>{t(state.row ? "trafficEvidence.readError" : "trafficEvidence.detailError")}</Callout.Text></Callout.Root>}
        {!state.error && !state.row && <p role="status">{t("trafficEvidence.loading")}</p>}
        {state.row && (
          <>
            <p className="mb-4 text-sm text-muted-foreground">{t("trafficEvidence.observation")}</p>
            <div className="grid gap-6 md:grid-cols-2">
              <PeerTable label={t("trafficEvidence.ingressSources")} peers={state.row.ingressSources} other={state.row.other?.rxBytes ?? 0n} />
              <PeerTable label={t("trafficEvidence.egressDestinations")} peers={state.row.egressDestinations} other={state.row.other?.txBytes ?? 0n} />
            </div>
          </>
        )}
        <div className="mt-4 flex justify-end"><Button variant="soft" onClick={close}>{t("trafficEvidence.close")}</Button></div>
      </Dialog.Content>
    </Dialog.Root>
  );
}

const monitorStates: Partial<Record<TrafficMonitoringState, string>> = {
  [TrafficMonitoringState.DISABLED]: "disabled",
  [TrafficMonitoringState.REQUIRES_ROOT]: "requiresRoot",
  [TrafficMonitoringState.STARTING]: "starting",
  [TrafficMonitoringState.RUNNING]: "running",
  [TrafficMonitoringState.NO_DEFAULT_INTERFACE]: "noInterface",
  [TrafficMonitoringState.CAPTURE_UNAVAILABLE]: "captureUnavailable",
  [TrafficMonitoringState.MANUAL]: "manual",
};

function NodeEvidence({ node, selector, onRead }: { node: NodeBasicInfo; selector: ReactNode; onRead: () => void }) {
  const { metrics } = useConnect();
  const { t, i18n } = useTranslation();
  const [range, setRange] = useState(24);
  const [selected, setSelected] = useState<TrafficEvidenceIncident>();
  const language = i18n.resolvedLanguage ?? "en";
  const agentId = node.uuid;
  const load = useCallback((signal: AbortSignal) => connectUnary({ signal }, (signal, timeoutMs) =>
    metrics.listTrafficEvidence({ agentId, hourLimit: Math.max(range, 26) }, { signal, timeoutMs }),
  ), [agentId, metrics, range]);
  const state = useEvidencePoll(load);
  const refresh = state.refresh;
  const refreshRead = useCallback(() => { refresh(); onRead(); }, [onRead, refresh]);
  const data = state.data;
  const now = Math.floor(Date.now() / 1_000);
  const latest = data?.hours[0];
  const coverage = latest?.coverage;
  const maxBuckets = data?.hourRetentionDays ? data.hourRetentionDays * 24 : 168;
  const fresh = !state.error && evidenceFresh(Number(latest?.through?.seconds ?? 0n), Number(data?.lastReportedAt?.seconds ?? 0n), now);
  const monitorState = data?.monitoring?.state ?? TrafficMonitoringState.UNSPECIFIED;
  const status = !data?.agentOnline ? "offline"
    : data.monitoringEnabled && monitorState === TrafficMonitoringState.DISABLED ? "starting"
      : monitorStates[monitorState] ?? "upgrade";

  return (
    <>
      <div className="flex min-w-0 flex-wrap items-end justify-between gap-3">
        {selector}
        <Button variant="soft" onClick={refresh}>{t("trafficEvidence.refresh")}</Button>
      </div>
      {data && <div className="flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm" role="status">
        <Badge color={status === "captureUnavailable" || status === "noInterface" ? "amber" : "gray"}>
          {t(`trafficEvidence.monitor.${status}`)}
        </Badge>
        <span className="font-mono">{coverage?.sampler} {data.monitoring?.interfaceName || coverage?.interfaceName}</span>
        <Badge color={fresh && coverage && !coverageNeedsAttention(coverage) ? "green" : "amber"}>
          {t(!coverage ? "trafficEvidence.qualityUnknown" : !fresh ? "trafficEvidence.stale" : coverageNeedsAttention(coverage) ? "trafficEvidence.degraded" : "trafficEvidence.fresh")}
        </Badge>
        <span>{t("trafficEvidence.observedUntil", { value: localTime(latest?.through, language) })}</span>
        <span>{t("trafficEvidence.receivedAt", { value: localTime(data.lastReportedAt, language) })}</span>
        {coverage && <>
          <span>{t(!coverage.attributionSources.length ? "trafficEvidence.noAttribution" : coverage.latestIssues.includes("attribution_unavailable") ? "trafficEvidence.attributionFailed" : "trafficEvidence.attributionConfigured")}
            {!!coverage.attributionSources.length && `: ${coverage.attributionSources.map((source) => t(`trafficEvidence.groups.${source}`, { defaultValue: source })).join(", ")}`}
          </span>
          <CoverageDetails coverage={coverage} latest />
        </>}
        <Link to="/admin/servers" className="underline">{t("trafficEvidence.monitor.configure")}</Link>
        <Link to="/admin/settings/metrics#traffic-monitoring-storage" className="underline">{t("trafficEvidence.retentionLink")}</Link>
      </div>}
      {state.error && <Callout.Root color="red"><Callout.Text>{t("trafficEvidence.loadError")}</Callout.Text></Callout.Root>}
      {!state.error && !state.data && <p role="status">{t("trafficEvidence.loading")}</p>}
      {data && (
        <Tabs.Root defaultValue="hours" className="min-w-0 space-y-4">
          <Tabs.List><Tabs.Trigger value="hours">{t("trafficEvidence.hours")}</Tabs.Trigger><Tabs.Trigger value="incidents">
            {t("trafficEvidence.incidents")} {data.hourRetentionDays > 0 && <Badge className="ml-2">{t(data.incidentRetentionHours < 72 ? "trafficEvidence.incidentBadgeLimited" : "trafficEvidence.incidentBadge", { unread: data.unreadIncidentsIn72Hours, total: data.incidentsIn72Hours, hours: data.incidentRetentionHours })}</Badge>}
          </Tabs.Trigger></Tabs.List>
          <Tabs.Content value="incidents">
            {data.incidents.length === 0 ? <p className="rounded-lg border p-4 text-sm">{t("trafficEvidence.noIncidents")}</p> : <Table>
              <TableHeader>
                <TableRow><TableHead>{t("trafficEvidence.triggerTime")}</TableHead><TableHead>{t("trafficEvidence.reason")}</TableHead><TableHead>{t("trafficEvidence.rx")}</TableHead><TableHead>{t("trafficEvidence.tx")}</TableHead><TableHead>{t("trafficEvidence.status")}</TableHead><TableHead>{t("trafficEvidence.detail")}</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {data.incidents.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell>{localTime(event.triggeredAt, language)}</TableCell>
                    <TableCell>{t(`trafficEvidence.reasons.${event.reason}`, { defaultValue: event.reason })} {!event.read && data.hourRetentionDays > 0 && <Badge>{t("trafficEvidence.unread")}</Badge>}</TableCell>
                    <DirectionCells value={event.observed} />
                    <TableCell><Badge color={!event.complete ? "blue" : event.partial ? "amber" : "green"}>
                      {t(!event.complete ? "trafficEvidence.collecting" : event.partial ? "trafficEvidence.partial" : "trafficEvidence.complete")}
                    </Badge></TableCell>
                    <TableCell><Button variant="ghost" onClick={() => setSelected(event)}>{t("trafficEvidence.view")}</Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>}
          </Tabs.Content>
          <Tabs.Content value="hours">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              {[24, ...(maxBuckets >= 168 ? [168] : []), ...(maxBuckets > 168 ? [maxBuckets] : [])].map((hours) => <Button key={hours} aria-pressed={range === hours} variant={range === hours ? "solid" : "soft"}
                onClick={() => setRange(hours)}>{t(hours === 24 ? "trafficEvidence.window24" : hours === 168 ? "trafficEvidence.window7d" : "trafficEvidence.windowRetained", { days: hours / 24 })}</Button>)}
              {data.hourRetentionDays > 0 && <span className="text-sm text-muted-foreground">{t("trafficEvidence.retentionInfo", { days: data.hourRetentionDays, hours: data.incidentRetentionHours })}</span>}
            </div>
            <TrafficHourPanel rows={data.hours} now={now} count={Math.min(range, maxBuckets)} node={node} />
          </Tabs.Content>
        </Tabs.Root>
      )}
      {selected && <IncidentDetail key={selected.id} agentId={agentId} selected={selected} close={() => setSelected(undefined)} onRead={refreshRead} />}
    </>
  );
}

export default function TrafficEvidencePage() {
  const { t } = useTranslation();
  const { nodeList } = useNodeList();
  const { metrics } = useConnect();
  const [selection, setSelection] = useState("");
  const [search, setSearch] = useState("");
  const load = useCallback((signal: AbortSignal) => connectUnary({ signal }, (signal, timeoutMs) =>
    metrics.getTrafficEvidenceOverview({}, { signal, timeoutMs }),
  ), [metrics]);
  const overview = useEvidencePoll(load, 15_000);
  const node = nodeList?.find((row) => row.uuid === selection) ?? nodeList?.[0];
  const now = Math.floor(Date.now() / 1_000);
  const nodes = overview.data?.nodes ?? [];
  const byId = new Map(nodes.map((row) => [row.agentId, row]));
  const enabled = (row: TrafficEvidenceNode) => row.monitoringEnabled || row.monitoring?.state === TrafficMonitoringState.MANUAL ||
    row.monitoring?.state === TrafficMonitoringState.RUNNING;
  const health = (row: TrafficEvidenceNode) => row.agentOnline && !!row.coverage &&
    (row.monitoring?.state === TrafficMonitoringState.RUNNING || row.monitoring?.state === TrafficMonitoringState.MANUAL) &&
    (!row.monitoring?.interfaceName || row.monitoring.interfaceName === row.coverage.interfaceName) &&
    evidenceFresh(Number(row.dataThrough?.seconds ?? 0n), Number(row.lastReportedAt?.seconds ?? 0n), now) &&
    !coverageNeedsAttention(row.coverage);
  const alerts = nodeList?.filter((item) => (byId.get(item.uuid)?.unreadIncidentsIn72Hours ?? 0) > 0) ?? [];
  function nextAlert() {
    if (!alerts.length) return;
    const next = (alerts.findIndex((item) => item.uuid === node?.uuid) + 1) % alerts.length;
    setSearch("");
    setSelection(alerts[next].uuid);
  }
  return (
    <div className="mx-auto w-full min-w-0 max-w-6xl space-y-4">
      <AdminPageTitle description={t("trafficEvidence.description")}>{t("trafficEvidence.title")}</AdminPageTitle>
      {overview.error && <p role="status" className="text-sm text-muted-foreground">{t("trafficEvidence.overviewUnavailable")}</p>}
      {overview.data && <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4" aria-label={t("trafficEvidence.overview")}>
        {[
          ["enabledNodes", nodes.filter(enabled).length],
          ["healthyNodes", nodes.filter((row) => enabled(row) && health(row)).length],
          ["degradedNodes", nodes.filter((row) => enabled(row) && !health(row)).length],
          ["alertNodes", nodes.filter((row) => row.incidentsIn72Hours > 0).length],
        ].map(([key, count]) => <div key={key} className="rounded-lg border p-3">
          <div className="text-sm text-muted-foreground">{t(`trafficEvidence.${key}`)}</div>
          <div className="text-xl font-semibold">{count}</div>
          {key === "alertNodes" && <div className="text-xs text-muted-foreground">{t("trafficEvidence.unreadNodes", { n: nodes.filter((row) => row.unreadIncidentsIn72Hours > 0).length })}</div>}
        </div>)}
      </div>}
      {node ? (
        <NodeEvidence key={node.uuid} node={node} onRead={overview.refresh} selector={<div className="flex min-w-0 flex-1 flex-col gap-1 sm:max-w-sm">
          <span className="text-sm font-medium">{t("trafficEvidence.node")}</span>
          <TextField.Root type="search" value={search} onChange={(event) => setSearch(event.target.value)}
            aria-label={t("trafficEvidence.searchNodes")} placeholder={t("trafficEvidence.searchNodes")} />
          <Select.Root value={node.uuid} onValueChange={setSelection}>
            <Select.Trigger className="w-full min-w-0" aria-label={t("trafficEvidence.node")} />
            <Select.Content>{nodeList?.filter((item) => item.uuid === node.uuid || item.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())).map((item) => {
              const row = byId.get(item.uuid);
              return <Select.Item key={item.uuid} value={item.uuid}>{item.name}{row && enabled(row) ? ` · ${t(health(row) ? "trafficEvidence.fresh" : "trafficEvidence.needsAttention")}` : ""}
                {!!row?.unreadIncidentsIn72Hours && ` · ${t("trafficEvidence.nodeUnread", { n: row.unreadIncidentsIn72Hours })}`}
              </Select.Item>;
            })}</Select.Content>
          </Select.Root>
          {!!alerts.length && <Button type="button" variant="soft" size="1" onClick={nextAlert}>{t("trafficEvidence.nextAlert")}</Button>}
        </div>} />
      ) : <p role="status">{t(nodeList === null ? "trafficEvidence.loading" : "trafficEvidence.noNodes")}</p>}
    </div>
  );
}
