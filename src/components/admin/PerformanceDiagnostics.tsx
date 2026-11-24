import * as React from "react";
import { durationFromMs } from "@bufbuild/protobuf/wkt";
import {
  OperationState,
} from "@komari/proto/komari/common/v1/common_pb";
import { RescueAction } from "@komari/proto/komari/rescue/v1/rescue_pb";
import type { DiagnosticsReport } from "@komari/proto/komari/diag/v1/diag_pb";
import { Badge, Button, Callout, Card, Flex, Grid, Text, TextArea } from "@radix-ui/themes";
import { Activity, AlertTriangle, Cpu, HardDrive, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { connectUnary } from "@/api/connect/client";
import { DEFAULT_STREAM_DEADLINE_MS } from "@/api/connect/deadline";
import { useConnect } from "@/contexts/ConnectContext";
import { formatBytes } from "@/utils/unitHelper";

const diagnosticActions = [
  {
    value: RescueAction.DIAGNOSTICS,
    key: "machine",
  },
  {
    value: RescueAction.DETAILED_CPU_METRICS,
    key: "cpu",
  },
  {
    value: RescueAction.DETAILED_MEMORY_METRICS,
    key: "memory",
  },
] as const;

const terminalStates = new Set([
  OperationState.CANCELLED,
  OperationState.DEADLINE_EXCEEDED,
  OperationState.FAILED,
  OperationState.SUCCEEDED,
]);

export function PerformanceDiagnostics({ agentId }: { agentId: string }) {
  const { rescue } = useConnect();
  const { t } = useTranslation();
  const [selected, setSelected] = React.useState<RescueAction>(RescueAction.DIAGNOSTICS);
  const [busy, setBusy] = React.useState(false);
  const [output, setOutput] = React.useState("");
  const [report, setReport] = React.useState<DiagnosticsReport | null>(null);
  const [state, setState] = React.useState<OperationState>(OperationState.UNSPECIFIED);
  const streamRef = React.useRef<AbortController | null>(null);

  const run = async () => {
    streamRef.current?.abort();
    const controller = new AbortController();
    streamRef.current = controller;
    setBusy(true);
    setOutput("");
    setReport(null);
    setState(OperationState.UNSPECIFIED);

    try {
      const response = await connectUnary(
        { signal: controller.signal },
        (signal, timeoutMs) =>
          rescue.createRescueSession(
            {
              agentId,
              action: selected,
              arguments: [],
              sshPort: 0,
              timeout: durationFromMs(3 * 60_000),
              maxOutputBytes: 512n * 1024n,
              idempotencyKey: crypto.randomUUID(),
            },
            { signal, timeoutMs },
          ),
      );
      if (response.session) {
        setState(response.session.state);
        const signal = AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(DEFAULT_STREAM_DEADLINE_MS),
        ]);
        const stream = rescue.watchRescueSession(
          { sessionId: response.session.sessionId, afterSequence: 0n },
          { signal, timeoutMs: DEFAULT_STREAM_DEADLINE_MS },
        );
        for await (const msg of stream) {
          if (msg.heartbeat) continue;
          if (msg.event) {
            if (msg.event.output && msg.event.output.length > 0) {
              setOutput((prev) => prev + new TextDecoder().decode(msg.event!.output));
            }
            if (msg.event.diagnostics) {
              setReport(msg.event.diagnostics);
            }
            setState(msg.event.state);
            if (terminalStates.has(msg.event.state)) break;
          }
        }
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        toast.error(err instanceof Error ? err.message : t("rescue.diagnostics_failed"));
      }
    } finally {
      if (!controller.signal.aborted) {
        setBusy(false);
      }
    }
  };

  const done = terminalStates.has(state) && state !== OperationState.UNSPECIFIED;

  return (
    <Card className="p-6">
      <Flex direction="column" gap="4">
        <Flex align="center" gap="2">
          <Activity size={18} />
          <Text size="4" weight="bold">{t("rescue.diagnostics_title")}</Text>
        </Flex>

        {/* action selector */}
        <Flex direction="column" gap="2">
          {diagnosticActions.map((a) => (
            <Flex
              key={a.value}
              gap="2"
              align="start"
              className={`cursor-pointer rounded p-2 border ${selected === a.value ? "border-[var(--accent-8)] bg-[var(--accent-2)]" : "border-transparent hover:bg-[var(--gray-2)]"}`}
              onClick={() => setSelected(a.value)}
            >
              <input
                type="radio"
                aria-label={t("rescue.diagnostic_" + a.key)}
                checked={selected === a.value}
                onChange={() => setSelected(a.value)}
                className="mt-1"
              />
              <Flex direction="column" gap="1">
                <Text size="2" weight="medium">{t("rescue.diagnostic_" + a.key)}</Text>
                <Text size="1" color="gray">{t("rescue.diagnostic_" + a.key + "_detail")}</Text>
              </Flex>
            </Flex>
          ))}
        </Flex>

        <Flex justify="end" gap="2">
          {output && (
            <Button
              variant="soft"
              onClick={() =>
                navigator.clipboard
                  .writeText(output)
                  .then(() => toast.success(t("rescue.copied")))
              }
            >
              {t("rescue.copy_result")}
            </Button>
          )}
          <Button disabled={busy} onClick={() => void run()}>
            {busy ? <RefreshCw size={14} className="animate-spin" /> : <Activity size={14} />}
            {busy ? t("rescue.collecting") : t("rescue.collect")}
          </Button>
        </Flex>

        {report && (
          <Flex direction="column" gap="3" className="mt-2">
            <Text size="3" weight="bold">{t("rescue.structured_result")}</Text>
            {report.warnings && report.warnings.length > 0 && (
              <Callout.Root color="amber" size="1">
                <Callout.Icon>
                  <AlertTriangle size={14} />
                </Callout.Icon>
                <Callout.Text>
                  {report.warnings.join("; ")}
                </Callout.Text>
              </Callout.Root>
            )}
            <Grid columns={{ initial: "1", sm: "2" }} gap="3">
              {report.cpu && (
                <Card className="p-3 bg-[var(--gray-2)]">
                  <Flex direction="column" gap="2">
                    <Flex align="center" gap="2">
                      <Cpu size={16} />
                      <Text size="2" weight="bold">{t("rescue.cpu_load")}</Text>
                    </Flex>
                    <Flex justify="between">
                      <Text size="1" color="gray">{t("rescue.logical_cores")}</Text>
                      <Text size="1" weight="medium">{report.cpu.logicalCpuCount}</Text>
                    </Flex>
                    <Flex justify="between">
                      <Text size="1" color="gray">{t("rescue.cpu_busy")}</Text>
                      <Text size="1" weight="medium">{report.cpu.busyPercent.toFixed(1)}%</Text>
                    </Flex>
                    {report.cpu.states && (
                      <>
                        <Flex justify="between">
                          <Text size="1" color="gray">{t("rescue.cpu_user_system")}</Text>
                          <Text size="1">{report.cpu.states.userPercent.toFixed(1)}% / {report.cpu.states.systemPercent.toFixed(1)}%</Text>
                        </Flex>
                        <Flex justify="between">
                          <Text size="1" color="gray">IOWait / Steal</Text>
                          <Text size="1">
                            {report.cpu.states.iowaitPercent.toFixed(1)}% /{" "}
                            <span className={report.cpu.states.stealPercent > 5 ? "text-amber-500 font-bold" : ""}>
                              {report.cpu.states.stealPercent.toFixed(1)}%
                            </span>
                          </Text>
                        </Flex>
                      </>
                    )}
                    {report.cpu.loadAverage && report.cpu.loadAverage.length > 0 && (
                      <Flex justify="between">
                        <Text size="1" color="gray">{t("rescue.cpu_load_average")}</Text>
                        <Text size="1">{report.cpu.loadAverage.map((v) => v.toFixed(2)).join(", ")}</Text>
                      </Flex>
                    )}
                    {report.cpu.pressure && (
                      <Flex justify="between">
                        <Text size="1" color="gray">{t("rescue.cpu_pressure")}</Text>
                        <Text size="1">{report.cpu.pressure.someAvg10.toFixed(2)}% / {report.cpu.pressure.someAvg60.toFixed(2)}%</Text>
                      </Flex>
                    )}
                  </Flex>
                </Card>
              )}

              {report.memory && (
                <Card className="p-3 bg-[var(--gray-2)]">
                  <Flex direction="column" gap="2">
                    <Flex align="center" gap="2">
                      <HardDrive size={16} />
                      <Text size="2" weight="bold">{t("rescue.memory_swap")}</Text>
                    </Flex>
                    <Flex justify="between">
                      <Text size="1" color="gray">{t("rescue.memory_available")}</Text>
                      <Text size="1" weight="medium">{formatBytes(Number(report.memory.availableBytes))}</Text>
                    </Flex>
                    <Flex justify="between">
                      <Text size="1" color="gray">{t("rescue.memory_total_used")}</Text>
                      <Text size="1">{formatBytes(Number(report.memory.totalBytes))} / {formatBytes(Number(report.memory.usedBytes))}</Text>
                    </Flex>
                    <Flex justify="between">
                      <Text size="1" color="gray">{t("rescue.swap_used_total")}</Text>
                      <Text size="1">{formatBytes(Number(report.memory.swapUsedBytes))} / {formatBytes(Number(report.memory.swapTotalBytes))}</Text>
                    </Flex>
                    {report.memory.pressure && (
                      <Flex justify="between">
                        <Text size="1" color="gray">{t("rescue.memory_pressure")}</Text>
                        <Text size="1">{report.memory.pressure.someAvg10.toFixed(2)}%</Text>
                      </Flex>
                    )}
                    {report.memory.paging && report.memory.paging.oomKillsTotal > 0n && (
                      <Flex justify="between">
                        <Text size="1" color="red" weight="bold">{t("rescue.oom_kills")}</Text>
                        <Badge color="red">{report.memory.paging.oomKillsTotal.toString()}</Badge>
                      </Flex>
                    )}
                  </Flex>
                </Card>
              )}
            </Grid>
          </Flex>
        )}

        {(output || busy) && (
          <Flex direction="column" gap="1">
            {done && (
              <Text size="1" color={state === OperationState.SUCCEEDED ? "green" : "red"}>
                {state === OperationState.SUCCEEDED ? t("rescue.collection_complete") : t("rescue.collection_failed")}
              </Text>
            )}
            <TextArea
              readOnly
              value={output}
              placeholder={t(busy ? "rescue.collecting" : "rescue.output_result")}
              style={{ minHeight: "240px", fontFamily: "monospace", fontSize: "12px" }}
            />
          </Flex>
        )}
      </Flex>
    </Card>
  );
}
