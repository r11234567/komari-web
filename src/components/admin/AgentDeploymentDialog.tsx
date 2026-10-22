import * as React from "react";
import { durationFromMs, timestampDate, type Timestamp } from "@bufbuild/protobuf/wkt";
import {
  AgentRuntimeIdentity,
  type ConfigDelivery,
  type DeploymentProfile,
} from "@komari/proto/komari/deployment/v1/deployment_pb";
import {
  RuntimeConfigSchema,
} from "@komari/proto/komari/config/v1/config_pb";
import { DeliveryState } from "@komari/proto/komari/common/v1/common_pb";
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
  Copy,
  Download,
  Server,
  ShieldAlert,
  SlidersHorizontal,
} from "lucide-react";
import { toast } from "sonner";
import { connectUnary } from "@/api/connect/client";
import { PrivilegedDeliveryPanel } from "./PrivilegedDeliveryPanel";
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

  const controllerRef = React.useRef<AbortController | null>(null);

  const stopActiveRequest = () => controllerRef.current?.abort();

  const load = React.useCallback(async () => {
    stopActiveRequest();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    try {
      const deployResp = await connectUnary({ signal: controller.signal }, (signal, timeoutMs) =>
        deployment.getDeployment({ agentId }, { signal, timeoutMs }),
      );
      if (!controller.signal.aborted) {
        setProfile(deployResp.profile);
        setDelivery(deployResp.delivery);
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        toast.error(error instanceof Error ? error.message : "读取部署配置失败");
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [agentId, deployment]);

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

            <PrivilegedDeliveryPanel agentId={agentId} />

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
                <Text size="2">保存：{toLocalTime(delivery?.savedAt)}；发送：{toLocalTime(delivery?.sentAt)}；最近处理完成：{toLocalTime(delivery?.finishedAt)}</Text>
                <Text size="1" color="gray">时间为面板记录的配置处理回执；升级安装不会清除已有配置和历史时间。</Text>
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

function Toggle({ label, checked, disabled = false, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (value: boolean) => void }) {
  return (
    <Flex gap="2" align="center">
      <Checkbox checked={checked} disabled={disabled} onCheckedChange={(value) => onChange(Boolean(value))} />
      <Text size="2" color={disabled ? "gray" : undefined}>{label}</Text>
    </Flex>
  );
}
