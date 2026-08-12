import * as React from "react";
import { create } from "@bufbuild/protobuf";
import { durationFromMs } from "@bufbuild/protobuf/wkt";
import {
  OperationState,
  TwoFactorProofSchema,
} from "@komari/proto/komari/common/v1/common_pb";
import {
  RescueAction,
  type RescueSession,
} from "@komari/proto/komari/rescue/v1/rescue_pb";
import {
  Button,
  Card,
  Flex,
  SegmentedControl,
  Text,
  TextArea,
  TextField,
} from "@radix-ui/themes";
import { ShieldAlert, Square } from "lucide-react";
import { toast } from "sonner";
import { connectUnary } from "@/api/connect/client";
import { DEFAULT_STREAM_DEADLINE_MS } from "@/api/connect/deadline";
import { useConnect } from "@/contexts/ConnectContext";

const actions = [
  [RescueAction.DIAGNOSTICS, "诊断"],
  [RescueAction.VERIFY_INSTALLATION, "校验安装"],
  [RescueAction.RESTORE_LAST_CONFIG, "恢复最近配置"],
  [RescueAction.ROLLBACK_RUNTIME_SNAPSHOT, "回滚运行时快照"],
  [RescueAction.REPAIR_FIREWALL, "修复防火墙"],
  [RescueAction.RESTART_AGENT, "重启 Agent"],
] as const;

const stateText: Record<OperationState, string> = {
  [OperationState.UNSPECIFIED]: "未知",
  [OperationState.QUEUED]: "排队中",
  [OperationState.RUNNING]: "运行中",
  [OperationState.CANCEL_REQUESTED]: "正在取消",
  [OperationState.CANCELLED]: "已取消",
  [OperationState.DEADLINE_EXCEEDED]: "已超时",
  [OperationState.FAILED]: "失败",
  [OperationState.SUCCEEDED]: "成功",
};

const terminalStates = new Set([
  OperationState.CANCELLED,
  OperationState.DEADLINE_EXCEEDED,
  OperationState.FAILED,
  OperationState.SUCCEEDED,
]);

