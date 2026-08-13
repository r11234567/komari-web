import * as React from "react";
import { create } from "@bufbuild/protobuf";
import { durationFromMs } from "@bufbuild/protobuf/wkt";
import {
  OperationState,
  TwoFactorProofSchema,
} from "@komari/proto/komari/common/v1/common_pb";
import {
  RescueAction,
  NetworkIsolationMode,
  type RescueHelperStatus,
  type RescueSession,
} from "@komari/proto/komari/rescue/v1/rescue_pb";
import {
  Button,
  Card,
  Flex,
  Select,
  Text,
  TextArea,
  TextField,
} from "@radix-ui/themes";
import { Power, RefreshCw, ShieldAlert, Square, Stethoscope } from "lucide-react";
import { toast } from "sonner";
import { connectUnary } from "@/api/connect/client";
import { DEFAULT_STREAM_DEADLINE_MS } from "@/api/connect/deadline";
import { useConnect } from "@/contexts/ConnectContext";

const actions = [
  { value: RescueAction.DIAGNOSTICS, label: "机器状态诊断", detail: "采集系统、内存、磁盘、网卡、路由和失败服务状态。", destructive: false },
  { value: RescueAction.SHUTDOWN, label: "关闭 VPS", detail: "立即关闭操作系统。恢复需要云厂商控制台或物理电源。", destructive: true },
  { value: RescueAction.REBOOT, label: "重启 VPS", detail: "立即重启整台机器，不只是重启 Agent。", destructive: true },
  { value: RescueAction.BLOCK_PUBLIC_INTERFACES, label: "阻断公网网卡", detail: "阻断默认路由网卡全部入站和出站，可能立即失去远程连接。", destructive: true },
  { value: RescueAction.BLOCK_TAILSCALE_INTERFACES, label: "阻断 Tailscale 网卡", detail: "阻断所有 tailscale* 网卡全部入站和出站。", destructive: true },
  { value: RescueAction.ISOLATE_CONTROL_PLANE, label: "仅保留控制面板通信", detail: "阻断其他网络，只保留回环和安装时配置的 Komari 面板 IP/端口。可远程撤销。", destructive: true },
  { value: RescueAction.RESTORE_NETWORK, label: "撤销网络隔离", detail: "仅删除 Komari 创建的隔离规则并恢复保存的默认策略，不修改其他防火墙规则。", destructive: false },
  { value: RescueAction.ROLLBACK_ONLINE_CONFIG, label: "回滚在线配置", detail: "后端恢复上一份七项在线配置，生成新版本并重启普通 Agent 应用。", destructive: true },
] as const;

const isolationText: Record<NetworkIsolationMode, string> = {
  [NetworkIsolationMode.UNSPECIFIED]: "未知",
  [NetworkIsolationMode.NONE]: "未隔离",
  [NetworkIsolationMode.PUBLIC_INTERFACES]: "公网网卡已阻断",
  [NetworkIsolationMode.TAILSCALE_INTERFACES]: "Tailscale 网卡已阻断",
  [NetworkIsolationMode.CONTROL_PLANE_ONLY]: "仅保留控制面板通信",
};

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
  const [helperStatus, setHelperStatus] = React.useState<RescueHelperStatus>();
  const [action, setAction] = React.useState<RescueAction>(RescueAction.DIAGNOSTICS);
  const [twoFactorCode, setTwoFactorCode] = React.useState("");
  const [session, setSession] = React.useState<RescueSession>();
  const [output, setOutput] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const statusController = React.useRef<AbortController | null>(null);
  const streamController = React.useRef<AbortController | null>(null);
  const statusTimer = React.useRef<number | undefined>(undefined);

  const loadStatus = React.useCallback(async (signal: AbortSignal) => {
    if (!agentId) return;
    const response = await connectUnary({ signal }, (requestSignal, timeoutMs) =>
      deployment.getDeployment({ agentId }, { signal: requestSignal, timeoutMs }),
    );
    const helper = response.rescueHelper;
    setHelperStatus(helper);
    setAvailable(
      response.profile?.install?.remoteControlEnabled === false &&
        helper?.installed === true &&
        helper.helperRunning === true,
    );
  }, [agentId, deployment]);

  React.useEffect(() => {
    statusController.current?.abort();
    streamController.current?.abort();
    setAvailable(false);
    setHelperStatus(undefined);
    setSession(undefined);
    setOutput("");
    if (!agentId) return;

    const controller = new AbortController();
    statusController.current = controller;
    void loadStatus(controller.signal)
      .catch((error) => {
        if (!controller.signal.aborted) {
          toast.error(error instanceof Error ? error.message : "读取救援状态失败");
        }
      });

    return () => {
      controller.abort();
      streamController.current?.abort();
      if (statusTimer.current !== undefined) window.clearTimeout(statusTimer.current);
    };
  }, [agentId, loadStatus]);

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
      if (statusTimer.current !== undefined) window.clearTimeout(statusTimer.current);
      statusTimer.current = window.setTimeout(() => {
        const status = new AbortController();
        statusController.current = status;
        void loadStatus(status.signal).catch(() => undefined);
      }, 3_000);
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
  const selectedAction = actions.find((item) => item.value === action) ?? actions[0];
  return (
    <Card className="p-6">
      <Flex direction="column" gap="4">
        <Flex align="center" gap="2">
          <ShieldAlert size="18" />
          <Text size="4" weight="bold">救援模式控制台</Text>
        </Flex>
        <Flex direction="column" gap="2">
          <Text size="2">网络状态：{isolationText[helperStatus?.networkIsolation ?? NetworkIsolationMode.UNSPECIFIED]}</Text>
          {(helperStatus?.blockedInterfaces.length ?? 0) > 0 && (
            <Text size="2" color="gray">已阻断网卡：{helperStatus?.blockedInterfaces.join(", ")}</Text>
          )}
        </Flex>
        <Select.Root
          value={String(action)}
          onValueChange={(value) => setAction(Number(value) as RescueAction)}
        >
          <Select.Trigger aria-label="救援动作" />
          <Select.Content>
            {actions.map((item) => (
              <Select.Item key={item.value} value={String(item.value)}>{item.label}</Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
        <Text size="2" color={selectedAction.destructive ? "red" : "gray"}>{selectedAction.detail}</Text>
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
            <Button {...(selectedAction.destructive ? { color: "red" as const } : {})} disabled={busy} onClick={() => void start()}>
              {action === RescueAction.DIAGNOSTICS ? <Stethoscope size="15" /> : action === RescueAction.RESTORE_NETWORK ? <RefreshCw size="15" /> : <Power size="15" />}
              执行{selectedAction.label}
            </Button>
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
