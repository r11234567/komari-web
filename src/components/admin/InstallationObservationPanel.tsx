import { Button, Flex, Text } from "@radix-ui/themes";
import { Copy } from "lucide-react";
import { timestampDate, type Timestamp } from "@bufbuild/protobuf/wkt";
import type { InstallationObservation } from "@komari/proto/komari/report/v1/report_pb";
import { toast } from "sonner";
import { configQueryCommand, installationView } from "@/utils/deploymentObservation";

export function InstallationObservationPanel({ observation, receivedAt, error }: {
  observation?: InstallationObservation; receivedAt?: Timestamp; error?: string;
}) {
  const view = installationView(observation);
  const command = configQueryCommand(observation);
  const rows = [
    ["操作系统", view.operatingSystem], ["运行账号与权限", view.identity],
    ["Agent 可执行文件", view.executable], ["系统服务名称", view.serviceName],
    ["服务管理方式", view.initSystem], ["本地安装清单", view.manifest],
    ["本地配置文件", view.configFile], ["普通配置快照", view.runtimeFile],
    ["特权配置状态文件", view.privilegedFile], ["自动更新", view.updates],
    ["TLS 本地选项", view.tls], ["远控本地限制", view.remoteControl], ["Agent 上报的连接方式", view.transport],
  ];
  return <Flex direction="column" gap="3" className="rounded-lg border p-4">
    <Text weight="bold" size="3">1. Agent 最近上报的本机配置</Text>
    <Text size="2" color="gray">以下来自运行中的 Agent，仅供查看；修改需在目标机器本地完成。页面不会用部署模板推测当前安装状态。</Text>
    {error && <Text size="2" color="orange">读取节点基本信息失败：{error}</Text>}
    {!observation && <Text size="2" color="orange">尚未收到本机配置上报。旧版 Agent 不提供这些信息；更新后需等待一次基础信息上报。面板重启后也需等待新的上报。</Text>}
    {observation && <Text size="1" color="gray">最近一次上报，不代表持续实时查询。面板接收：{receivedAt ? timestampDate(receivedAt).toLocaleString() : "未记录"}；Agent 采集：{observation.observedAt ? timestampDate(observation.observedAt).toLocaleString() : "未上报"}</Text>}
    <div className="grid gap-3 sm:grid-cols-2 text-sm">
      {rows.map(([label, value]) => <div key={label} className="break-all"><span className="text-gray-500">{label}：</span><Text>{value}</Text></div>)}
    </div>
    <Text size="1" color="gray">本机配置查询（在目标机器管理员终端运行）：</Text>
    {command ? <Flex gap="2" align="center">
      <code className="break-all select-all text-xs">{command}</code>
      <Button variant="soft" size="1" onClick={() => void navigator.clipboard.writeText(command).then(() => toast.success("命令已复制")).catch(() => toast.error("复制失败，请手动选择命令"))}><Copy size={12} />复制</Button>
    </Flex> : <Text size="2" color="gray">可执行文件路径尚未上报，请在机器上找到已安装的 Agent，再运行 config show。</Text>}
  </Flex>;
}
