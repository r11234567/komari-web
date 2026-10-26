import React, { useState } from "react";
import { TrafficSettingsDialog } from "@/components/admin/TrafficSettingsDialog";
import {
  NodeDetailsProvider,
  useNodeDetails,
  type NodeDetail,
} from "@/contexts/NodeDetailsContext";
import {
  Flex,
  TextField,
  Button,
  Checkbox,
  Text,
  Dialog,
  IconButton,
  TextArea,
  SegmentedControl,
  Callout,
} from "@radix-ui/themes";
import {
  CircleDollarSign,
  Copy,
  CornerRightUp,
  Info,
  MenuIcon,
  Pencil,
  Plus,
  Terminal,
  Trash2Icon,
  UserPlus,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  DndContext,
  closestCenter,
  useSensor,
  useSensors,
  TouchSensor,
  MouseSensor,
  KeyboardSensor,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { toast } from "sonner";
import Flag from "@/components/Flag";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { formatBytes, stringToBytes } from "@/utils/unitHelper";
import PriceTags from "@/components/PriceTags";
import Loading from "@/components/loading";
import Tips from "@/components/ui/tips";
import {
  SettingCardCollapse,
  SettingCardSelect,
  SettingCardShortTextInput,
  SettingCardSwitch,
} from "@/components/admin/SettingCard";
import { useSettings } from "@/lib/api";
import { SelectOrInput } from "@/components/ui/select-or-input";
import { AgentDeploymentDialog } from "@/components/admin/AgentDeploymentDialog";


const NodeDetailsPage = () => {
  return (
    <NodeDetailsProvider>
      <Layout />
    </NodeDetailsProvider>
  );
};

const Layout = () => {
  const { nodeDetail, isLoading, error } = useNodeDetails();
  const { settings, loading: settingsLoading } = useSettings();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedNodes, setSelectedNodes] = useState<string[]>([]);
  const filteredNodes = Array.isArray(nodeDetail)
    ? nodeDetail
        .filter((node) =>
          node.name.toLowerCase().includes(searchTerm.toLowerCase())
        )
        .sort((a, b) => a.weight - b.weight)
    : [];

  if (isLoading && (!nodeDetail || nodeDetail.length === 0)) return <Loading text="" />;
  if (error && (!nodeDetail || nodeDetail.length === 0)) return <div>{error}</div>;

  const isEmpty = Array.isArray(nodeDetail) && nodeDetail.length === 0;

  return (
    <Flex direction="column" gap="4" p="4" className="km-page-admin-index">
      <Header
        searchTerm={searchTerm}
        setSearchTerm={setSearchTerm}
        selectedNodes={selectedNodes}
        settings={settings}
        settingsLoading={settingsLoading}
      />

      {isEmpty ? (
        <EmptyNodesGuide />
      ) : (
        <NodeTable
          nodes={filteredNodes}
          selectedNodes={selectedNodes}
          setSelectedNodes={setSelectedNodes}
        />
      )}
    </Flex>
  );
};

const EmptyNodesGuide = () => {
  const { t } = useTranslation();
  return (
    <Flex
      direction="column"
      align="end"
      justify="start"
      style={{ minHeight: "60vh" }}
      pr="2"
      pt="1"
    >
      {/* 回转箭头指向右上角的“添加节点”按钮 */}
      <CornerRightUp
        size={72}
        strokeWidth={1.25}
        className="text-[var(--accent-9)] animate-bounce"
        style={{ marginRight: "1.5rem" }}
      />
      <Flex direction="column" align="end" gap="1" mt="2" mr="2">
        <Text size="4" weight="bold">
          {t("admin.nodeTable.emptyGuide.title", "还没有任何服务器")}
        </Text>
        <Text size="2" color="gray" align="right" style={{ maxWidth: "20rem" }}>
          {t(
            "admin.nodeTable.emptyGuide.description",
            "点击右上角的“添加节点”获取安装命令并接入服务器。"
          )}
        </Text>
      </Flex>
    </Flex>
  );
};

