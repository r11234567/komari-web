import * as React from "react";
import { create } from "@bufbuild/protobuf";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { Badge, Button, Callout, Checkbox, Flex, Select, Text, TextField } from "@radix-ui/themes";
import { toast } from "sonner";
import SensitiveActionDialog, { type SensitiveAction } from "@/components/SensitiveActionDialog";
import {
  PrivilegedConfigSchema, PrivilegedDeliveryState as State,
  type GetNodeConfigStateResponse, type PrivilegedRevision,
} from "@komari/proto/komari/config/v1/config_pb";
import { TwoFactorProofSchema } from "@komari/proto/komari/common/v1/common_pb";
import { PrivilegeMode } from "@komari/proto/komari/report/v1/report_pb";
import { HostAction, HostOperationPhase } from "@komari/proto/komari/host/v1/host_pb";
import { connectClients, connectUnary } from "@/api/connect/client";
import { acceptState, appliedSnapshot, confirmationStillCurrent, boundedRemoteSettings, needsRescueInstall } from "@/utils/privilegedDelivery";
import { unsupportedHostPlatform } from "@/utils/deploymentObservation";

const labels: Record<State, string> = {
  [State.UNSPECIFIED]: "尚未建立特权配置基线",
  [State.NEEDS_CONFIRMATION]: "等待面板 2FA 确认",
  [State.NEEDS_MANUAL_AUTHORIZATION]: "等待本机管理员操作",
  [State.DELIVERED]: "已应用",
  [State.ROLLED_BACK]: "已回滚",
  [State.FAILED]: "应用失败",
  [State.AWAITING_AGENT]: "已批准，等待 Agent",
  [State.APPLYING]: "正在应用，等待运行中的 Agent 确认",
  [State.SUPERSEDED]: "已被新版本取代",
  [State.EXPIRED]: "授权已过期，需保存新版本并重新确认",
};
const settingLabels = [
  ["remoteControlEnabled", "远程控制"], ["websshEnabled", "WebSSH"],
  ["executionEnabled", "远程执行"], ["enableGpu", "基础 GPU 采集"],
  ["rescueHelperEnabled", "救援辅助程序"],
] as const;
const modeLabels: Record<PrivilegeMode, string> = {
  [PrivilegeMode.UNSPECIFIED]: "未知",
  [PrivilegeMode.OTHER]: "其他系统身份",
  [PrivilegeMode.LINUX_ROOT]: "Linux root",
  [PrivilegeMode.LINUX_NON_ROOT]: "Linux 普通账号",
  [PrivilegeMode.WINDOWS_ADMINISTRATOR]: "Windows 管理员",
  [PrivilegeMode.WINDOWS_STANDARD_USER]: "Windows 普通账号",
};

function Snapshot({ revision }: { revision: PrivilegedRevision }) {
  const settings = revision.privileged;
  if (!settings) return null;
  return <Flex direction="column" gap="1">
    {settingLabels.map(([key, label]) => <Text size="2" key={key}>{label}：{settings[key] ? "开启" : "关闭"}</Text>)}
    <Text size="2">Agent 目标身份：{modeLabels[settings.requiredPrivilegeMode]}</Text>
  </Flex>;
}

