import * as React from "react";
import { durationFromMs, timestampDate, type Timestamp } from "@bufbuild/protobuf/wkt";
import {
  AgentRuntimeIdentity,
  Platform,
  type ConfigDelivery,
  type DeploymentProfile,
} from "@komari/proto/komari/deployment/v1/deployment_pb";
import {
  RuntimeConfigSchema,
  PrivilegedDeliveryState,
  type PrivilegedRevision,
} from "@komari/proto/komari/config/v1/config_pb";
import { DeliveryState, TwoFactorProofSchema } from "@komari/proto/komari/common/v1/common_pb";
import { PrivilegeMode } from "@komari/proto/komari/report/v1/report_pb";
import { create } from "@bufbuild/protobuf";
import {
  Badge,
  Button,
  Callout,
  Checkbox,
  Dialog,
  Flex,
  IconButton,
  Text,
  TextField,
} from "@radix-ui/themes";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  Lock,
  Server,
  ShieldAlert,
  SlidersHorizontal,
} from "lucide-react";
import { toast } from "sonner";
import { connectUnary, connectClients } from "@/api/connect/client";
import { useConnect } from "@/contexts/ConnectContext";

const deliveryText: Record<DeliveryState, string> = {
  [DeliveryState.UNSPECIFIED]: "未知",
  [DeliveryState.SAVED]: "已保存",
  [DeliveryState.SENT]: "已下发",
  [DeliveryState.APPLIED]: "已应用",
  [DeliveryState.REJECTED]: "已拒绝",
  [DeliveryState.OFFLINE]: "Agent 离线",
  [DeliveryState.UPGRADE_REQUIRED]: "需要升级 Agent",
};

const privilegedDeliveryText: Record<PrivilegedDeliveryState, string> = {
  [PrivilegedDeliveryState.UNSPECIFIED]: "未知",
  [PrivilegedDeliveryState.NEEDS_CONFIRMATION]: "等待面板确认",
  [PrivilegedDeliveryState.NEEDS_MANUAL_AUTHORIZATION]: "需要在机器上执行",
  [PrivilegedDeliveryState.DELIVERED]: "已应用",
  [PrivilegedDeliveryState.ROLLED_BACK]: "已回滚",
  [PrivilegedDeliveryState.FAILED]: "失败",
};

const toLocalTime = (timestamp: Timestamp | undefined) =>
  timestamp ? timestampDate(timestamp).toLocaleString() : "-";

const listFromText = (value: string) =>
  value
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);

const listToText = (value: string[] | undefined) => (value ?? []).join(", ");

const intervalSeconds = (seconds: string) => {
  const parsed = Number(seconds);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.round(parsed * 1000) : undefined;
};

// ─── helpers ────────────────────────────────────────────────────────────────

function useCountdown(deadline: Date | null): string | null {
  const [remaining, setRemaining] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!deadline) { setRemaining(null); return; }
    const update = () => {
      const diff = deadline.getTime() - Date.now();
      if (diff <= 0) { setRemaining("已过期"); return; }
      const m = Math.floor(diff / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setRemaining(`${m}:${String(s).padStart(2, "0")} 后过期`);
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [deadline]);
  return remaining;
}

function InlineManualTaskCard({ task }: { task: NonNullable<NonNullable<PrivilegedRevision["plan"]>["manualTask"]> }) {
  const expiresDate = React.useMemo(() => {
    if (!task.expiresAt) return null;
    try { return timestampDate(task.expiresAt); } catch { return null; }
  }, [task.expiresAt]);
  const countdown = useCountdown(expiresDate);
  const isExpired = expiresDate && expiresDate.getTime() < Date.now();
  const command = task.command || "sudo komari-agent upgrade";

  return (
    <Callout.Root color={isExpired ? "red" : "orange"} size="1">
      <Callout.Icon><ShieldAlert size={13} /></Callout.Icon>
      <Callout.Text>
        <Flex direction="column" gap="2">
          <Text size="2">跨权限级变更，需要在机器上以管理员权限运行升级命令。</Text>
          {task.requireLocalPassword && (
            <Text size="1" color="gray">需要本地系统认证（sudo 密码或 PAM）</Text>
          )}
          {countdown && (
            <Flex align="center" gap="1">
              <Clock size={12} />
              <Text size="1" color={isExpired ? "red" : "orange"}>{countdown}</Text>
            </Flex>
          )}
          <Flex direction="column" gap="1">
            <Text size="1" weight="medium" color="gray">在机器上运行（Windows 请在管理员终端运行 komari-agent upgrade）：</Text>
            <Flex gap="2" align="start">
              <code style={{ fontFamily: "monospace", fontSize: "12px", background: "var(--gray-a3)", padding: "6px 10px", borderRadius: "4px", wordBreak: "break-all", flex: 1 }}>
                {command}
              </code>
              <Button variant="soft" size="1" onClick={() => navigator.clipboard.writeText(command).then(() => toast.success("命令已复制"))} title="复制命令">
                <Copy size={12} />复制
              </Button>
            </Flex>
          </Flex>
          {task.taskId && (
            <Text size="1" color="gray" style={{ fontFamily: "monospace" }}>任务 ID：{task.taskId}</Text>
          )}
        </Flex>
      </Callout.Text>
    </Callout.Root>
  );
}