export function RescueConsole({ agentId }: { agentId?: string }) {
  const { deployment, rescue } = useConnect();
  const [available, setAvailable] = React.useState(false);
  const [action, setAction] = React.useState<RescueAction>(RescueAction.DIAGNOSTICS);
  const [twoFactorCode, setTwoFactorCode] = React.useState("");
  const [session, setSession] = React.useState<RescueSession>();
  const [output, setOutput] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const statusController = React.useRef<AbortController | null>(null);
  const streamController = React.useRef<AbortController | null>(null);

  React.useEffect(() => {
    statusController.current?.abort();
    streamController.current?.abort();
    setAvailable(false);
    setSession(undefined);
    setOutput("");
    if (!agentId) return;

    const controller = new AbortController();
    statusController.current = controller;
    void connectUnary({ signal: controller.signal }, (signal, timeoutMs) =>
      deployment.getDeployment({ agentId }, { signal, timeoutMs }),
    )
      .then((response) => {
        const helper = response.rescueHelper;
        setAvailable(
          response.profile?.install?.remoteControlEnabled === false &&
            helper?.installed === true &&
            helper.helperRunning === true,
        );
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          toast.error(error instanceof Error ? error.message : "读取救援状态失败");
        }
      });

    return () => {
      controller.abort();
      streamController.current?.abort();
    };
  }, [agentId, deployment]);

  const watch = async (sessionId: string) => {
    streamController.current?.abort();
    const controller = new AbortController();
    streamController.current = controller;
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(DEFAULT_STREAM_DEADLINE_MS),
    ]);
    try {
      const stream = rescue.watchRescueSession(
        { sessionId, afterSequence: 0n },
        { signal, timeoutMs: DEFAULT_STREAM_DEADLINE_MS },
      );
      for await (const message of stream) {
        if (message.session) setSession(message.session);
        if (message.event) {
          if (message.event.output.length > 0) {
            setOutput((current) => current + new TextDecoder().decode(message.event!.output));
          }
          setSession((current) =>
            current ? { ...current, state: message.event!.state } : current,
          );
        }
      }
    } catch (error) {
      if (!signal.aborted) {
        toast.error(error instanceof Error ? error.message : "救援输出流中断");
      }
    } finally {
      setBusy(false);
    }
  };

  const start = async () => {
    if (!agentId || !twoFactorCode.trim()) {
      toast.error("请输入新的 2FA 验证码");
      return;
    }
    const controller = new AbortController();
    statusController.current?.abort();
    statusController.current = controller;
    setBusy(true);
    setOutput("");
    try {
      const response = await connectUnary({ signal: controller.signal }, (signal, timeoutMs) =>
        rescue.createRescueSession(
          {
            agentId,
            action,
            arguments: [],
            timeout: durationFromMs(5 * 60_000),
            maxOutputBytes: 256n * 1024n,
            idempotencyKey: crypto.randomUUID(),
            twoFactor: create(TwoFactorProofSchema, {
              code: twoFactorCode.trim(),
              challengeId: "",
            }),
          },
          { signal, timeoutMs },
        ),
      );
      setTwoFactorCode("");
      setSession(response.session);
      if (response.session) void watch(response.session.sessionId);
    } catch (error) {
      setBusy(false);
      if (!controller.signal.aborted) {
        toast.error(error instanceof Error ? error.message : "创建救援任务失败");
      }
    }
  };

  const cancel = async () => {
    if (!session || !twoFactorCode.trim()) {
      toast.error("取消也需要新的 2FA 验证码");
      return;
    }
    const controller = new AbortController();
    statusController.current?.abort();
    statusController.current = controller;
    try {
      const response = await connectUnary({ signal: controller.signal }, (signal, timeoutMs) =>
        rescue.cancelRescueSession(
          {
            sessionId: session.sessionId,
            reason: "cancelled by administrator",
            twoFactor: create(TwoFactorProofSchema, {
              code: twoFactorCode.trim(),
              challengeId: "",
            }),
          },
          { signal, timeoutMs },
        ),
      );
      setTwoFactorCode("");
      if (response.session) setSession(response.session);
    } catch (error) {
      if (!controller.signal.aborted) {
        toast.error(error instanceof Error ? error.message : "取消救援任务失败");
      }
    }
  };

  if (!available) return null;

  const terminal = session ? terminalStates.has(session.state) : false;
  return (
    <Card className="p-6">
      <Flex direction="column" gap="4">
        <Flex align="center" gap="2">
          <ShieldAlert size="18" />
          <Text size="4" weight="bold">救援模式控制台</Text>
        </Flex>
        <SegmentedControl.Root
          value={String(action)}
          onValueChange={(value) => setAction(Number(value) as RescueAction)}
        >
          {actions.map(([value, label]) => (
            <SegmentedControl.Item key={value} value={String(value)}>{label}</SegmentedControl.Item>
          ))}
        </SegmentedControl.Root>
        <Flex gap="2" justify="end" wrap="wrap">
          <TextField.Root
            type="password"
            placeholder="新的 2FA 验证码"
            value={twoFactorCode}
            onChange={(event) => setTwoFactorCode(event.target.value)}
          />
          {session && !terminal ? (
            <Button color="red" variant="soft" onClick={() => void cancel()}>
              <Square size="15" />取消任务
            </Button>
          ) : (
            <Button disabled={busy} onClick={() => void start()}>执行救援动作</Button>
          )}
        </Flex>
        {session && (
          <Text size="2">
            状态：{stateText[session.state]}；会话：{session.sessionId}
          </Text>
        )}
        {session?.error && <Text size="2" color="red">{session.error.message}</Text>}
        <TextArea
          readOnly
          value={output}
          placeholder="救援辅助程序输出"
          style={{ minHeight: "180px", fontFamily: "monospace" }}
        />
      </Flex>
    </Card>
  );
}