const AgentInstallScripts = ({ settings }: { settings: any }) => {
  const { t } = useTranslation();
  const [platform, setPlatform] = useState<"linux" | "macos" | "windows">("linux");

  const endpoint = React.useMemo(() => {
    if (!settings?.script_domain) {
      return typeof window !== "undefined" ? window.location.origin : "https://panel.example.com";
    }
    const domain = String(settings.script_domain).trim();
    if (domain.startsWith("http://") || domain.startsWith("https://")) {
      return domain.replace(/\/+$/, "");
    }
    return `http://${domain.replace(/\/+$/, "")}`;
  }, [settings?.script_domain]);

  const command = React.useMemo(() => {
    switch (platform) {
      case "linux":
        return `curl -fsSL 'https://raw.githubusercontent.com/r11234567/komari-agent/main/install.sh' | sudo bash -s -- -e "${endpoint}"`;
      case "macos":
        return `curl -fsSL 'https://raw.githubusercontent.com/r11234567/komari-agent/main/install.sh' | sudo bash -s -- -e "${endpoint}"`;
      case "windows":
        return `$script = irm 'https://raw.githubusercontent.com/r11234567/komari-agent/main/install.ps1'; & ([scriptblock]::Create($script)) -e "${endpoint}"`;
    }
  }, [platform, endpoint]);

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(command);
      toast.success(t("copy_success", "已复制到剪贴板"));
    } catch {
      toast.error("复制失败，请手动选择复制");
    }
  };

  return (
    <Flex direction="column" gap="3" mt="2">
      <Text size="2" color="gray">
        在目标服务器上运行对应的安装命令，探针将自动配置连接并以最小特权账号运行。
      </Text>

      <SegmentedControl.Root
        value={platform}
        onValueChange={(val) => setPlatform(val as "linux" | "macos" | "windows")}
      >
        <SegmentedControl.Item value="linux">Linux</SegmentedControl.Item>
        <SegmentedControl.Item value="macos">macOS</SegmentedControl.Item>
        <SegmentedControl.Item value="windows">Windows</SegmentedControl.Item>
      </SegmentedControl.Root>

      <Flex direction="column" gap="1">
        <Text size="1" weight="medium" color="gray">
          {platform === "windows" ? "管理员 PowerShell 一键安装命令" : "一键安全安装命令"}
        </Text>
        <div
          style={{
            fontFamily: "monospace",
            fontSize: "12px",
            background: "var(--gray-a3)",
            padding: "10px 12px",
            borderRadius: "6px",
            wordBreak: "break-all",
            whiteSpace: "pre-wrap",
            lineHeight: 1.5,
          }}
        >
          {command}
        </div>
      </Flex>

      <Button variant="solid" onClick={() => void copyToClipboard()}>
        <Copy size={16} />
        {t("common.copy", "复制安装命令")}
      </Button>

      <Callout.Root color="blue" size="1">
        <Callout.Icon>
          <Info size={14} />
        </Callout.Icon>
        <Callout.Text>
          安装完成后，探针输出的一次性验证链接可在下方「添加机器向导」中进行授权绑定。
        </Callout.Text>
      </Callout.Root>
    </Flex>
  );
};

const Header = ({
  searchTerm,
  setSearchTerm,
  selectedNodes,
  settings,
}: {
  searchTerm: string;
  setSearchTerm: (term: string) => void;
  selectedNodes: string[];
  settings: any;
  settingsLoading: boolean;
}) => {
  const { t } = useTranslation();
  const [dialogOpen, setDialogOpen] = useState(false);
  return (
    <Flex justify="between" align="center" gap="4" wrap="wrap">
      <Flex gap="2" align="center">
        <Text size="5" weight="bold">
          {t("admin.nodeTable.nodeList")}
        </Text>
        {selectedNodes.length > 0 && (
          <Text size="2">({selectedNodes.length} selected)</Text>
        )}
      </Flex>
      <Flex gap="2">
        <TextField.Root
          placeholder={t("admin.nodeTable.searchByName")}
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
        <Dialog.Root open={dialogOpen} onOpenChange={setDialogOpen}>
          <Dialog.Trigger>
            <Button onClick={() => setDialogOpen(true)}>
              <Plus size={16} />
              {t("admin.nodeTable.addNode", "添加节点")}
            </Button>
          </Dialog.Trigger>
          <Dialog.Content style={{ maxWidth: "560px" }}>
            <Dialog.Title>{t("admin.nodeTable.addNode", "添加节点")}</Dialog.Title>
            <AgentInstallScripts settings={settings} />
            <Flex
              mt="4"
              pt="3"
              style={{ borderTop: "1px solid var(--gray-a5)" }}
              justify="between"
              align="center"
              wrap="wrap"
              gap="2"
            >
              <Flex direction="column" gap="1">
                <Text size="2" weight="medium">零信任设备授权入网</Text>
                <Text size="1" color="gray">
                  已在机器生成 8 位验证码？前往向导完成绑定。
                </Text>
              </Flex>
              <Button
                variant="soft"
                size="2"
                onClick={() => {
                  window.open("/bind", "_blank", "noopener,noreferrer");
                  setDialogOpen(false);
                }}
              >
                <UserPlus size={14} />
                添加机器向导
              </Button>
            </Flex>
          </Dialog.Content>
        </Dialog.Root>
      </Flex>
    </Flex>
  );
};