export function PrivilegedDeliveryPanel({ agentId, history = false, operatingSystem }: { agentId: string; history?: boolean; operatingSystem?: string }) {
  const [state, setState] = React.useState<GetNodeConfigStateResponse>();
  const [revisions, setRevisions] = React.useState<PrivilegedRevision[]>([]);
  const [error, setError] = React.useState("");
  const [draft, setDraft] = React.useState(() => create(PrivilegedConfigSchema));
  const [editing, setEditing] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [credentialAction, setCredentialAction] = React.useState<SensitiveAction | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [now, setNow] = React.useState(Date.now());
  const [reportedOS, setReportedOS] = React.useState("");
  React.useEffect(() => {
    const controller = new AbortController();
    setReportedOS(operatingSystem ?? "");
    if (!operatingSystem) {
      void connectUnary({ signal: controller.signal }, (signal, timeoutMs) =>
        connectClients.browser.getAgent({ agentId }, { signal, timeoutMs })).then((response) => {
        if (!controller.signal.aborted) setReportedOS(response.agent?.basicInfo?.os ?? "");
      }).catch(() => { /* Unknown OS stays unknown; never use the install template. */ });
    }
    return () => controller.abort();
  }, [agentId, operatingSystem]);
  const currentAgent = React.useRef(agentId);
  currentAgent.current = agentId;
  const read = React.useCallback((signal: AbortSignal) => connectUnary({ signal }, (signal, timeoutMs) =>
    connectClients.privilegedDelivery.getNodeConfigState({ agentId }, { signal, timeoutMs })), [agentId]);
  const load = React.useCallback(async (signal: AbortSignal) => {
    try {
      const response = await read(signal);
      if (signal.aborted || currentAgent.current !== agentId) return;
      setState((current) => acceptState(current, response) ? response : current);
      setError("");
      if (history) {
        const page = await connectUnary({ signal }, (signal, timeoutMs) =>
          connectClients.privilegedDelivery.listPrivilegedRevisions({ agentId, limit: 20 }, { signal, timeoutMs }));
        if (!signal.aborted && currentAgent.current === agentId) setRevisions(page.revisions);
      }
    } catch (err) {
      if (!signal.aborted && currentAgent.current === agentId) setError(err instanceof Error ? err.message : "读取失败");
    }
  }, [agentId, history, read]);
  React.useEffect(() => {
    const controller = new AbortController();
    setState(undefined); setEditing(false); setCredentialAction(null); setRevisions([]); setError("");
    void load(controller.signal);
    const poll = window.setInterval(() => void load(controller.signal), 5_000);
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => { controller.abort(); window.clearInterval(poll); window.clearInterval(timer); };
  }, [load]);
  const desired = state?.desired;
  const applied = state && appliedSnapshot(state);
  // An approval code belongs to one revision, never to the next poll result.
  React.useEffect(() => { setCredentialAction(null); }, [desired?.revision, desired?.state]);
  const expiry = desired?.authorization?.expiresAt;
  const expiresAt = expiry ? timestampDate(expiry).getTime() : undefined;
  const expired = expiresAt !== undefined && expiresAt <= now;
  const countdown = expiresAt === undefined ? undefined : Math.max(0, Math.ceil((expiresAt - now) / 1000));
  const unsupportedPlatform = unsupportedHostPlatform(reportedOS);
  const ready = state?.protocolVersion === 2 && !unsupportedPlatform;
  const rescueInstallNeeded = state && needsRescueInstall(state);
  const rescueInstallSupported = state?.supportedHostActions.includes(HostAction.INSTALL_RESCUE_HELPER);
  const serviceId = desired?.authorization?.serviceId ?? state?.observation?.serviceId;
  const trustedServiceId = serviceId && /^[A-Za-z0-9_.-]{1,128}$/.test(serviceId) && !serviceId.startsWith("-");
  const actions = desired?.authorization?.actions ?? [];
  const hostSupported = actions.length > 0 && actions.every((action) => state?.supportedHostActions.includes(action));
  const hostCommand = trustedServiceId && desired ? `sudo komari-host apply --manifest /etc/komari/services/${serviceId}.json --revision ${desired.revision}` : undefined;
  const hostPhases: Record<HostOperationPhase, string> = {
    [HostOperationPhase.UNSPECIFIED]: "尚未领取", [HostOperationPhase.PREPARED]: "已领取执行租约",
    [HostOperationPhase.APPLYING]: "正在修改本机服务", [HostOperationPhase.LOCAL_APPLIED]: "本机已验证，等待 daemon 确认",
    [HostOperationPhase.RESTORED]: "失败后已恢复原服务", [HostOperationPhase.FAILED]: "主机操作失败",
  };

  const confirm = async (authorizationToken: string, signal: AbortSignal) => {
    if (!desired || busy) throw new Error("配置状态已变化，请刷新后重试");
    setBusy(true);
    const controller = new AbortController();
    try {
      const fresh = await read(AbortSignal.any([controller.signal, signal]));
      if (currentAgent.current !== agentId) return;
      if (!confirmationStillCurrent(desired, fresh.desired, State.NEEDS_CONFIRMATION)) {
        setState(fresh); setCredentialAction(null);
        toast.error("配置状态已变化，已刷新，请核对当前版本");
        throw new Error("配置状态已变化，已刷新，请核对当前版本");
      }
      await connectUnary({ signal: AbortSignal.any([controller.signal, signal]) }, (signal, timeoutMs) =>
        connectClients.privilegedDelivery.confirmPrivilegedDelivery({ agentId, revision: desired.revision,
          twoFactor: create(TwoFactorProofSchema, { authorizationToken }) }, { signal, timeoutMs }));
      toast.success("已批准，等待机器应用");
    } finally { setBusy(false); await load(controller.signal); }
  };
  const save = async () => {
    if (!state || busy) return;
    setBusy(true);
    const controller = new AbortController();
    try {
      await connectUnary({ signal: controller.signal }, (signal, timeoutMs) =>
        connectClients.privilegedDelivery.updatePrivilegedDelivery({ agentId, privileged: boundedRemoteSettings(draft),
          expectedRevision: state.desired?.revision ?? 0n, reason: reason.trim(), protocolVersion: 2 }, { signal, timeoutMs }));
      setEditing(false); setReason(""); toast.success("已保存，等待 2FA 确认");
    } catch (err) { toast.error(err instanceof Error ? err.message : "保存失败"); }
    finally { setBusy(false); await load(controller.signal); }
  };
  return <Flex direction="column" gap="3" className="rounded-lg border p-4">
    <SensitiveActionDialog request={credentialAction} onClose={() => setCredentialAction(null)} />
    <Text size="3" weight="bold">特权配置下发状态</Text>
    {error && <Callout.Root color="red"><Callout.Text>{error}</Callout.Text></Callout.Root>}
    {!state ? <Text>正在读取配置状态…</Text> : <>
      {!ready && <Text color="orange">{unsupportedPlatform
        ? `${unsupportedPlatform} 当前不支持特权配置协议及主机操作；仅监控节点无需建立特权基线，普通配置通过独立通道下发。`
        : "尚未收到此节点的特权协议协商。普通配置通过独立通道下发；Linux systemd 节点如需特权配置，请核对本机安装清单、Host 工具与初始化日志。"}</Text>}
      {ready && !desired && <Text size="2" color="orange">Agent 已协商新版协议，但尚未提交特权基线。请检查 Agent 的初始化日志；普通配置通过独立通道加载，此状态不能代表普通配置的下发结果。</Text>}
      <Badge color={desired?.state === State.DELIVERED ? "green" : "orange"}>{desired?.installationBaseline && state.appliedRevision === 0n ? "基线初始化中，等待 Agent 确认" : labels[desired?.state ?? State.UNSPECIFIED]}</Badge>
      <Text size="2">期望版本：{desired?.revision.toString() ?? "0"}；已应用版本：{state.appliedRevision.toString()}</Text>
      {state.observation && <Text size="2">运行中的 Agent：{modeLabels[state.observation.privilegeMode]}；服务：{state.observation.serviceId}</Text>}
      {state.hostOperation && <Flex direction="column" gap="1">
        <Text size="2">主机操作：{hostPhases[state.hostOperation.phase]}；操作 ID：{state.hostOperation.operationId}</Text>
        {state.hostOperation.error && <Text size="2" color="red">{state.hostOperation.error}</Text>}
      </Flex>}
      {state.observation?.helperInstalled && <Text size="2">最近一次 daemon 确认的救援组件：已安装；运行 {state.observation.helperRunning ? "是" : "否"}；授权 {state.observation.helperAuthorized ? "是" : "否"}；租约就绪 {state.observation.helperLeaseReady ? "是" : "否"}</Text>}
      <Text size="2" weight="medium">当前生效特权快照{applied ? `（r${applied.revision}）` : "：尚无 Agent 应用确认"}</Text>
      {applied && <Snapshot revision={applied} />}
      {desired && desired.revision !== state.appliedRevision && <>
        <Text size="2" weight="medium">期望配置（r{desired.revision.toString()}）</Text>
        <Snapshot revision={desired} />
        {rescueInstallNeeded && <Callout.Root color="orange"><Callout.Text>
          <Flex direction="column" gap="1">
            <Text>此配置需要安装救援组件。救援作为独立的 root 服务运行，安装救援不会把 Agent 改成 root；Agent 按上方目标身份运行。</Text>
            <Text>{rescueInstallSupported
              ? "面板 2FA 确认后，页面会显示本机命令；执行该命令并完成 PAM 认证，Host 会自动下载同版本组件、验证发布者签名并安装，无需提前运行安装脚本或 fetch-helper。"
              : "此节点尚未声明救援安装能力。请先更新 Agent 和 Host，并准备发布者信任密钥及 PAM；本机明确禁止救援时需先由管理员调整策略。"}</Text>
          </Flex>
        </Callout.Text></Callout.Root>}
        {desired.errors.map((e, i) => <Text key={i} color="red">{e.message}</Text>)}
        {desired.state === State.NEEDS_CONFIRMATION && ready && <Flex gap="2" wrap="wrap">
          <Button disabled={busy || !!rescueInstallNeeded && !rescueInstallSupported} onClick={() => setCredentialAction({ action: "privileged:confirm", targets: [agentId, desired.revision.toString()], title: `确认特权配置版本 ${desired.revision}`, execute: confirm })}>确认此版本</Button>
        </Flex>}
        {desired.state === State.NEEDS_MANUAL_AUTHORIZATION && <Callout.Root color="orange"><Callout.Text>
          <Flex direction="column" gap="2">
            <Text>需要本机管理员操作。密码仅在本机系统认证中输入。</Text>
            {countdown !== undefined && <Text>{expired ? "授权已过期，请保存新版本后重新确认" : `${Math.floor(countdown / 60)}:${String(countdown % 60).padStart(2, "0")} 后过期`}</Text>}
            {ready && hostSupported && hostCommand ? <>
              <Text>在目标节点的本机管理员终端执行：</Text><code className="break-all select-all">{hostCommand}</code>
              {actions.includes(HostAction.INSTALL_RESCUE_HELPER) && <Text>此命令包含救援安装：本机认证后自动下载并验签，再安装独立的 root 救援服务。下载或验签失败不会停止原 Agent。</Text>}
            </> : <Text>此节点尚未准备好所需主机操作。Linux systemd 需安装新版 host 工具、固定主机信任密钥和 PAM 依赖后重启 agent；Windows/macOS 暂不支持身份转换与救援安装。</Text>}
          </Flex>
        </Callout.Text></Callout.Root>}
      </>}
      <Button variant="soft" disabled={!ready || busy || !!error} onClick={() => {
        setDraft(create(PrivilegedConfigSchema, desired?.privileged ?? applied?.privileged)); setEditing(true);
      }}>编辑新版本</Button>
      {editing && <Flex direction="column" gap="2">
        <Text size="2" color="gray">救援组件以独立 root 服务运行。开启救援不会修改下方的 Agent 目标身份，可与普通远程控制同时启用。</Text>
        {settingLabels.map(([key, label]) => <Flex key={key} gap="2">
          <Checkbox disabled={(key === "websshEnabled" || key === "executionEnabled") && !draft.remoteControlEnabled} checked={draft[key]} onCheckedChange={(value) => setDraft((s) => ({ ...s, [key]: value === true }))} />
          <Text>{label}</Text>
        </Flex>)}
        <Select.Root value={String(draft.requiredPrivilegeMode)} onValueChange={(value) => setDraft((s) => ({ ...s, requiredPrivilegeMode: Number(value) }))}>
          <Select.Trigger aria-label="目标服务身份" /><Select.Content>
            {Object.entries(modeLabels).map(([value, label]) => <Select.Item key={value} value={value}>{label}</Select.Item>)}
          </Select.Content>
        </Select.Root>
        <TextField.Root placeholder="变更原因" value={reason} onChange={(e) => setReason(e.target.value)} />
        <Flex gap="2"><Button disabled={busy || !!error} onClick={() => void save()}>保存并等待确认</Button>
          <Button variant="soft" onClick={() => setEditing(false)}>取消</Button></Flex>
      </Flex>}
      {history && revisions.map((r) => <Flex direction="column" gap="1" key={String(r.revision)}>
        <Text size="2">r{r.revision.toString()} · {labels[r.state]}{r.revision === state.appliedRevision ? " · 当前生效" : ""}</Text>
      </Flex>)}
    </>}
  </Flex>;
}
