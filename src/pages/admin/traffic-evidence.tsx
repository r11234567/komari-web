import { useEffect, useState, type ReactNode } from "react";
import { Badge, Button, Callout, Dialog, Select, Tabs } from "@radix-ui/themes";
import { timestampDate, type Timestamp } from "@bufbuild/protobuf/wkt";
import type {
  ListTrafficEvidenceResponse,
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
import { useNodeList } from "@/contexts/NodeListContext";
import { formatBytes } from "@/utils/unitHelper";

function localTime(value: Timestamp | undefined, language: string) {
  return value ? timestampDate(value).toLocaleString(language) : "—";
}

function bytes(value: bigint | undefined, language: string) {
  const count = value ?? 0n;
  return <span className="tabular-nums" title={`${count.toLocaleString(language)} B`}>{formatBytes(Number(count))}</span>;
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

function IncidentDetail({ agentId, selected, close }: { agentId: string; selected: TrafficEvidenceIncident; close: () => void }) {
  const { metrics } = useConnect();
  const { t, i18n } = useTranslation();
  const [state, setState] = useState<{ row?: TrafficEvidenceIncident; error?: boolean }>({});
  useEffect(() => {
    const controller = new AbortController();
    void connectUnary({ signal: controller.signal }, (signal, timeoutMs) =>
      metrics.getTrafficEvidenceIncident({ agentId, incidentId: selected.id }, { signal, timeoutMs }),
    ).then(
      (result) => setState({ row: result.incident }),
      () => { if (!controller.signal.aborted) setState({ error: true }); },
    );
    return () => controller.abort();
  }, [agentId, metrics, selected.id]);
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
        {state.error && <Callout.Root color="red"><Callout.Text>{t("trafficEvidence.detailError")}</Callout.Text></Callout.Root>}
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

function NodeEvidence({ agentId, selector }: { agentId: string; selector: ReactNode }) {
  const { metrics } = useConnect();
  const { t, i18n } = useTranslation();
  const [state, setState] = useState<{ data?: ListTrafficEvidenceResponse; error?: boolean }>({});
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<TrafficEvidenceIncident>();
  const language = i18n.resolvedLanguage ?? "en";
  useEffect(() => {
    const controller = new AbortController();
    void connectUnary({ signal: controller.signal }, (signal, timeoutMs) =>
      metrics.listTrafficEvidence({ agentId }, { signal, timeoutMs }),
    ).then(
      (data) => { if (!controller.signal.aborted) setState({ data }); },
      () => { if (!controller.signal.aborted) setState({ error: true }); },
    );
    return () => controller.abort();
  }, [agentId, metrics, revision]);
  const data = state.data;
  const monitorState = data?.monitoring?.state ?? TrafficMonitoringState.UNSPECIFIED;
  const status = !data?.agentOnline ? "offline"
    : data.monitoringEnabled && monitorState === TrafficMonitoringState.DISABLED ? "starting"
      : monitorStates[monitorState] ?? "upgrade";

  return (
    <>
      <div className="flex min-w-0 flex-wrap items-end justify-between gap-3">
        {selector}
        <Button variant="soft" onClick={() => { setState({}); setRevision((value) => value + 1); }}>{t("trafficEvidence.refresh")}</Button>
      </div>
      {data && <div className="flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm" role="status">
        <Badge color={status === "running" ? "green" : status === "captureUnavailable" || status === "noInterface" ? "amber" : "gray"}>
          {t(`trafficEvidence.monitor.${status}`)}
        </Badge>
        {data.agentOnline && data.monitoring?.interfaceName && <span className="font-mono">{data.monitoring.interfaceName}</span>}
        {status === "disabled" && <Link to="/admin/servers" className="underline">{t("trafficEvidence.monitor.configure")}</Link>}
      </div>}
      {state.error && <Callout.Root color="red"><Callout.Text>{t("trafficEvidence.loadError")}</Callout.Text></Callout.Root>}
      {!state.error && !state.data && <p role="status">{t("trafficEvidence.loading")}</p>}
      {state.data && (
        <Tabs.Root defaultValue="hours" className="min-w-0 space-y-4">
          <Tabs.List><Tabs.Trigger value="hours">{t("trafficEvidence.hours")}</Tabs.Trigger><Tabs.Trigger value="incidents">{t("trafficEvidence.incidents")}</Tabs.Trigger></Tabs.List>
          <Tabs.Content value="incidents">
            {state.data.incidents.length === 0 ? <p className="rounded-lg border p-4 text-sm">{t("trafficEvidence.noIncidents")}</p> : <Table>
              <TableHeader>
                <TableRow><TableHead>{t("trafficEvidence.triggerTime")}</TableHead><TableHead>{t("trafficEvidence.reason")}</TableHead><TableHead>{t("trafficEvidence.rx")}</TableHead><TableHead>{t("trafficEvidence.tx")}</TableHead><TableHead>{t("trafficEvidence.status")}</TableHead><TableHead>{t("trafficEvidence.detail")}</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {state.data.incidents.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell>{localTime(event.triggeredAt, language)}</TableCell>
                    <TableCell>{t(`trafficEvidence.reasons.${event.reason}`, { defaultValue: event.reason })}</TableCell>
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
            {state.data.hours.length === 0 ? <p className="rounded-lg border p-4 text-sm">{t("trafficEvidence.noHours")}</p> : <Table>
              <TableHeader>
                <TableRow><TableHead>{t("trafficEvidence.period")}</TableHead><TableHead>{t("trafficEvidence.service")}</TableHead><TableHead>{t("trafficEvidence.rx")}</TableHead><TableHead>{t("trafficEvidence.tx")}</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {state.data.hours.map((hour) => (
                  <TableRow key={hour.hourUtc?.seconds.toString()}>
                    <TableCell>{localTime(hour.hourUtc, language)} – {localTime(hour.through, language)}
                      {hour.partial && <Badge color="amber" className="ml-2">{t("trafficEvidence.partial")}</Badge>}
                    </TableCell>
                    <TableCell>
                      <div className="grid gap-1">
                        {Object.entries(hour.services).map(([name, count]) => <div key={name}>{t(`trafficEvidence.groups.${name}`, { defaultValue: name })} · ↓ {bytes(count.rxBytes, language)} · ↑ {bytes(count.txBytes, language)}</div>)}
                        <div>{t("trafficEvidence.unexplained")} · ↓ {bytes(hour.unexplained?.rxBytes, language)} · ↑ {bytes(hour.unexplained?.txBytes, language)}</div>
                      </div>
                    </TableCell>
                    <DirectionCells value={hour.observed} />
                  </TableRow>
                ))}
              </TableBody>
            </Table>}
          </Tabs.Content>
        </Tabs.Root>
      )}
      {selected && <IncidentDetail key={selected.id} agentId={agentId} selected={selected} close={() => setSelected(undefined)} />}
    </>
  );
}

export default function TrafficEvidencePage() {
  const { t } = useTranslation();
  const { nodeList } = useNodeList();
  const [selection, setSelection] = useState("");
  const agentId = nodeList?.some((node) => node.uuid === selection) ? selection : nodeList?.[0]?.uuid;
  return (
    <div className="mx-auto w-full min-w-0 max-w-6xl space-y-4">
      <AdminPageTitle description={t("trafficEvidence.description")}>{t("trafficEvidence.title")}</AdminPageTitle>
      {agentId ? (
        <NodeEvidence key={agentId} agentId={agentId} selector={<div className="flex min-w-0 flex-1 flex-col gap-1 sm:max-w-xs">
          <span className="text-sm font-medium">{t("trafficEvidence.node")}</span>
          <Select.Root value={agentId} onValueChange={setSelection}>
            <Select.Trigger className="w-full min-w-0" aria-label={t("trafficEvidence.node")} />
            <Select.Content>{nodeList?.map((node) => <Select.Item key={node.uuid} value={node.uuid}>{node.name}</Select.Item>)}</Select.Content>
          </Select.Root>
        </div>} />
      ) : <p role="status">{t(nodeList === null ? "trafficEvidence.loading" : "trafficEvidence.noNodes")}</p>}
    </div>
  );
}