const SortableRow = ({
  node,
  selectedNodes,
  handleSelectNode,
}: {
  node: NodeDetail;
  selectedNodes: string[];
  handleSelectNode: (uuid: string, checked: boolean) => void;
}) => {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: node.uuid });
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  function copy(text: string) {
    navigator.clipboard.writeText(text);
    toast.success(t("copy_success"));
  }
  return (
    <TableRow ref={setNodeRef} style={style} className="hover:bg-accent-a2">
      <TableCell>
        <div
          {...attributes}
          {...listeners}
          className={`cursor-move p-2 rounded hover:bg-accent-a3 transition-colors ${
            isMobile ? "touch-manipulation select-none" : ""
          }`}
          style={{
            touchAction: "none", // 禁用移动端的默认手势
            WebkitUserSelect: "none",
            userSelect: "none",
          }}
          title={
            isMobile
              ? t("admin.nodeTable.dragToReorder", "长按拖拽重新排序")
              : undefined
          }
        >
          <MenuIcon size={isMobile ? 18 : 16} color={"var(--gray-8)"} />
        </div>
      </TableCell>
      <TableCell>
        <Checkbox
          checked={selectedNodes.includes(node.uuid)}
          onCheckedChange={(checked) => handleSelectNode(node.uuid, !!checked)}
        />
      </TableCell>
      <TableCell>
        <DetailView node={node} />
      </TableCell>
      <TableCell>
        <Flex direction="column">
          {node.ipv4 && (
            <Text size="2" className="flex items-center gap-1">
              {node.ipv4}
              <IconButton variant="ghost" onClick={() => copy(node.ipv4)}>
                <Copy size="16" />
              </IconButton>
            </Text>
          )}
          {node.ipv6 && (
            <Text
              size="2"
              className="flex items-center gap-1"
              title={node.ipv6}
            >
              {node.ipv6.length > 20
                ? (() => {
                    const segments = node.ipv6.split(":");
                    return segments.length > 3
                      ? `${segments.slice(0, 2).join(":")}:...${
                          segments[segments.length - 1]
                        }`
                      : node.ipv6;
                  })()
                : node.ipv6}
              <IconButton variant="ghost" onClick={() => copy(node.ipv6)}>
                <Copy size="16" />
              </IconButton>
            </Text>
          )}
        </Flex>
      </TableCell>
      <TableCell>{node.version}</TableCell>
      <TableCell>
        <Text
          size="2"
          title={node.group}
          style={{
            maxWidth: "150px",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {node.group && node.group.length > 10
            ? `${node.group.slice(0, 10)}...`
            : node.group}
        </Text>
      </TableCell>
      <TableCell>
        <Text
          size="2"
          title={node.remark}
          style={{
            maxWidth: "150px",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {node.remark && node.remark.length > 10
            ? `${node.remark.slice(0, 10)}...`
            : node.remark}
        </Text>
      </TableCell>
      <TableCell>
        <PriceTags
          price={node.price}
          billing_cycle={node.billing_cycle}
          expired_at={node.expired_at}
          currency={node.currency}
          tags={node.tags || ""}
        />
      </TableCell>
      <TableCell>
        <ActionButtons node={node} />
      </TableCell>
    </TableRow>
  );
};

const NodeTable = ({
  nodes,
  selectedNodes,
  setSelectedNodes,
}: {
  nodes: NodeDetail[];
  selectedNodes: string[];
  setSelectedNodes: (nodes: string[]) => void;
}) => {
  const { t } = useTranslation();
  const sensors = useSensors(
    useSensor(MouseSensor, {
      // 需要按住 10px 距离才开始拖拽，避免与点击冲突
      activationConstraint: {
        distance: 10,
      },
    }),
    useSensor(TouchSensor, {
      // 移动端需要按住 5px 距离才开始拖拽，并且延迟 200ms，避免与滚动冲突
      activationConstraint: {
        delay: 200,
        tolerance: 5,
      },
    }),
    useSensor(KeyboardSensor, {})
  );
  // 添加 localNodes 状态，实现即时 UI 更新
  const [localNodes, setLocalNodes] = useState<NodeDetail[]>(nodes);
  const [isDragging, setIsDragging] = useState(false);
  React.useEffect(() => {
    setLocalNodes(nodes);
  }, [nodes]);
  const handleDragStart = () => {
    setIsDragging(true);
    if ("vibrate" in navigator) {
      navigator.vibrate(50);
    }
  };

  const handleDragEnd = async (event: any) => {
    setIsDragging(false);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = localNodes.findIndex((node) => node.uuid === active.id);
    const newIndex = localNodes.findIndex((node) => node.uuid === over.id);
    const reorderedNodes = Array.from(localNodes);
    const [reorderedItem] = reorderedNodes.splice(oldIndex, 1);
    reorderedNodes.splice(newIndex, 0, reorderedItem);

    // 立即更新 UI
    setLocalNodes(reorderedNodes);

    if ("vibrate" in navigator) {
      navigator.vibrate([30, 10, 30]);
    }

    try {
      const orderData = reorderedNodes.reduce((acc, node, index) => {
        acc[node.uuid] = index;
        return acc;
      }, {} as Record<string, number>);

      await fetch("/api/admin/client/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(orderData),
      });
      // 不再调用 refresh，以免覆盖本地排序
    } catch {
      toast.error(t("admin.nodeTable.errorRefreshNodeList"));
    }
  };

  // 更新全选逻辑，使用 localNodes
  const handleSelectAll = (checked: boolean) => {
    setSelectedNodes(checked ? localNodes.map((node) => node.uuid) : []);
  };

  const handleSelectNode = (uuid: string, checked: boolean) => {
    setSelectedNodes(
      checked
        ? [...selectedNodes, uuid]
        : selectedNodes.filter((id) => id !== uuid)
    );
  };
  return (
    <div
      className={`rounded-md overflow-hidden ${
        isDragging ? "select-none" : ""
      }`}
    >
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <Table>
          <TableHeader style={{ backgroundColor: "var(--accent-4)" }}>
            <TableRow>
              <TableHead></TableHead>
              <TableHead>
                <Checkbox
                  checked={
                    selectedNodes.length === localNodes.length &&
                    localNodes.length > 0
                  }
                  onCheckedChange={handleSelectAll}
                />
              </TableHead>
              <TableHead>{t("admin.nodeTable.name")}</TableHead>
              <TableHead>{t("admin.nodeDetail.ipAddress")}</TableHead>
              <TableHead>{t("admin.nodeDetail.clientVersion")}</TableHead>
              <TableHead>{t("common.group")}</TableHead>
              <TableHead>{t("admin.nodeEdit.remark")}</TableHead>
              <TableHead>{t("admin.nodeTable.billing")}</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <SortableContext
              items={localNodes.map((node) => node.uuid)}
              strategy={verticalListSortingStrategy}
            >
              {localNodes.map((node) => (
                <SortableRow
                  key={node.uuid}
                  node={node}
                  selectedNodes={selectedNodes}
                  handleSelectNode={handleSelectNode}
                />
              ))}
            </SortableContext>
          </TableBody>
        </Table>
      </DndContext>
    </div>
  );
};

const ActionButtons = ({ node }: { node: NodeDetail }) => {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-4">
      <AgentDeploymentDialog agentId={node.uuid} title="配置下发" />
      <TrafficSettingsDialog uuid={node.uuid} name={node.name} />
      <IconButton
        title={t("terminal.title")}
        variant="ghost"
        onClick={() => {
          window.open(`/terminal?uuid=${node.uuid}`, "_blank");
        }}
      >
        <Terminal size="18" />
      </IconButton>
      <EditButton node={node} />
      <BillingButton node={node} />
      <DeleteButton node={node} />
    </div>
  );
};

export default NodeDetailsPage;
function DeleteButton({ node }: { node: NodeDetail }) {
  const { t } = useTranslation();
  const { refresh } = useNodeDetails();
  const [open, setOpen] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const handleDelete = async () => {
    try {
      setDeleting(true);
      await fetch(`/api/admin/client/${node.uuid}/remove`, {
        method: "POST",
      });
      toast.success(`Delete ${node.name}`);
      setOpen(false);
      refresh();
    } catch (error) {
      toast.error(
        `Error: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      setDeleting(false);
    }
  };
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger>
        <IconButton variant="ghost" color="red" title={t("common.delete")}>
          <Trash2Icon size="18" />
        </IconButton>
      </Dialog.Trigger>
      <Dialog.Content>
        <Dialog.Title>{t("common.delete")}</Dialog.Title>
        <Dialog.Description>
          {t("common.confirm_delete")}
        </Dialog.Description>
        <Flex justify="end" gap="2" mt="4">
          <Dialog.Trigger>
            <Button variant="soft">{t("common.cancel")}</Button>
          </Dialog.Trigger>
          <Button disabled={deleting} color="red" onClick={handleDelete}>
            {t("common.confirm_delete")}
          </Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
function EditButton({ node }: { node: NodeDetail }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { refresh } = useNodeDetails();
  const nameRef = React.useRef<HTMLInputElement>(null);
  const groupRef = React.useRef<HTMLInputElement>(null);
  const tagsRef = React.useRef<HTMLInputElement>(null);
  const publicRemarkRef = React.useRef<HTMLTextAreaElement>(null);
  const privateRemarkRef = React.useRef<HTMLTextAreaElement>(null);
  const [hidden, setHidden] = useState(false);
  const [saving, setSaving] = useState(false);
  const [traffic_limit, setTrafficLimit] = useState(0);
  const [traffic_limit_type, setTrafficLimitType] = useState("sum");

  React.useEffect(() => {
    setHidden(node.hidden);
    setTrafficLimit(node.traffic_limit || 0);
    setTrafficLimitType(node.traffic_limit_type || "sum");
  }, [node.hidden, node.traffic_limit, node.traffic_limit_type]);

  const save = async () => {
    try {
      setSaving(true);
      await fetch(`/api/admin/client/${node.uuid}/edit`, {
        method: "POST",
        body: JSON.stringify({
          name: nameRef.current?.value,
          remark: privateRemarkRef.current?.value,
          public_remark: publicRemarkRef.current?.value,
          group: groupRef.current?.value,
          tags: tagsRef.current?.value,
          hidden,
          traffic_limit,
          traffic_limit_type,
        }),
        headers: {
          "Content-Type": "application/json",
        },
      });
      refresh();
      setOpen(false);
      toast.success(t("admin.nodeEdit.saveSuccess", "保存成功"));
    } catch (error) {
      console.error("Error updating client:", error);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger>
        <IconButton
          variant="ghost"
          title={t("admin.nodeEdit.editInfo", "编辑信息")}
        >
          <Pencil size="18" />
        </IconButton>
      </Dialog.Trigger>
      <Dialog.Content>
        <Dialog.Title>{t("admin.nodeEdit.editInfo", "编辑信息")}</Dialog.Title>
        <div className="flex flex-col gap-4">
          <div>
            <label className="block mb-1 text-sm font-medium text-muted-foreground">
              {t("admin.nodeEdit.name", "名称")}
            </label>
            <TextField.Root
              defaultValue={node.name}
              placeholder={t("admin.nodeEdit.namePlaceholder", "请输入名称")}
              ref={nameRef}
            />
          </div>
          <div>
            <label className="block mb-1 text-sm font-medium text-muted-foreground">
              {t("admin.nodeEdit.token", "Token 令牌")}
            </label>
            <TextField.Root
              value={node.token}
              placeholder={t("admin.nodeEdit.tokenPlaceholder", "请输入 Token")}
              readOnly
            />
          </div>
          <div>
            <label className="mb-1 text-sm font-medium text-muted-foreground flex items-center">
              {t("common.tags")}
              <label className="text-muted-foreground ml-1 text-xs self-end">
                {t("common.tagsDescription")}
              </label>
              <Tips>
                <span
                  dangerouslySetInnerHTML={{ __html: t("common.tagsTips") }}
                />
              </Tips>
            </label>
            <TextField.Root defaultValue={node.tags} ref={tagsRef} />
          </div>
          <div>
            <label className="block mb-1 text-sm font-medium text-muted-foreground">
              {t("common.group")}
            </label>
            <TextField.Root defaultValue={node.group} ref={groupRef} />
          </div>
          <div>
            <label className="block mb-1 text-sm font-medium text-muted-foreground">
              {t("admin.nodeEdit.remark", "私有备注")}
            </label>
            <TextArea
              defaultValue={node.remark}
              ref={privateRemarkRef}
              resize={"vertical"}
              placeholder={t(
                "admin.nodeEdit.remarkPlaceholder",
                "请输入私有备注"
              )}
            />
          </div>
          <div>
            <label className="block mb-1 text-sm font-medium text-muted-foreground">
              {t("admin.nodeEdit.publicRemark", "公开备注")}
            </label>
            <TextArea
              defaultValue={node.public_remark}
              resize={"vertical"}
              placeholder={t(
                "admin.nodeEdit.publicRemarkPlaceholder",
                "请输入公开备注"
              )}
              ref={publicRemarkRef}
            />
          </div>
          <div>
            <SettingCardSwitch
              title={t("admin.nodeEdit.hidden")}
              description={t("admin.nodeEdit.hidden_description")}
              defaultChecked={hidden}
              onChange={setHidden}
            />
          </div>
          <SettingCardCollapse title={t("admin.nodeEdit.trafficLimit")}>
            <SettingCardSelect
              bordless
              title={t("admin.nodeEdit.trafficLimitType")}
              defaultValue={node.traffic_limit_type || "max"}
              options={[
                {
                  label: t("admin.nodeEdit.trafficLimitType_sum"),
                  value: "sum",
                },
                {
                  label: t("admin.nodeEdit.trafficLimitType_max"),
                  value: "max",
                },
                {
                  label: t("admin.nodeEdit.trafficLimitType_min"),
                  value: "min",
                },
                {
                  label: t("admin.nodeEdit.trafficLimitType_up"),
                  value: "up",
                },
                {
                  label: t("admin.nodeEdit.trafficLimitType_down"),
                  value: "down",
                },
              ]}
              OnSave={(value) => {
                setTrafficLimitType(value);
              }}
            />
            <SettingCardShortTextInput
              bordless
              title={t("admin.nodeEdit.trafficLimit")}
              description={t("admin.nodeEdit.trafficLimit_description")}
              defaultValue={formatBytes(traffic_limit || 0)}
              showSaveButton={false}
              onChange={(e) => {
                setTrafficLimit(stringToBytes(e.currentTarget.value));
              }}
              onBlur={(e) => {
                e.currentTarget.value = formatBytes(traffic_limit);
              }}
            ></SettingCardShortTextInput>
          </SettingCardCollapse>
        </div>
        <Flex gap="2" justify={"end"} className="mt-4">
          <Button
            type="submit"
            className="w-full"
            disabled={saving}
            onClick={save}
          >
            {saving
              ? t("admin.nodeEdit.waiting", "等待...")
              : t("common.save", "保存")}
          </Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}

function DetailView({ node }: { node: NodeDetail }) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();

  return (
    <Drawer direction={isMobile ? "bottom" : "right"}>
      <DrawerTrigger asChild>
        <div className="h-8 flex items-center hover:underline cursor-pointer font-bold text-base">
          <Flag flag={node.region} size="6" />
          {node.name.length > 25 ? node.name.slice(0, 25) + "..." : node.name}
        </div>
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader className="gap-1">
          <DrawerTitle>{node.name}</DrawerTitle>
          <DrawerDescription>
            {t("admin.nodeDetail.machineDetail", "机器详细信息")}
          </DrawerDescription>
        </DrawerHeader>
        <div className="flex flex-col gap-4 overflow-y-auto px-4 text-sm">
          <form className="flex flex-col gap-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col gap-3">
                <label htmlFor="detail-ip">
                  {t("admin.nodeDetail.ipAddress", "IP 地址")}
                </label>
                <div className="flex flex-col gap-1">
                  {node.ipv4 && (
                    <div className="flex items-center gap-1">
                      <span
                        id="detail-ipv4"
                        className="bg-muted px-3 py-2 rounded border flex-1 min-w-0 select-text"
                      >
                        {node.ipv4}
                      </span>
                      <IconButton
                        variant="ghost"
                        className="size-5"
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(node.ipv4!);
                        }}
                      >
                        <Copy size={16} />
                      </IconButton>
                    </div>
                  )}
                  {node.ipv6 && (
                    <div className="flex items-center gap-1">
                      <span
                        id="detail-ipv6"
                        className="bg-muted px-3 py-2 rounded border flex-1 min-w-0 select-text"
                      >
                        {node.ipv6}
                      </span>
                      <IconButton
                        variant="ghost"
                        className="size-5"
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(node.ipv6!);
                        }}
                      >
                        <Copy size={16} />
                      </IconButton>
                    </div>
                  )}
                </div>
              </div>
              <div className="flex flex-col gap-3">
                <label htmlFor="detail-version">
                  {t("admin.nodeDetail.clientVersion", "客户端版本")}
                </label>
                <span
                  id="detail-version"
                  className="bg-muted px-3 py-2 rounded border select-text"
                >
                  {node.version || (
                    <span className="text-muted-foreground">-</span>
                  )}
                </span>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col gap-3">
                <label htmlFor="detail-os">
                  {t("admin.nodeDetail.os", "操作系统")}
                </label>
                <span
                  id="detail-os"
                  className="bg-muted px-3 py-2 rounded border select-text"
                >
                  {node.os || <span className="text-muted-foreground">-</span>}
                </span>
              </div>
              <div className="flex flex-col gap-3">
                <label htmlFor="detail-arch">
                  {t("admin.nodeDetail.arch", "架构")}
                </label>
                <span
                  id="detail-arch"
                  className="bg-muted px-3 py-2 rounded border select-text"
                >
                  {node.arch || (
                    <span className="text-muted-foreground">-</span>
                  )}
                </span>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col gap-3">
                <label htmlFor="detail-cpu_name">
                  {t("admin.nodeDetail.cpu", "CPU")}
                </label>
                <span
                  id="detail-cpu_name"
                  className="bg-muted px-3 py-2 rounded border select-text"
                >
                  {node.cpu_name || (
                    <span className="text-muted-foreground">-</span>
                  )}
                </span>
              </div>
              <div className="flex flex-col gap-3">
                <label htmlFor="detail-cpu_cores">
                  {t("admin.nodeDetail.cpuCores", "CPU 核心数")}
                </label>
                <span
                  id="detail-cpu_cores"
                  className="bg-muted px-3 py-2 rounded border select-text"
                >
                  {node.cpu_cores?.toString() || (
                    <span className="text-muted-foreground">-</span>
                  )}
                </span>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col gap-3">
                <label htmlFor="detail-mem_total">
                  {t("admin.nodeDetail.memTotal", "总内存 (Bytes)")}
                </label>
                <span
                  id="detail-mem_total"
                  className="bg-muted px-3 py-2 rounded border select-text"
                  title={
                    node.mem_total ? String(node.mem_total) + " Bytes" : "-"
                  }
                >
                  {formatBytes(node.mem_total)}
                </span>
              </div>
              <div className="flex flex-col gap-3">
                <label htmlFor="detail-disk_total">
                  {t("admin.nodeDetail.diskTotal", "总磁盘空间 (Bytes)")}
                </label>
                <span
                  id="detail-disk_total"
                  className="bg-muted px-3 py-2 rounded border select-text"
                  title={
                    node.disk_total ? String(node.disk_total) + " Bytes" : "-"
                  }
                >
                  {formatBytes(node.disk_total)}
                </span>
              </div>
            </div>
            <div className="flex flex-col gap-3">
              <label htmlFor="detail-gpu_name">
                {t("admin.nodeDetail.gpu", "GPU")}
              </label>
              <span
                id="detail-gpu_name"
                className="bg-muted px-3 py-2 rounded border select-text"
              >
                {node.gpu_name || (
                  <span className="text-muted-foreground">-</span>
                )}
              </span>
            </div>
            <div className="flex flex-col gap-3">
              <label htmlFor="detail-uuid">
                {t("admin.nodeDetail.uuid", "UUID")}
              </label>
              <span
                id="detail-uuid"
                className="bg-muted px-3 py-2 rounded border select-text"
              >
                {node.uuid || <span className="text-muted-foreground">-</span>}
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col gap-3">
                <label htmlFor="detail-createdAt">
                  {t("admin.nodeDetail.createdAt", "创建时间")}
                </label>
                <span
                  id="detail-createdAt"
                  className="bg-muted px-3 py-2 rounded border select-text"
                >
                  {node.created_at ? (
                    new Date(node.created_at).toLocaleString()
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}
                </span>
              </div>
              <div className="flex flex-col gap-3">
                <label htmlFor="detail-updatedAt">
                  {t("admin.nodeDetail.updatedAt", "更新时间")}
                </label>
                <span
                  id="detail-updatedAt"
                  className="bg-muted px-3 py-2 rounded border select-text"
                >
                  {node.updated_at ? (
                    new Date(node.updated_at).toLocaleString()
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}
                </span>
              </div>
            </div>
          </form>
        </div>
        <DrawerFooter>
          <DrawerClose asChild>
            <Button>{t("admin.nodeDetail.done", "完成")}</Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

function BillingButton({ node }: { node: NodeDetail }) {
  const { t } = useTranslation();
  const { refresh } = useNodeDetails();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [billingCycle, setBillingCycle] = React.useState<string>(
    node.billing_cycle.toString()
  );
  const [autoRenewal, setAutoRenewal] = React.useState<boolean>(
    node.auto_renewal || false
  );
  const [currency, setCurrency] = React.useState<string>(node.currency || "$");

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSaving(true);
      const formData = new FormData(e.target as HTMLFormElement);
      const priceValue = (formData.get("price") as string) || "0";

      const price = parseFloat(priceValue);

      if (isNaN(price) || (price < 0 && price !== -1)) {
        toast.error(t("admin.nodeTable.invalidPrice"));
        return;
      }
      const billingCycleValue = parseInt(
        (formData.get("billingCycle") as string) || "30"
      );
      const expiredAtValue = (formData.get("expiredAt") as string) || "";
      const expiredAt = expiredAtValue
        ? new Date(`${expiredAtValue}T00:00:00Z`).toISOString()
        : null;
      const currencyValue = (formData.get("currency") as string) || "$";

      await fetch(`/api/admin/client/${node.uuid}/edit`, {
        method: "POST",
        body: JSON.stringify({
          price,
          billing_cycle: billingCycleValue,
          expired_at: expiredAt,
          currency: currencyValue,
          auto_renewal: autoRenewal,
        }),
        headers: {
          "Content-Type": "application/json",
        },
      });
      refresh();
      setOpen(false);
    } catch (error) {
      toast.error("Failed to save billing information:" + error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger>
        <IconButton
          variant="ghost"
          title={t("admin.nodeTable.billing", "账单")}
        >
          <CircleDollarSign size="18" />
        </IconButton>
      </Dialog.Trigger>
      <Dialog.Content>
        <Dialog.Title>{t("admin.nodeTable.billing", "账单")}</Dialog.Title>
        <form onSubmit={handleSave}>
          <Flex direction="column" gap="2">
            <label className="font-bold">
              <label>{t("admin.nodeTable.price")}</label>
              <label className="text-muted-foreground text-sm ml-1 font-medium">
                {t("admin.nodeTable.priceTips")}
              </label>
            </label>
            <TextField.Root name="price" defaultValue={node.price} />

            <label className="font-bold">
              <label>{t("admin.nodeTable.currency", "货币")}</label>
              <label className="text-muted-foreground text-sm ml-1 font-medium">
                {t("admin.nodeTable.currencyTips")}
              </label>
            </label>
            <TextField.Root
              name="currency"
              defaultValue={currency}
              onChange={(e) => setCurrency(e.target.value)}
            />

            <label className="font-bold flex items-center gap-1">
              {t("admin.nodeTable.billingCycle")} <Tips><span dangerouslySetInnerHTML={{ __html: t("admin.nodeTable.billingCycleTips") }}></span></Tips>
            </label>
            <SelectOrInput
            options={[
              { label: t("common.monthly"), value: "30" },
              { label: t("common.quarterly"), value: "92" },
              { label: t("common.semi_annual"), value: "184" },
              { label: t("common.annual"), value: "365" },
              { label: t("common.biennial"), value: "730" },
              { label: t("common.triennial"), value: "1095" },
              { label: t("common.quinquennial"), value: "1825" },
              { label: t("common.once"), value: "-1" },
            ]}
            type="number"
            name="billingCycle"
            value={billingCycle === "0" ? "" : billingCycle}
            onChange={setBillingCycle}
          />

            <Flex gap="2" align="center">
              <label className="font-bold">
                {t("admin.nodeTable.expiredAt")}
              </label>
            </Flex>
            <TextField.Root
              name="expiredAt"
              defaultValue={
                node.expired_at
                  ? new Date(node.expired_at).toISOString().slice(0, 10)
                  : "0001-01-01"
              }
              type="date"
            >
              <TextField.Slot side="right">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    const dateInput = document.querySelector(
                      'input[name="expiredAt"]'
                    ) as HTMLInputElement;
                    if (dateInput) {
                      const futureDate = new Date();
                      futureDate.setFullYear(futureDate.getFullYear() + 200);
                      dateInput.value = futureDate.toISOString().slice(0, 10);
                    }
                  }}
                >
                  {t("admin.nodeTable.setToLongTerm", "设置为长期")}
                </Button>
              </TextField.Slot>
            </TextField.Root>
            <Flex gap="2" align="center"></Flex>
            <SettingCardSwitch
              title={t("admin.nodeTable.autoRenewal")}
              description={t("admin.nodeTable.autoRenewalDescription")}
              defaultChecked={node.auto_renewal || false}
              onChange={setAutoRenewal}
            />
            <Button type="submit" disabled={saving}>
              {t("common.save")}
            </Button>
          </Flex>
        </form>
      </Dialog.Content>
    </Dialog.Root>
  );
}
