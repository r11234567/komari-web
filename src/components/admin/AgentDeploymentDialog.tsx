import * as React from "react";
import { durationFromMs, timestampDate, type Timestamp } from "@bufbuild/protobuf/wkt";
import {
  type ConfigDelivery,
  type DeploymentProfile,
} from "@komari/proto/komari/deployment/v1/deployment_pb";
import {
  RuntimeConfigSchema,
} from "@komari/proto/komari/config/v1/config_pb";
import { DeliveryState } from "@komari/proto/komari/common/v1/common_pb";
import type { InstallationObservation } from "@komari/proto/komari/report/v1/report_pb";
import { create } from "@bufbuild/protobuf";
import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  Flex,
  IconButton,
  Text,
  TextField,
} from "@radix-ui/themes";
import {
  Download,
  ShieldAlert,
  SlidersHorizontal,
} from "lucide-react";
import { toast } from "sonner";
import { connectUnary } from "@/api/connect/client";
import { PrivilegedDeliveryPanel } from "./PrivilegedDeliveryPanel";
import { InstallationObservationPanel } from "./InstallationObservationPanel";
import { acceptDelivery, runtimeDraft } from "@/utils/deploymentObservation";
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
  return Number.isFinite(parsed) && parsed >= 1 && parsed <= 300 ? Math.round(parsed * 1000) : undefined;
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
  const { deployment, browser } = useConnect();
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [profile, setProfile] = React.useState<DeploymentProfile>();
  const [delivery, setDelivery] = React.useState<ConfigDelivery>();
  const [installation, setInstallation] = React.useState<InstallationObservation>();
  const [receivedAt, setReceivedAt] = React.useState<Timestamp>();
  const [reportedOS, setReportedOS] = React.useState("");
  const [nodeInfoError, setNodeInfoError] = React.useState("");
  const [loadedRevision, setLoadedRevision] = React.useState(0n);
  const [refreshError, setRefreshError] = React.useState("");
  const [loadError, setLoadError] = React.useState("");

  const controllerRef = React.useRef<AbortController | null>(null);

  const stopActiveRequest = () => controllerRef.current?.abort();

  const load = React.useCallback(async () => {
    stopActiveRequest();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    setLoadError("");
    try {
      const [deployResult, nodeResult] = await Promise.allSettled([
        connectUnary({ signal: controller.signal }, (signal, timeoutMs) => deployment.getDeployment({ agentId }, { signal, timeoutMs })),
        connectUnary({ signal: controller.signal }, (signal, timeoutMs) => browser.getAgent({ agentId }, { signal, timeoutMs })),
      ]);
      if (deployResult.status === "rejected") throw deployResult.reason;
      const deployResp = deployResult.value;
      if (!controller.signal.aborted) {
        setProfile(deployResp.profile);
        setDelivery(deployResp.delivery);
        setLoadedRevision(deployResp.delivery?.desiredRevision ?? 0n);
        setInstallation(deployResp.installation);
        setReceivedAt(deployResp.installationReceivedAt);
        setReportedOS(deployResp.installation?.operatingSystem || (nodeResult.status === "fulfilled" ? nodeResult.value.agent?.basicInfo?.os : "") || "");
        setNodeInfoError(nodeResult.status === "rejected" ? String(nodeResult.reason) : "");
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setLoadError(error instanceof Error ? error.message : "读取部署配置失败");
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [agentId, deployment, browser]);

  React.useEffect(() => {
    setLoadError(""); setRefreshError(""); setProfile(undefined); setDelivery(undefined); setInstallation(undefined); setReceivedAt(undefined); setReportedOS(""); setNodeInfoError("");
    if (open) void load();
    else stopActiveRequest();
    return stopActiveRequest;
  }, [open, load]);

  React.useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    let pending = false;
    const timer = window.setInterval(() => {
      if (pending) return;
      pending = true;
      void connectUnary({ signal: controller.signal }, (signal, timeoutMs) =>
        deployment.getDeployment({ agentId }, { signal, timeoutMs })).then((response) => {
        if (controller.signal.aborted) return;
        // Refresh observations/status without replacing unsaved runtime edits.
        setInstallation(response.installation); setReceivedAt(response.installationReceivedAt);
        if (response.installation?.operatingSystem) setReportedOS(response.installation.operatingSystem);
        setDelivery((current) => acceptDelivery(current, response.delivery) ? response.delivery : current); setRefreshError("");
      }).catch((error: unknown) => {
        if (!controller.signal.aborted) setRefreshError(error instanceof Error ? error.message : "状态刷新失败");
      }).finally(() => { pending = false; });
    }, 5_000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [open, agentId, deployment]);

  const updateRuntime = (changes: Partial<NonNullable<DeploymentProfile["runtime"]>>) => {
    setProfile((current) => {
      if (!current) return current;
      return {
        ...current,
        runtime: create(RuntimeConfigSchema, runtimeDraft(current.runtime, changes)),
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
      const runtime = create(RuntimeConfigSchema, runtimeDraft(profile.runtime));
      const response = await connectUnary({ signal: controller.signal }, (signal, timeoutMs) =>
        deployment.saveDeploymentProfile(
          {
            agentId,
            profile: { agentId, runtime },
            expectedRevision: loadedRevision,
            forceDispatch: true,
          },
          { signal, timeoutMs },
        ),
      );
      if (!controller.signal.aborted) {
        setProfile(response.profile);
        setDelivery(response.delivery);
        setLoadedRevision(response.delivery?.desiredRevision ?? 0n);
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
        {loadError ? (
          <Flex direction="column" gap="2"><Text color="red">读取配置失败：{loadError}</Text><Button onClick={() => void load()}>重试</Button></Flex>
        ) : loading || !profile ? (
          <Text color="gray">正在读取部署配置...</Text>
        ) : (
          <Flex direction="column" gap="5" mt="4">

            <InstallationObservationPanel observation={installation} receivedAt={receivedAt} error={nodeInfoError} />

            <PrivilegedDeliveryPanel agentId={agentId} operatingSystem={reportedOS} />

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
                  checked={runtime?.getIpAddrFromNic ?? false}
                  onChange={(value) => updateRuntime({ getIpAddrFromNic: value })}
                />
              </div>

              <Flex direction="column" gap="2">
                <TextField.Root
                  defaultValue={runtime?.reportInterval ? String(Number(runtime.reportInterval.seconds) + runtime.reportInterval.nanos / 1_000_000_000) : ""}
                  placeholder="指标采集周期（1~300 秒）"
                  onBlur={(event) => {
                    const milliseconds = intervalSeconds(event.target.value);
                    updateRuntime({ reportInterval: milliseconds ? durationFromMs(milliseconds) : undefined });
                  }}
                />
                <TextField.Root
                  defaultValue={runtime?.trafficResetDay !== undefined ? String(runtime.trafficResetDay) : ""}
                  placeholder="流量重置日（1~31，0 为禁用）"
                  onBlur={(event) => {
                    const day = Number(event.target.value);
                    updateRuntime({ trafficResetDay: event.target.value.trim() !== "" && Number.isInteger(day) && day >= 0 && day <= 31 ? day : undefined });
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
                {refreshError && <Text size="2" color="orange">状态刷新失败，当前显示最近一次结果：{refreshError}</Text>}
                {delivery && delivery.desiredRevision !== loadedRevision && <Text size="2" color="orange">面板配置版本已变化，请重新打开此窗口后再编辑，避免覆盖其他修改。</Text>}
                <Text size="2">保存：{toLocalTime(delivery?.savedAt)}；发送：{toLocalTime(delivery?.sentAt)}；最近处理完成：{toLocalTime(delivery?.finishedAt)}</Text>
                <Text size="1" color="gray">时间为面板记录的配置处理回执；升级安装不会清除已有配置和历史时间。</Text>
                {delivery?.error && <Text size="2" color="red">{delivery.error.message}</Text>}
                {delivery?.error?.message.includes("same runtime revision has different content") && <Text size="2" color="orange">本地快照与面板同版本内容不一致，继续保留本地配置。请核对表单后点击“保存并下发普通配置”创建新版本，无需重装或重新绑定。</Text>}
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
                <Button disabled={saving || !!delivery && delivery.desiredRevision !== loadedRevision} onClick={() => void saveAndDispatch()}>
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
