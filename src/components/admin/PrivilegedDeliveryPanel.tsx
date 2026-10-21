import * as React from "react";
import { create } from "@bufbuild/protobuf";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { Badge, Button, Callout, Checkbox, Flex, Select, Text, TextField } from "@radix-ui/themes";
import { toast } from "sonner";
import {
  PrivilegedConfigSchema, PrivilegedDeliveryState as State,
  type GetNodeConfigStateResponse, type PrivilegedRevision,
} from "@komari/proto/komari/config/v1/config_pb";
import { TwoFactorProofSchema } from "@komari/proto/komari/common/v1/common_pb";
import { PrivilegeMode } from "@komari/proto/komari/report/v1/report_pb";
import { connectClients, connectUnary } from "@/api/connect/client";
import { acceptState, appliedSnapshot, confirmationStillCurrent } from "@/utils/privilegedDelivery";

const labels: Record<State, string> = {
  [State.UNSPECIFIED]: "初始化中",
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
    <Text size="2">目标身份：{modeLabels[settings.requiredPrivilegeMode]}</Text>
  </Flex>;
}

export function PrivilegedDeliveryPanel({ agentId, history = false }: { agentId: string; history?: boolean }) {
  const [state, setState] = React.useState<GetNodeConfigStateResponse>();
  const [revisions, setRevisions] = React.useState<PrivilegedRevision[]>([]);
  const [error, setError] = React.useState("");
  const [draft, setDraft] = React.useState(() => create(PrivilegedConfigSchema));
  const [editing, setEditing] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [code, setCode] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [now, setNow] = React.useState(Date.now());
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
    setState(undefined); setEditing(false); setCode(""); setRevisions([]); setError("");
    void load(controller.signal);
    const poll = window.setInterval(() => void load(controller.signal), 5_000);
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => { controller.abort(); window.clearInterval(poll); window.clearInterval(timer); };
  }, [load]);
  const desired = state?.desired;
  const applied = state && appliedSnapshot(state);
  // An approval code belongs to one revision, never to the next poll result.
  React.useEffect(() => { setCode(""); }, [desired?.revision, desired?.state]);
  const expiry = desired?.authorization?.expiresAt;
  const expiresAt = expiry ? timestampDate(expiry).getTime() : undefined;
  const expired = expiresAt !== undefined && expiresAt <= now;
  const countdown = expiresAt === undefined ? undefined : Math.max(0, Math.ceil((expiresAt - now) / 1000));
  const ready = state?.protocolVersion === 2;

  const confirm = async () => {
    if (!desired || !code.trim() || busy) return;
    setBusy(true);
    const controller = new AbortController();
    try {
      const fresh = await read(controller.signal);
      if (currentAgent.current !== agentId) return;
      if (!confirmationStillCurrent(desired, fresh.desired, State.NEEDS_CONFIRMATION)) {
        setState(fresh); setCode("");
        toast.error("配置状态已变化，已刷新，请核对当前版本"); return;
      }
      await connectUnary({ signal: controller.signal }, (signal, timeoutMs) =>
        connectClients.privilegedDelivery.confirmPrivilegedDelivery({ agentId, revision: desired.revision,
          twoFactor: create(TwoFactorProofSchema, { code: code.trim() }) }, { signal, timeoutMs }));
      toast.success("已批准，等待机器应用");
    } catch (err) { toast.error(err instanceof Error ? err.message : "确认失败"); }
    finally { setBusy(false); setCode(""); await load(controller.signal); }
  };
  const save = async () => {
    if (!state || busy) return;
    setBusy(true);
    const controller = new AbortController();
    try {
      await connectUnary({ signal: controller.signal }, (signal, timeoutMs) =>
        connectClients.privilegedDelivery.updatePrivilegedDelivery({ agentId, privileged: draft,
          expectedRevision: state.desired?.revision ?? 0n, reason: reason.trim(), protocolVersion: 2 }, { signal, timeoutMs }));
      setEditing(false); setReason(""); toast.success("已保存，等待 2FA 确认");
    } catch (err) { toast.error(err instanceof Error ? err.message : "保存失败"); }
    finally { setBusy(false); await load(controller.signal); }
  };
  return <Flex direction="column" gap="3" className="rounded-lg border p-4">
    <Text size="3" weight="bold">特权配置下发状态</Text>
    {error && <Callout.Root color="red"><Callout.Text>{error}</Callout.Text></Callout.Root>}
    {!state ? <Text>正在读取配置状态…</Text> : <>
      {!ready && <Text color="orange">此节点尚未协商新版协议。请先升级并迁移安装，再下发特权配置。</Text>}
      <Badge color={desired?.state === State.DELIVERED ? "green" : "orange"}>{labels[desired?.state ?? State.UNSPECIFIED]}</Badge>
      <Text size="2">期望版本：{desired?.revision.toString() ?? "0"}；已应用版本：{state.appliedRevision.toString()}</Text>
      {state.observation && <Text size="2">运行中的 Agent：{modeLabels[state.observation.privilegeMode]}；服务：{state.observation.serviceId}</Text>}
      <Text size="2" weight="medium">当前生效特权快照{applied ? `（r${applied.revision}）` : "：尚无 Agent 应用确认"}</Text>
      {applied && <Snapshot revision={applied} />}
      {desired && desired.revision !== state.appliedRevision && <>
        <Text size="2" weight="medium">期望配置（r{desired.revision.toString()}）</Text>
        <Snapshot revision={desired} />
        {desired.errors.map((e, i) => <Text key={i} color="red">{e.message}</Text>)}
        {desired.state === State.NEEDS_CONFIRMATION && ready && <Flex gap="2" wrap="wrap">
          <TextField.Root type="password" autoComplete="one-time-code" placeholder="面板 2FA 验证码"
            value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void confirm(); }} />
          <Button disabled={busy || !code.trim()} onClick={() => void confirm()}>确认此版本</Button>
        </Flex>}
        {desired.state === State.NEEDS_MANUAL_AUTHORIZATION && <Callout.Root color="orange"><Callout.Text>
          <Flex direction="column" gap="2">
            <Text>需要本机管理员操作。密码仅在本机系统认证中输入。</Text>
            {countdown !== undefined && <Text>{expired ? "授权已过期，请保存新版本后重新确认" : `${Math.floor(countdown / 60)}:${String(countdown % 60).padStart(2, "0")} 后过期`}</Text>}
            <Text>主机身份转换和救援组件安装尚未开放，不能通过旧版 upgrade 命令完成。</Text>
          </Flex>
        </Callout.Text></Callout.Root>}
      </>}
      <Button variant="soft" disabled={!ready || busy || !!error} onClick={() => {
        setDraft(create(PrivilegedConfigSchema, desired?.privileged ?? applied?.privileged)); setEditing(true);
      }}>编辑新版本</Button>
      {editing && <Flex direction="column" gap="2">
        {settingLabels.map(([key, label]) => <Flex key={key} gap="2">
          <Checkbox checked={draft[key]} onCheckedChange={(value) => setDraft((s) => ({ ...s, [key]: value === true }))} />
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
