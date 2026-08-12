import * as React from "react";
import { create } from "@bufbuild/protobuf";
import { durationFromMs, timestampDate, type Timestamp } from "@bufbuild/protobuf/wkt";
import {
  AgentRuntimeIdentity,
  type ConfigDelivery,
  type DeploymentProfile,
  Platform,
  RescueInstallConfigSchema,
} from "@komari/proto/komari/deployment/v1/deployment_pb";
import { RuntimeConfigSchema } from "@komari/proto/komari/config/v1/config_pb";
import { DeliveryState } from "@komari/proto/komari/common/v1/common_pb";
import type { RescueHelperStatus } from "@komari/proto/komari/rescue/v1/rescue_pb";
import {
  Button,
  Checkbox,
  Dialog,
  Flex,
  IconButton,
  SegmentedControl,
  Text,
  TextArea,
  TextField,
} from "@radix-ui/themes";
import { Copy, Download } from "lucide-react";
import { toast } from "sonner";
import { connectUnary } from "@/api/connect/client";
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
  const [rescueHelper, setRescueHelper] = React.useState<RescueHelperStatus>();
  const [platform, setPlatform] = React.useState<InstallPlatform>("linux");
  const [command, setCommand] = React.useState("");
  const controllerRef = React.useRef<AbortController | null>(null);

  const stopActiveRequest = () => controllerRef.current?.abort();

  const load = React.useCallback(async () => {
    stopActiveRequest();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    try {
      const response = await connectUnary({ signal: controller.signal }, (signal, timeoutMs) =>
        deployment.getDeployment({ agentId }, { signal, timeoutMs }),
      );
      if (!controller.signal.aborted) {
        setProfile(response.profile);
        setDelivery(response.delivery);
        setRescueHelper(response.rescueHelper);
        setPlatform(platformFromProfile(response.profile?.install?.platform));
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
      return {
        ...current,
        runtime: create(RuntimeConfigSchema, { ...current.runtime, ...changes }),
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

  const install = profile?.install;
  const runtime = profile?.runtime;
  const remoteControlEnabled = install?.remoteControlEnabled ?? true;

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
            <Flex direction="column" gap="2">
              <Text weight="bold">安装配置（变更后需要重新安装 Agent）</Text>
              <SegmentedControl.Root
                value={platform}
                onValueChange={(value) => {
                  const selected = value as InstallPlatform;
                  setPlatform(selected);
                  updateInstall("platform", platformValue[selected]);
                }}
              >
                <SegmentedControl.Item value="linux">Linux</SegmentedControl.Item>
                <SegmentedControl.Item value="windows">Windows</SegmentedControl.Item>
                <SegmentedControl.Item value="macos">macOS</SegmentedControl.Item>
              </SegmentedControl.Root>
              <Text size="2" color="gray">普通 Agent 的运行身份</Text>
              <SegmentedControl.Root
                value={install?.runtimeIdentity === AgentRuntimeIdentity.CURRENT_USER ? "current-user" : "administrator"}
                onValueChange={(value) => updateInstall("runtimeIdentity", value === "current-user" ? AgentRuntimeIdentity.CURRENT_USER : AgentRuntimeIdentity.ROOT_OR_ADMINISTRATOR)}
              >
                <SegmentedControl.Item value="administrator">root / 管理员</SegmentedControl.Item>
                <SegmentedControl.Item value="current-user">当前用户（非管理员）</SegmentedControl.Item>
              </SegmentedControl.Root>
              <div className="grid gap-2 sm:grid-cols-2">
                <Toggle label="启用基础 GPU 采集" checked={install?.enableGpu ?? false} onChange={(value) => updateInstall("enableGpu", value)} />
                <Toggle label="启用远程控制" checked={remoteControlEnabled} onChange={(value) => updateInstall("remoteControlEnabled", value)} />
                <Toggle label="禁用 WebSSH" checked={install?.disableWebSsh ?? false} onChange={(value) => updateInstall("disableWebSsh", value)} />
                <Toggle label="禁用自动更新" checked={install?.disableAutoUpdate ?? false} onChange={(value) => updateInstall("disableAutoUpdate", value)} />
                <Toggle label="忽略不安全证书" checked={install?.ignoreUnsafeCertificate ?? false} onChange={(value) => updateInstall("ignoreUnsafeCertificate", value)} />
                <Toggle label="从网卡获取 IP" checked={install?.getIpAddressFromNic ?? false} onChange={(value) => updateInstall("getIpAddressFromNic", value)} />
              </div>
              {!remoteControlEnabled && (
                <Flex direction="column" gap="2" className="rounded border p-3">
                  <Toggle
                    label="启用紧急命令 / 救援模式"
                    checked={install?.rescue?.enabled ?? false}
                    onChange={(value) =>
                      updateInstall(
                        "rescue",
                        create(RescueInstallConfigSchema, {
                          enabled: value,
                          configureFirewall: value,
                        }),
                      )
                    }
                  />
                  {install?.rescue?.enabled && (
                    <Toggle
                      label="由救援辅助程序配置防火墙"
                      checked={install.rescue.configureFirewall}
                      onChange={(value) =>
                        updateInstall(
                          "rescue",
                          create(RescueInstallConfigSchema, {
                            ...install.rescue,
                            configureFirewall: value,
                          }),
                        )
                      }
                    />
                  )}
                  <Text size="2" color="gray">救援辅助程序独立以管理员权限运行；不启用时不会安装守护程序或修改防火墙。</Text>
                </Flex>
              )}
              <TextField.Root value={install?.installDirectory ?? ""} placeholder="安装目录" onChange={(event) => updateInstall("installDirectory", event.target.value)} />
              <TextField.Root value={install?.serviceName ?? ""} placeholder="服务名称" onChange={(event) => updateInstall("serviceName", event.target.value)} />
              <TextField.Root
                value={install?.githubProxy ?? ""}
                placeholder="GitHub 代理"
                onChange={(event) => {
                  updateInstall("githubProxy", event.target.value);
                  updateInstall("enableGithubProxy", event.target.value.trim() !== "");
                }}
              />
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
            </Flex>

            <Flex direction="column" gap="1" className="rounded border p-3">
              <Text weight="bold">救援辅助程序状态</Text>
              <Text size="2">
                请求安装：{rescueHelper?.requested ? "是" : "否"}；已安装：{rescueHelper?.installed ? "是" : "否"}；守护程序：{rescueHelper?.guardianRunning ? "运行中" : "未运行"}
              </Text>
              <Text size="2">
                辅助程序：{rescueHelper?.helperRunning ? "运行中" : "未运行"}；防火墙：{rescueHelper?.firewallConfigured ? "已配置" : "未配置"}
              </Text>
              {rescueHelper?.error && <Text size="2" color="red">{rescueHelper.error.message}</Text>}
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

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <Flex gap="2" align="center">
      <Checkbox checked={checked} onCheckedChange={(value) => onChange(Boolean(value))} />
      <Text size="2">{label}</Text>
    </Flex>
  );
}
