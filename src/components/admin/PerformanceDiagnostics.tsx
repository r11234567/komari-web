import * as React from "react";
import { create } from "@bufbuild/protobuf";
import { durationFromMs } from "@bufbuild/protobuf/wkt";
import {
  OperationState,
  TwoFactorProofSchema,
} from "@komari/proto/komari/common/v1/common_pb";
import { RescueAction } from "@komari/proto/komari/rescue/v1/rescue_pb";
import { Button, Card, Flex, Text, TextArea, TextField } from "@radix-ui/themes";
import { Activity, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { connectUnary } from "@/api/connect/client";
import { DEFAULT_STREAM_DEADLINE_MS } from "@/api/connect/deadline";
import { useConnect } from "@/contexts/ConnectContext";

const diagnosticActions = [
  {
    value: RescueAction.DIAGNOSTICS,
    label: "机器状态诊断",
    detail: "采集系统、内存、磁盘、网卡、路由和失败服务状态。",
    noTwoFactor: true,
  },
  {
    value: RescueAction.DETAILED_CPU_METRICS,
    label: "详细 CPU 统计",
    detail: "采集 user/kernel/softirq/steal 细分及 PSI 压力指标。",
    noTwoFactor: true,
  },
  {
    value: RescueAction.DETAILED_MEMORY_METRICS,
    label: "详细内存统计",
    detail: "采集 swap 使用、换页抖动、zswap 和 PSI 压力指标。",
    noTwoFactor: true,
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
  const [selected, setSelected] = React.useState<RescueAction>(RescueAction.DIAGNOSTICS);
  const [twoFactor, setTwoFactor] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [output, setOutput] = React.useState("");
  const [state, setState] = React.useState<OperationState>(OperationState.UNSPECIFIED);
  const streamRef = React.useRef<AbortController | null>(null);

  const run = async () => {
    streamRef.current?.abort();
    const controller = new AbortController();
    streamRef.current = controller;
    setBusy(true);
    setOutput("");
    setState(OperationState.UNSPECIFIED);

    const action = diagnosticActions.find((a) => a.value === selected)!;
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
              twoFactor: create(TwoFactorProofSchema, {
                code: action.noTwoFactor ? "" : twoFactor.trim(),
                challengeId: "",
              }),
            },
            { signal, timeoutMs },
          ),
      );
      setTwoFactor("");
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
          if (msg.event) {
            if (msg.event.output.length > 0) {
              setOutput((prev) => prev + new TextDecoder().decode(msg.event!.output));
            }
            setState(msg.event.state);
            if (terminalStates.has(msg.event.state)) break;
          }
        }
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        toast.error(err instanceof Error ? err.message : "诊断失败");
      }
    } finally {
      setBusy(false);
    }
  };

  const selectedAction = diagnosticActions.find((a) => a.value === selected)!;
  const done = terminalStates.has(state) && state !== OperationState.UNSPECIFIED;

  return (
    <Card className="p-6">
      <Flex direction="column" gap="4">
        <Flex align="center" gap="2">
          <Activity size={18} />
          <Text size="4" weight="bold">性能诊断（一次性采集）</Text>
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
                checked={selected === a.value}
                onChange={() => setSelected(a.value)}
                className="mt-1"
              />
              <Flex direction="column" gap="1">
                <Text size="2" weight="medium">{a.label}</Text>
                <Text size="1" color="gray">{a.detail}</Text>
              </Flex>
            </Flex>
          ))}
        </Flex>

        {!selectedAction.noTwoFactor && (
          <TextField.Root
            type="password"
            placeholder="2FA 验证码"
            value={twoFactor}
            onChange={(e) => setTwoFactor(e.target.value)}
          />
        )}

        <Flex justify="end" gap="2">
          {output && (
            <Button
              variant="soft"
              onClick={() =>
                navigator.clipboard
                  .writeText(output)
                  .then(() => toast.success("已复制"))
              }
            >
              复制结果
            </Button>
          )}
          <Button disabled={busy} onClick={() => void run()}>
            {busy ? <RefreshCw size={14} className="animate-spin" /> : <Activity size={14} />}
            {busy ? "采集中…" : "开始采集"}
          </Button>
        </Flex>

        {(output || busy) && (
          <Flex direction="column" gap="1">
            {done && (
              <Text size="1" color={state === OperationState.SUCCEEDED ? "green" : "red"}>
                {state === OperationState.SUCCEEDED ? "采集完成" : "采集失败或超时"}
              </Text>
            )}
            <TextArea
              readOnly
              value={output}
              placeholder={busy ? "正在采集…" : "输出结果"}
              style={{ minHeight: "240px", fontFamily: "monospace", fontSize: "12px" }}
            />
          </Flex>
        )}
      </Flex>
    </Card>
  );
}
