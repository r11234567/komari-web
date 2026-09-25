import * as React from "react";
import { durationFromMs, timestampDate, type Timestamp } from "@bufbuild/protobuf/wkt";
import {
  type ConfigDelivery,
  type DeploymentProfile,
  Platform,
} from "@komari/proto/komari/deployment/v1/deployment_pb";
import {
  RuntimeConfigSchema,
  PrivilegedDeliveryState,
  type PrivilegedRevision,
} from "@komari/proto/komari/config/v1/config_pb";
import { DeliveryState, TwoFactorProofSchema } from "@komari/proto/komari/common/v1/common_pb";
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
  TextArea,
  TextField,
} from "@radix-ui/themes";
import { AlertTriangle, CheckCircle2, Clock, Copy, Download, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { connectUnary, connectClients } from "@/api/connect/client";
import { useConnect } from "@/contexts/ConnectContext";

type InstallPlatform = "linux" | "windows" | "macos";

const platformValue: Record<InstallPlatform, Platform> = {
  linux: Platform.LINUX_AMD64,
  windows: Platform.WINDOWS_AMD64,
  macos: Platform.DARWIN_AMD64,
};

const deliveryText: Record<DeliveryState, string> = {
  [DeliveryState.UNSPECIFIED]: "未知",
  [DeliveryState.SAVED]: "已保存",
  [DeliveryState.SENT]: "已下发",
  [DeliveryState.APPLIED]: "已应用",
  [DeliveryState.REJECTED]: "已拒绝",
  [DeliveryState.OFFLINE]: "Agent 离线",
  [DeliveryState.UPGRADE_REQUIRED]: "需要升级 Agent",
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

// ─── helpers shared with privileged state display ────────────────────────────

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
          {task.command && (
            <Flex gap="2" align="start">
              <code style={{ fontFamily: "monospace", fontSize: "12px", background: "var(--gray-a3)", padding: "6px 10px", borderRadius: "4px", wordBreak: "break-all", flex: 1 }}>
                {task.command}
              </code>
              <Button variant="soft" size="1" onClick={() => navigator.clipboard.writeText(task.command!).then(() => toast.success("命令已复制"))} title="复制命令">
                <Copy size={12} />复制
              </Button>
            </Flex>
          )}
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
  title = "一键部署",
  iconClassName,
}: AgentDeploymentDialogProps) {
  const { deployment } = useConnect();
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [profile, setProfile] = React.useState<DeploymentProfile>();
  const [delivery, setDelivery] = React.useState<ConfigDelivery>();
  const [platform, setPlatform] = React.useState<InstallPlatform>("linux");
  const [serviceAccount, setServiceAccount] = React.useState(false);
  const [command, setCommand] = React.useState("");

  // privileged delivery state
  const [privRevision, setPrivRevision] = React.useState<PrivilegedRevision | undefined>();
  const [pendingPriv, setPendingPriv] = React.useState<PrivilegedRevision | undefined>();
  const [twoFaCode, setTwoFaCode] = React.useState("");
  const [confirming, setConfirming] = React.useState(false);

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
        setPlatform(platformFromProfile(deployResp.profile?.install?.platform));
        const pending = privResp?.revisions?.find(
          (r) =>
            r.state === PrivilegedDeliveryState.NEEDS_CONFIRMATION ||
            r.state === PrivilegedDeliveryState.NEEDS_MANUAL_AUTHORIZATION,
        );
        setPendingPriv(pending);
        // Most recently applied revision — first one that isn't pending
        setPrivRevision(
          privResp?.revisions?.find(
            (r) =>
              r.state !== PrivilegedDeliveryState.NEEDS_CONFIRMATION &&
              r.state !== PrivilegedDeliveryState.NEEDS_MANUAL_AUTHORIZATION,
          ) ?? privResp?.revisions?.[0],
        );
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

  React.useEffect(() => {
    if (open) void load();
    else stopActiveRequest();
    return stopActiveRequest;
  }, [open, load]);

  const updateRuntime = (changes: Partial<NonNullable<DeploymentProfile["runtime"]>>) => {
    setProfile((current) => {
      if (!current) return current;
      const previous = current.runtime;
      return {
        ...current,
        runtime: create(RuntimeConfigSchema, {
          memoryIncludeCache:
            changes.memoryIncludeCache ?? previous?.memoryIncludeCache,
          detailedGpu: changes.detailedGpu ?? previous?.detailedGpu,
          includeNics: changes.includeNics ?? previous?.includeNics ?? [],
          excludeNics: changes.excludeNics ?? previous?.excludeNics ?? [],
          includeMountpoints:
            changes.includeMountpoints ?? previous?.includeMountpoints ?? [],
          reportInterval:
            "reportInterval" in changes
              ? changes.reportInterval
              : previous?.reportInterval,
          trafficResetDay:
            "trafficResetDay" in changes
              ? changes.trafficResetDay
              : previous?.trafficResetDay,
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
      // Deliberately construct only the seven online-dispatchable settings.
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
        toast.success("配置已保存并创建新的下发版本");
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        toast.error(error instanceof Error ? error.message : "保存并下发失败");
      }
    } finally {
      if (!controller.signal.aborted) setSaving(false);
    }
  };

  const generateCommand = async () => {
    // serviceAccount controls install identity:
    // true  → AgentRuntimeIdentity.SERVICE_ACCOUNT (专用非特权服务账号)
    // false → AgentRuntimeIdentity.ROOT_OR_ADMINISTRATOR
    stopActiveRequest();
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      const response = await connectUnary({ signal: controller.signal }, (signal, timeoutMs) =>
        deployment.generateInstallCommand(
          { agentId, platform: platformValue[platform] },
          { signal, timeoutMs },
        ),
      );
      if (!controller.signal.aborted) setCommand(response.command);
    } catch (error) {
      if (!controller.signal.aborted) {
        toast.error(error instanceof Error ? error.message : "生成安装指令失败");
      }
    }
  };

  const runtime = profile?.runtime;

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
            {/* ── privileged delivery state ── */}
            <Flex direction="column" gap="2">
              <Text weight="bold">以下特权配置需要下发后确认</Text>
              <Text size="2" color="gray">远程控制、WebSSH、执行权限、救援辅助程序等特权功能不能在线静默生效，每次变更需要面板二次确认，跨权限级变更还需在机器上执行。</Text>

              <Flex direction="column" gap="2" className="rounded border p-3">
                {/* current privileged settings */}
                {privRevision?.privileged ? (
                  <Flex direction="column" gap="1">
                    <Text size="1" color="gray" weight="medium">当前特权配置（r{privRevision.revision.toString()}）</Text>
                    <PrivSettingRow label="远程控制" value={privRevision.privileged.remoteControlEnabled} />
                    <PrivSettingRow label="WebSSH" value={privRevision.privileged.websshEnabled} />
                    <PrivSettingRow label="远程执行" value={privRevision.privileged.executionEnabled} />
                    <PrivSettingRow label="救援辅助程序" value={privRevision.privileged.rescueHelperEnabled} />
                  </Flex>
                ) : (
                  <Text size="1" color="gray">暂无特权配置记录。</Text>
                )}

                {pendingPriv && (
                  <>
                    <Flex align="center" gap="2" wrap="wrap" mt="2" pt="2" style={{ borderTop: "1px solid var(--gray-a4)" }}>
                      <Text size="2" weight="medium">待处理特权变更</Text>
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
                      </Flex>
                    )}

                    {pendingPriv.state === PrivilegedDeliveryState.NEEDS_CONFIRMATION && (
                      <>
                        <Callout.Root color="orange" size="1">
                          <Callout.Icon><AlertTriangle size={13} /></Callout.Icon>
                          <Callout.Text>确认将授权机器应用此特权变更。</Callout.Text>
                        </Callout.Root>
                        <Flex gap="2" align="center" wrap="wrap">
                          <TextField.Root
                            type="password"
                            placeholder="2FA 验证码"
                            value={twoFaCode}
                            onChange={(e) => setTwoFaCode(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") void confirmPriv(); }}
                          />
                          <Button onClick={() => void confirmPriv()} disabled={confirming || !twoFaCode.trim()}>
                            <CheckCircle2 size={14} />{confirming ? "确认中..." : "确认变更"}
                          </Button>
                        </Flex>
                      </>
                    )}

                    {pendingPriv.state === PrivilegedDeliveryState.NEEDS_MANUAL_AUTHORIZATION &&
                      pendingPriv.plan?.manualTask && (
                      <InlineManualTaskCard task={pendingPriv.plan.manualTask} />
                    )}
                  </>
                )}
              </Flex>
            </Flex>

            <Flex direction="column" gap="2">
              <Text weight="bold">以下配置将下发</Text>
              <Text size="2" color="gray">仅以下七项可在线生效。基础 GPU、远程控制和其它安装设置必须重新安装。</Text>
              <div className="grid gap-2 sm:grid-cols-2">
                <Toggle label="包含缓冲区内存" checked={runtime?.memoryIncludeCache ?? false} onChange={(value) => updateRuntime({ memoryIncludeCache: value })} />
                <Toggle label="启用详细 GPU 监控" checked={runtime?.detailedGpu ?? false} onChange={(value) => updateRuntime({ detailedGpu: value })} />
              </div>
              <TextField.Root defaultValue={listToText(runtime?.includeNics)} placeholder="只监测特定网卡，逗号分隔" onBlur={(event) => updateRuntime({ includeNics: listFromText(event.target.value) })} />
              <TextField.Root defaultValue={listToText(runtime?.excludeNics)} placeholder="排除特定网卡，逗号分隔" onBlur={(event) => updateRuntime({ excludeNics: listFromText(event.target.value) })} />
              <TextField.Root defaultValue={listToText(runtime?.includeMountpoints)} placeholder="只监测特定挂载点，逗号分隔" onBlur={(event) => updateRuntime({ includeMountpoints: listFromText(event.target.value) })} />
              <TextField.Root
                defaultValue={runtime?.reportInterval ? String(Number(runtime.reportInterval.seconds) + runtime.reportInterval.nanos / 1_000_000_000) : ""}
                placeholder="采集间隔（秒）"
                onBlur={(event) => {
                  const milliseconds = intervalSeconds(event.target.value);
                  updateRuntime({ reportInterval: milliseconds ? durationFromMs(milliseconds) : undefined });
                }}
              />
              <TextField.Root
                defaultValue={runtime?.trafficResetDay ? String(runtime.trafficResetDay) : ""}
                placeholder="流量重置日"
                onBlur={(event) => {
                  const day = Number(event.target.value);
                  updateRuntime({ trafficResetDay: Number.isInteger(day) && day >= 1 && day <= 31 ? day : undefined });
                }}
              />
            </Flex>

            <Flex direction="column" gap="1" className="rounded border p-3">
              <Text weight="bold">下发状态</Text>
              <Text size="2">期望版本：{delivery?.desiredRevision?.toString() ?? "0"}；已应用版本：{delivery?.appliedRevision?.toString() ?? "0"}</Text>
              <Text size="2">状态：{deliveryText[delivery?.state ?? DeliveryState.UNSPECIFIED]}</Text>
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

            <Flex direction="column" gap="2">
              <Text size="2" color="gray">Agent 运行身份（影响安装指令）</Text>
              <Flex gap="3">
                <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
                  <input type="radio" checked={!serviceAccount} onChange={() => setServiceAccount(false)} />
                  <Text size="2">root / 管理员</Text>
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
                  {/* AgentRuntimeIdentity.SERVICE_ACCOUNT — 专用非特权服务账号 */}
                  <input type="radio" checked={serviceAccount} onChange={() => setServiceAccount(true)} />
                  <Text size="2">专用非特权服务账号</Text>
                </label>
              </Flex>
            </Flex>

            <Flex gap="3" justify="end" wrap="wrap">
              <Button variant="soft" onClick={() => void generateCommand()}>生成安装指令</Button>
              <Button disabled={saving} onClick={() => void saveAndDispatch()}>{saving ? "正在保存..." : "保存并下发"}</Button>
            </Flex>
            {command && (
              <Flex direction="column" gap="2">
                <TextArea readOnly value={command} style={{ minHeight: "88px" }} />
                <Button variant="soft" onClick={() => void navigator.clipboard.writeText(command).then(() => toast.success("已复制安装指令"))}>
                  <Copy size="16" />复制安装指令
                </Button>
              </Flex>
            )}
          </Flex>
        )}
      </Dialog.Content>
    </Dialog.Root>
  );
}

function platformFromProfile(platform: Platform | undefined): InstallPlatform {
  if (platform === Platform.WINDOWS_AMD64 || platform === Platform.WINDOWS_386) return "windows";
  if (platform === Platform.DARWIN_AMD64 || platform === Platform.DARWIN_ARM64) return "macos";
  return "linux";
}

function PrivSettingRow({ label, value }: { label: string; value: boolean | undefined }) {
  return (
    <Flex gap="2" align="center">
      <Text size="2" style={{ width: "100px" }} color="gray">{label}</Text>
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