// ─── main component ───────────────────────────────────────────────────────────

type AgentDeploymentDialogProps = {
  agentId: string;
  title?: string;
  iconClassName?: string;
};

export function AgentDeploymentDialog({
  agentId,
  title = "配置下发",
  iconClassName,
}: AgentDeploymentDialogProps) {
  const { deployment } = useConnect();
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [profile, setProfile] = React.useState<DeploymentProfile>();
  const [delivery, setDelivery] = React.useState<ConfigDelivery>();

  // privileged delivery state
  const [privRevision, setPrivRevision] = React.useState<PrivilegedRevision | undefined>();
  const [pendingPriv, setPendingPriv] = React.useState<PrivilegedRevision | undefined>();
  const [privAppliedRevision, setPrivAppliedRevision] = React.useState<bigint>(0n);
  const [privDraft, setPrivDraft] = React.useState({
    remoteControlEnabled: false,
    websshEnabled: false,
    executionEnabled: false,
    rescueHelperEnabled: false,
    enableGpu: false,
    requiredPrivilegeMode: PrivilegeMode.UNSPECIFIED,
  });
  const [installedMode, setInstalledMode] = React.useState<PrivilegeMode>(PrivilegeMode.UNSPECIFIED);
  const [twoFaCode, setTwoFaCode] = React.useState("");
  const [confirming, setConfirming] = React.useState(false);
  const [savingPrivileged, setSavingPrivileged] = React.useState(false);
  const [privReason, setPrivReason] = React.useState("");

  const controllerRef = React.useRef<AbortController | null>(null);

  const stopActiveRequest = () => controllerRef.current?.abort();

  const load = React.useCallback(async () => {
    stopActiveRequest();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    try {
      const [deployResp, privResp] = await Promise.all([
        connectUnary({ signal: controller.signal }, (signal, timeoutMs) =>
          deployment.getDeployment({ agentId }, { signal, timeoutMs }),
        ),
        connectUnary({ signal: controller.signal }, (signal, timeoutMs) =>
          connectClients.privilegedDelivery.listPrivilegedRevisions(
            { agentId, limit: 5 },
            { signal, timeoutMs },
          ),
        ).catch(() => null),
      ]);
      if (!controller.signal.aborted) {
        setProfile(deployResp.profile);
        setDelivery(deployResp.delivery);
        const pending = privResp?.revisions?.find(
          (r) =>
            r.state === PrivilegedDeliveryState.NEEDS_CONFIRMATION ||
            r.state === PrivilegedDeliveryState.NEEDS_MANUAL_AUTHORIZATION,
        );
        setPendingPriv(pending);
        setInstalledMode(privResp?.installedPrivilegeMode ?? PrivilegeMode.UNSPECIFIED);
        setPrivAppliedRevision(privResp?.appliedRevision ?? 0n);
        const latest = privResp?.revisions?.[0];
        const settings = latest?.privileged;
        setPrivDraft({
          remoteControlEnabled: settings?.remoteControlEnabled ?? false,
          websshEnabled: settings?.websshEnabled ?? false,
          executionEnabled: settings?.executionEnabled ?? false,
          rescueHelperEnabled: settings?.rescueHelperEnabled ?? false,
          enableGpu: settings?.enableGpu ?? false,
          requiredPrivilegeMode: settings?.requiredPrivilegeMode ?? PrivilegeMode.UNSPECIFIED,
        });
        setPrivRevision(privResp?.revisions?.[0]);
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        toast.error(error instanceof Error ? error.message : "读取部署配置失败");
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [agentId, deployment]);

  const confirmPriv = async () => {
    if (!pendingPriv || !twoFaCode.trim()) { toast.error("请输入 2FA 验证码"); return; }
    setConfirming(true);
    try {
      await connectUnary({ signal: new AbortController().signal }, (signal, timeoutMs) =>
        connectClients.privilegedDelivery.confirmPrivilegedDelivery(
          {
            agentId,
            revision: pendingPriv.revision,
            twoFactor: create(TwoFactorProofSchema, { code: twoFaCode.trim() }),
          },
          { signal, timeoutMs },
        ),
      );
      setTwoFaCode("");
      toast.success("已确认，等待机器应用");
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "确认失败");
    } finally {
      setConfirming(false);
    }
  };

  const savePrivileged = async () => {
    setSavingPrivileged(true);
    try {
      const response = await connectUnary({ signal: new AbortController().signal }, (signal, timeoutMs) =>
        connectClients.privilegedDelivery.updatePrivilegedDelivery(
          {
            agentId,
            expectedRevision: privRevision?.revision ?? 0n,
            reason: privReason.trim(),
            privileged: {
              remoteControlEnabled: isPrivilegedAccount && privDraft.remoteControlEnabled,
              websshEnabled: isPrivilegedAccount && privDraft.remoteControlEnabled && privDraft.websshEnabled,
              executionEnabled: isPrivilegedAccount && privDraft.remoteControlEnabled && privDraft.executionEnabled,
              rescueHelperEnabled: privDraft.rescueHelperEnabled,
              enableGpu: privDraft.enableGpu,
              requiredPrivilegeMode: isPrivilegedAccount
                ? (privDraft.requiredPrivilegeMode === PrivilegeMode.UNSPECIFIED
                    ? (isWindows ? PrivilegeMode.WINDOWS_ADMINISTRATOR : PrivilegeMode.LINUX_ROOT)
                    : privDraft.requiredPrivilegeMode)
                : (isWindows ? PrivilegeMode.WINDOWS_STANDARD_USER : PrivilegeMode.LINUX_NON_ROOT),
            },
          },
          { signal, timeoutMs },
        ),
      );
      setPrivRevision(response.revision);
      setPendingPriv(response.revision);
      setPrivReason("");
      toast.success("特权配置已保存，等待面板确认");
      void load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存特权配置失败");
    } finally {
      setSavingPrivileged(false);
    }
  };

  React.useEffect(() => {
    if (open) void load();
    else stopActiveRequest();
    return stopActiveRequest;
  }, [open, load]);

  const updateInstall = <K extends keyof NonNullable<DeploymentProfile["install"]>>(
    key: K,
    value: NonNullable<DeploymentProfile["install"]>[K],
  ) => {
    setProfile((current) => {
      if (!current?.install) return current;
      return { ...current, install: { ...current.install, [key]: value } };
    });
  };

  const updateRuntime = (changes: Partial<NonNullable<DeploymentProfile["runtime"]>>) => {
    setProfile((current) => {
      if (!current) return current;
      const previous = current.runtime;
      return {
        ...current,
        runtime: create(RuntimeConfigSchema, {
          memoryIncludeCache: changes.memoryIncludeCache ?? previous?.memoryIncludeCache,
          detailedGpu: changes.detailedGpu ?? previous?.detailedGpu,
          includeNics: changes.includeNics ?? previous?.includeNics ?? [],
          excludeNics: changes.excludeNics ?? previous?.excludeNics ?? [],
          includeMountpoints: changes.includeMountpoints ?? previous?.includeMountpoints ?? [],
          reportInterval: "reportInterval" in changes ? changes.reportInterval : previous?.reportInterval,
          trafficResetDay: "trafficResetDay" in changes ? changes.trafficResetDay : previous?.trafficResetDay,
        }),
      };
    });
  };

  const saveAndDispatch = async () => {
    if (!profile) return;
    stopActiveRequest();
    const controller = new AbortController();
    controllerRef.current = controller;
    setSaving(true);
    try {
      const runtime = create(RuntimeConfigSchema, {
        memoryIncludeCache: profile.runtime?.memoryIncludeCache ?? false,
        detailedGpu: profile.runtime?.detailedGpu ?? false,
        includeNics: profile.runtime?.includeNics ?? [],
        excludeNics: profile.runtime?.excludeNics ?? [],
        includeMountpoints: profile.runtime?.includeMountpoints ?? [],
        reportInterval: profile.runtime?.reportInterval,
        trafficResetDay: profile.runtime?.trafficResetDay,
      });
      const response = await connectUnary({ signal: controller.signal }, (signal, timeoutMs) =>
        deployment.saveDeploymentProfile(
          {
            agentId,
            profile: { ...profile, runtime },
            expectedRevision: delivery?.desiredRevision ?? 0n,
            forceDispatch: true,
          },
          { signal, timeoutMs },
        ),
      );
      if (!controller.signal.aborted) {
        setProfile(response.profile);
        setDelivery(response.delivery);
        toast.success("普通配置已保存并创建新的下发版本");
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        toast.error(error instanceof Error ? error.message : "保存并下发失败");
      }
    } finally {
      if (!controller.signal.aborted) setSaving(false);
    }
  };

  const install = profile?.install;
  const runtime = profile?.runtime;
  const nonPrivilegedRuntime =
    install?.runtimeIdentity === AgentRuntimeIdentity.SERVICE_ACCOUNT ||
    install?.runtimeIdentity === AgentRuntimeIdentity.CURRENT_USER;

  const isWindows =
    installedMode === PrivilegeMode.WINDOWS_ADMINISTRATOR ||
    installedMode === PrivilegeMode.WINDOWS_STANDARD_USER ||
    profile?.install?.platform === Platform.WINDOWS_AMD64 ||
    profile?.install?.platform === Platform.WINDOWS_386;

  const isCurrentlyPrivileged =
    installedMode === PrivilegeMode.LINUX_ROOT ||
    installedMode === PrivilegeMode.WINDOWS_ADMINISTRATOR;

  const isPrivilegedAccount =
    privDraft.requiredPrivilegeMode === PrivilegeMode.LINUX_ROOT ||
    privDraft.requiredPrivilegeMode === PrivilegeMode.WINDOWS_ADMINISTRATOR ||
    (privDraft.requiredPrivilegeMode === PrivilegeMode.UNSPECIFIED && isCurrentlyPrivileged);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger>
        <IconButton variant="ghost" title={title} aria-label={title}>
          <Download className={iconClassName} size="18" />
        </IconButton>
      </Dialog.Trigger>
      <Dialog.Content style={{ maxWidth: "760px", maxHeight: "90vh", overflowY: "auto" }}>
        <Dialog.Title>{title}</Dialog.Title>
        {loading || !profile ? (
          <Text color="gray">正在读取部署配置...</Text>
        ) : (
          <Flex direction="column" gap="5" mt="4">

            {/* ════════════════════════════════════════════════════════════════
                模块一：以下请到机器改（本地宿主静态配置 / 不可改变配置）
               ════════════════════════════════════════════════════════════════ */}
            <Flex direction="column" gap="3" className="rounded-lg border p-4 bg-[var(--gray-a1)]">
              <Flex align="center" gap="2">
                <Server size={18} className="text-gray-500" />
                <Text weight="bold" size="3">1. 以下请到机器改（本地宿主静态配置）</Text>
              </Flex>
              <Callout.Root color="gray" size="1">
                <Callout.Icon><AlertTriangle size={13} /></Callout.Icon>
                <Callout.Text>
                  说明：以下项主控严禁远程在线篡改。如需调整，请登录机器在本地 CLI 或配置文件中修改。
                </Callout.Text>
              </Callout.Root>

              <div className="grid gap-3 sm:grid-cols-2 text-sm bg-[var(--gray-a2)] p-3 rounded-md">
                <div>
                  <span className="text-gray-500">探针运行身份：</span>
                  <Text weight="medium">
                    {nonPrivilegedRuntime ? "专用非特权服务账号 (komari)" : "root / 管理员"}
                  </Text>
                </div>
                <div>
                  <span className="text-gray-500">安装目录：</span>
                  <code>{install?.installDirectory || "/opt/komari-agent"}</code>
                </div>
                <div>
                  <span className="text-gray-500">系统服务名称：</span>
                  <code>{install?.serviceName || "komari-agent.service"}</code>
                </div>
                <div>
                  <span className="text-gray-500">自动更新策略：</span>
                  <Text weight="medium">
                    {install?.disableAutoUpdate ? "已禁用自动更新" : "已启用自动更新"}
                  </Text>
                </div>
                <div>
                  <span className="text-gray-500">TLS 证书校验：</span>
                  <Text weight="medium">
                    {install?.ignoreUnsafeCertificate ? "允许自签名/不安全证书" : "严格校验 (TLS Validated)"}
                  </Text>
                </div>
                <div>
                  <span className="text-gray-500">连接协议：</span>
                  <Text weight="medium">Connect-RPC over HTTP/2</Text>
                </div>
              </div>

              <Flex direction="column" gap="1" mt="1">
                <Text size="1" color="gray">宿主机本地修改命令指引：</Text>
                <Flex gap="2" align="center">
                  <code style={{ fontFamily: "monospace", fontSize: "12px", background: "var(--gray-a3)", padding: "6px 10px", borderRadius: "4px", wordBreak: "break-all", flex: 1 }}>
                    komari-agent config show
                  </code>
                  <Button variant="soft" size="1" onClick={() => navigator.clipboard.writeText("komari-agent config show").then(() => toast.success("命令已复制"))}>
                    <Copy size={12} />复制
                  </Button>
                </Flex>
              </Flex>
            </Flex>

            {/* ════════════════════════════════════════════════════════════════
                模块二：以下作为特权配置下发（高危特权配置 / Privileged Track）
               ════════════════════════════════════════════════════════════════ */}
            <Flex direction="column" gap="3" className="rounded-lg border p-4 bg-[var(--gray-a1)]">
              <Flex align="center" gap="2">
                <Lock size={18} className="text-orange-500" />
                <Text weight="bold" size="3">2. 以下作为特权配置下发（高危特权配置）</Text>
              </Flex>
              <Text size="2" color="gray">
                远程控制、WebSSH、执行权限与应急救援等特权功能具有高危性。主控下发后需管理员 2FA 二次确认；跨权限级变更（如非特权服务升级为 root）需在目标机器终端执行提权命令核销。
              </Text>

              {/* 特权配置编辑表单 */}
              <Flex direction="column" gap="2" className="rounded border p-3 bg-[var(--gray-a2)]">
                <Text size="2" weight="medium">特权功能开关</Text>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Toggle
                    label="以特权账户运行 (root / 管理员)"
                    checked={isPrivilegedAccount}
                    onChange={(checked) => {
                      setPrivDraft((curr) => {
                        const nextMode = checked
                          ? (isWindows ? PrivilegeMode.WINDOWS_ADMINISTRATOR : PrivilegeMode.LINUX_ROOT)
                          : (isWindows ? PrivilegeMode.WINDOWS_STANDARD_USER : PrivilegeMode.LINUX_NON_ROOT);
                        if (!checked) {
                          return {
                            ...curr,
                            requiredPrivilegeMode: nextMode,
                            remoteControlEnabled: false,
                            websshEnabled: false,
                            executionEnabled: false,
                          };
                        }
                        return {
                          ...curr,
                          requiredPrivilegeMode: nextMode,
                        };
                      });
                    }}
                  />
                  <Toggle
                    label="远程控制总开关"
                    checked={privDraft.remoteControlEnabled && isPrivilegedAccount}
                    disabled={!isPrivilegedAccount}
                    onChange={(value) => {
                      setPrivDraft((current) => {
                        if (!value) {
                          return {
                            ...current,
                            remoteControlEnabled: false,
                            websshEnabled: false,
                            executionEnabled: false,
                          };
                        }
                        return {
                          ...current,
                          remoteControlEnabled: true,
                        };
                      });
                    }}
                  />
                  <Toggle
                    label="WebSSH 交互终端"
                    checked={privDraft.websshEnabled && privDraft.remoteControlEnabled && isPrivilegedAccount}
                    disabled={!privDraft.remoteControlEnabled || !isPrivilegedAccount}
                    onChange={(value) => setPrivDraft((current) => ({ ...current, websshEnabled: value }))}
                  />
                  <Toggle
                    label="远程命令执行"
                    checked={privDraft.executionEnabled && privDraft.remoteControlEnabled && isPrivilegedAccount}
                    disabled={!privDraft.remoteControlEnabled || !isPrivilegedAccount}
                    onChange={(value) => setPrivDraft((current) => ({ ...current, executionEnabled: value }))}
                  />
                  <Toggle label="应急救援辅助守护" checked={privDraft.rescueHelperEnabled} onChange={(value) => setPrivDraft((current) => ({ ...current, rescueHelperEnabled: value }))} />
                  <Toggle label="基础 GPU 采集 (enable_gpu)" checked={privDraft.enableGpu} onChange={(value) => setPrivDraft((current) => ({ ...current, enableGpu: value }))} />
                </div>
                <Flex align="center" gap="3" wrap="wrap" className="text-xs text-gray-500 pt-1">
                  <span>目标运行账户：</span>
                  <Badge color={isPrivilegedAccount ? "orange" : "gray"} size="1">
                    {isPrivilegedAccount ? `特权账户 (${isWindows ? "Windows Administrator" : "Linux root"})` : "专用普通服务账号 (komari)"}
                  </Badge>
                  <span>当前探针状态：</span>
                  <Badge color={isCurrentlyPrivileged ? "green" : "gray"} size="1">
                    {isCurrentlyPrivileged ? "已处于特权身份" : "处于非特权普通账号"}
                  </Badge>
                </Flex>
                <TextField.Root value={privReason} onChange={(event) => setPrivReason(event.target.value)} placeholder="变更原因（可选）" />
                <Flex justify="end">
                  <Button variant="soft" color="orange" disabled={savingPrivileged} onClick={() => void savePrivileged()}>
                    {savingPrivileged ? "正在保存..." : "保存特权配置"}
                  </Button>
                </Flex>
              </Flex>

              {/* 特权配置下发状态与审批流 */}
              <Flex direction="column" gap="2" className="rounded border p-3">
                <Flex justify="between" align="center" wrap="wrap" gap="2">
                  <Text size="2" weight="medium">特权配置下发状态</Text>
                  <Badge color={privRevision?.state === PrivilegedDeliveryState.DELIVERED ? "green" : "orange"} size="1">
                    {privilegedDeliveryText[privRevision?.state ?? PrivilegedDeliveryState.UNSPECIFIED]}
                  </Badge>
                </Flex>
                <Text size="2">期望版本：{privRevision?.revision?.toString() ?? "0"}；已应用版本：{privAppliedRevision.toString()}</Text>
                <Text size="2">保存：{toLocalTime(privRevision?.savedAt)}；确认：{toLocalTime(privRevision?.confirmedAt)}；完成：{toLocalTime(privRevision?.finishedAt)}</Text>
                {privRevision?.errors?.[0] && <Text size="2" color="red">{privRevision.errors[0].message}</Text>}

                {/* 待在宿主机执行升级的卡片 */}
                {pendingPriv?.plan?.manualTask && <InlineManualTaskCard task={pendingPriv.plan.manualTask} />}

                {/* 待面板二次确认的流程 */}
                {pendingPriv && (
                  <>
                    <Flex align="center" gap="2" wrap="wrap" mt="2" pt="2" style={{ borderTop: "1px solid var(--gray-a4)" }}>
                      <Text size="2" weight="medium">待处理特权变更 (r{pendingPriv.revision.toString()})</Text>
                      {pendingPriv.state === PrivilegedDeliveryState.NEEDS_CONFIRMATION && (
                        <Badge color="orange" size="1">需要面板二次确认</Badge>
                      )}
                      {pendingPriv.state === PrivilegedDeliveryState.NEEDS_MANUAL_AUTHORIZATION && (
                        <Badge color="orange" size="1">需要在机器上执行</Badge>
                      )}
                    </Flex>

                    {pendingPriv.privileged && (
                      <Flex direction="column" gap="1">
                        <PrivSettingRow label="远程控制" value={pendingPriv.privileged.remoteControlEnabled} />
                        <PrivSettingRow label="WebSSH" value={pendingPriv.privileged.websshEnabled} />
                        <PrivSettingRow label="远程执行" value={pendingPriv.privileged.executionEnabled} />
                        <PrivSettingRow label="救援辅助程序" value={pendingPriv.privileged.rescueHelperEnabled} />
                        <PrivSettingRow label="基础 GPU 采集" value={pendingPriv.privileged.enableGpu} />
                        <Flex gap="2" align="center">
                          <Text size="2" style={{ width: "120px" }} color="gray">特权账户运行</Text>
                          <Badge
                            color={
                              pendingPriv.privileged.requiredPrivilegeMode === PrivilegeMode.LINUX_ROOT ||
                              pendingPriv.privileged.requiredPrivilegeMode === PrivilegeMode.WINDOWS_ADMINISTRATOR
                                ? "orange"
                                : "gray"
                            }
                            size="1"
                          >
                            {pendingPriv.privileged.requiredPrivilegeMode === PrivilegeMode.LINUX_ROOT ||
                            pendingPriv.privileged.requiredPrivilegeMode === PrivilegeMode.WINDOWS_ADMINISTRATOR
                              ? "开启 (root / 管理员)"
                              : "关闭 (普通账户)"}
                          </Badge>
                        </Flex>
                      </Flex>
                    )}

                    {pendingPriv.state === PrivilegedDeliveryState.NEEDS_CONFIRMATION && (
                      <Flex direction="column" gap="2" mt="2">
                        <Callout.Root color="orange" size="1">
                          <Callout.Icon><AlertTriangle size={13} /></Callout.Icon>
                          <Callout.Text>确认将向机器派发此特权变更，请输入管理员 2FA 口令进行授权：</Callout.Text>
                        </Callout.Root>
                        <Flex gap="2" align="center" wrap="wrap">
                          <TextField.Root
                            type="password"
                            placeholder="6 位 2FA 动态口令"
                            value={twoFaCode}
                            onChange={(e) => setTwoFaCode(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") void confirmPriv(); }}
                          />
                          <Button onClick={() => void confirmPriv()} disabled={confirming || !twoFaCode.trim()}>
                            <CheckCircle2 size={14} />{confirming ? "确认中..." : "确认变更"}
                          </Button>
                        </Flex>
                      </Flex>
                    )}
                  </>
                )}

                {/* 最新生效的特权配置快照 */}
                {privRevision?.privileged && (
                  <Flex direction="column" gap="1" mt="2" pt="2" style={{ borderTop: "1px solid var(--gray-a4)" }}>
                    <Text size="1" color="gray" weight="medium">当前生效特权快照（r{privRevision.revision.toString()}）：</Text>
                    <PrivSettingRow label="远程控制" value={privRevision.privileged.remoteControlEnabled} />
                    <PrivSettingRow label="WebSSH" value={privRevision.privileged.websshEnabled} />
                    <PrivSettingRow label="远程执行" value={privRevision.privileged.executionEnabled} />
                    <PrivSettingRow label="救援辅助程序" value={privRevision.privileged.rescueHelperEnabled} />
                    <PrivSettingRow label="基础 GPU 采集" value={privRevision.privileged.enableGpu} />
                    <Flex gap="2" align="center">
                      <Text size="2" style={{ width: "120px" }} color="gray">特权账户运行</Text>
                      <Badge
                        color={
                          privRevision.privileged.requiredPrivilegeMode === PrivilegeMode.LINUX_ROOT ||
                          privRevision.privileged.requiredPrivilegeMode === PrivilegeMode.WINDOWS_ADMINISTRATOR
                            ? "green"
                            : "gray"
                        }
                        size="1"
                      >
                        {privRevision.privileged.requiredPrivilegeMode === PrivilegeMode.LINUX_ROOT ||
                        privRevision.privileged.requiredPrivilegeMode === PrivilegeMode.WINDOWS_ADMINISTRATOR
                          ? "开启 (root / 管理员)"
                          : "关闭 (普通账户)"}
                      </Badge>
                    </Flex>
                  </Flex>
                )}
              </Flex>
            </Flex>

            {/* ════════════════════════════════════════════════════════════════
                模块三：以下为普通配置下发（在线运行时配置 / Ordinary Track）
               ════════════════════════════════════════════════════════════════ */}
            <Flex direction="column" gap="3" className="rounded-lg border p-4 bg-[var(--gray-a1)]">
              <Flex align="center" gap="2">
                <SlidersHorizontal size={18} className="text-green-600" />
                <Text weight="bold" size="3">3. 以下为普通配置下发（在线运行时配置）</Text>
              </Flex>
              <Text size="2" color="gray">
                以下运行时参数支持热加载，主控下发后探针自动更新内存并持久化生效，无需人工审批或重启服务。
              </Text>

              <div className="grid gap-2 sm:grid-cols-2">
                <Toggle label="包含缓冲区/缓存内存" checked={runtime?.memoryIncludeCache ?? false} onChange={(value) => updateRuntime({ memoryIncludeCache: value })} />
                <Toggle label="启用详细 GPU 采集监控" checked={runtime?.detailedGpu ?? false} onChange={(value) => updateRuntime({ detailedGpu: value })} />
                <Toggle
                  label="从网卡获取 IP 地址"
                  checked={install?.getIpAddressFromNic ?? false}
                  onChange={(value) => updateInstall("getIpAddressFromNic", value)}
                />
              </div>

              <Flex direction="column" gap="2">
                <TextField.Root
                  defaultValue={runtime?.reportInterval ? String(Number(runtime.reportInterval.seconds) + runtime.reportInterval.nanos / 1_000_000_000) : ""}
                  placeholder="指标采集周期（秒，默认 1~3）"
                  onBlur={(event) => {
                    const milliseconds = intervalSeconds(event.target.value);
                    updateRuntime({ reportInterval: milliseconds ? durationFromMs(milliseconds) : undefined });
                  }}
                />
                <TextField.Root
                  defaultValue={runtime?.trafficResetDay ? String(runtime.trafficResetDay) : ""}
                  placeholder="流量重置日（1~31，0 为禁用）"
                  onBlur={(event) => {
                    const day = Number(event.target.value);
                    updateRuntime({ trafficResetDay: Number.isInteger(day) && day >= 1 && day <= 31 ? day : undefined });
                  }}
                />
                <TextField.Root
                  value={install?.githubProxy ?? ""}
                  placeholder="GitHub 代理镜像源（如 https://ghproxy.net/）"
                  onChange={(event) => {
                    updateInstall("githubProxy", event.target.value);
                    updateInstall("enableGithubProxy", event.target.value.trim() !== "");
                  }}
                />
                <TextField.Root defaultValue={listToText(runtime?.includeNics)} placeholder="监控网卡白名单（逗号分隔，留空监测所有网卡）" onBlur={(event) => updateRuntime({ includeNics: listFromText(event.target.value) })} />
                <TextField.Root defaultValue={listToText(runtime?.excludeNics)} placeholder="排除网卡黑名单（逗号分隔，如 lo, docker0）" onBlur={(event) => updateRuntime({ excludeNics: listFromText(event.target.value) })} />
                <TextField.Root defaultValue={listToText(runtime?.includeMountpoints)} placeholder="监控磁盘挂载点（逗号分隔，如 /, /data）" onBlur={(event) => updateRuntime({ includeMountpoints: listFromText(event.target.value) })} />
              </Flex>

              {/* 普通配置下发状态 */}
              <Flex direction="column" gap="1" className="rounded border p-3">
                <Flex justify="between" align="center" wrap="wrap" gap="2">
                  <Text size="2" weight="medium">普通配置下发状态</Text>
                  <Badge color={delivery?.state === DeliveryState.APPLIED ? "green" : "blue"} size="1">
                    {deliveryText[delivery?.state ?? DeliveryState.UNSPECIFIED]}
                  </Badge>
                </Flex>
                <Text size="2">期望版本：{delivery?.desiredRevision?.toString() ?? "0"}；已应用版本：{delivery?.appliedRevision?.toString() ?? "0"}</Text>
                <Text size="2">保存：{toLocalTime(delivery?.savedAt)}；发送：{toLocalTime(delivery?.sentAt)}；完成：{toLocalTime(delivery?.finishedAt)}</Text>
                {delivery?.error && <Text size="2" color="red">{delivery.error.message}</Text>}
                <Flex mt="2" pt="2" style={{ borderTop: "1px solid var(--gray-a4)" }} gap="2" align="center" wrap="wrap">
                  <Text size="1" color="gray">救援模式与性能诊断在独立页面操作。</Text>
                  <a href={`/admin/rescue?agent=${agentId}`} target="_blank" rel="noreferrer">
                    <Button variant="ghost" size="1">
                      <ShieldAlert size={12} />救援 / 诊断 →
                    </Button>
                  </a>
                </Flex>
              </Flex>

              <Flex justify="end">
                <Button disabled={saving} onClick={() => void saveAndDispatch()}>
                  <SlidersHorizontal size={14} />
                  {saving ? "正在保存..." : "保存并下发普通配置"}
                </Button>
              </Flex>
            </Flex>

          </Flex>
        )}
      </Dialog.Content>
    </Dialog.Root>
  );
}

function PrivSettingRow({ label, value }: { label: string; value: boolean | undefined }) {
  return (
    <Flex gap="2" align="center">
      <Text size="2" style={{ width: "120px" }} color="gray">{label}</Text>
      <Badge color={value ? "green" : "gray"} size="1">{value ? "开启" : "关闭"}</Badge>
    </Flex>
  );
}

function Toggle({ label, checked, disabled = false, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (value: boolean) => void }) {
  return (
    <Flex gap="2" align="center">
      <Checkbox checked={checked} disabled={disabled} onCheckedChange={(value) => onChange(Boolean(value))} />
      <Text size="2" color={disabled ? "gray" : undefined}>{label}</Text>
    </Flex>
  );
}
