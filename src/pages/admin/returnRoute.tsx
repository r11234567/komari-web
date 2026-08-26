import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AdminPageTitle from "@/components/admin/AdminPageTitle";
import AdminActiveFilter from "@/components/admin/AdminActiveFilter";
import {
  AdminPagination,
} from "@/components/admin/AdminPagination";
import { useAdminDefaultPageSize } from "@/hooks/useAdminDefaultPageSize";
import {
  Badge,
  Box,
  Button,
  Callout,
  Dialog,
  Flex,
  IconButton,
  Popover,
  Select,
  Switch,
  Tabs,
  Text,
  TextField,
} from "@radix-ui/themes";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Activity,
  AlertTriangle,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  Download,
  History,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Route,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import Loading from "@/components/loading";
import {
  NodeDetailsProvider,
  useNodeDetails,
} from "@/contexts/NodeDetailsContext";
import { useAccount } from "@/contexts/AccountContext";

type Task = {
  id?: number;
  name: string;
  client: string;
  client_info?: { name?: string };
  carrier: "mobile" | "telecom" | "unicom";
  region: string;
  target: string;
  ip_version: number;
  expected_line: string;
  protocol: string;
  interval: number;
  switch_confirm: number;
  recovery_confirm: number;
  cooldown: number;
  notify: boolean;
  notify_recovery: boolean;
  notify_repeated: boolean;
  enabled: boolean;
};

type TaskForm = Omit<Task, "interval" | "switch_confirm" | "recovery_confirm" | "cooldown"> & {
  interval: string;
  switch_confirm: string;
  recovery_confirm: string;
  cooldown: string;
};

type TaskBatchForm = Pick<
  TaskForm,
  | "carrier"
  | "region"
  | "target"
  | "ip_version"
  | "expected_line"
  | "protocol"
  | "interval"
  | "switch_confirm"
  | "recovery_confirm"
  | "cooldown"
  | "notify"
  | "notify_recovery"
  | "notify_repeated"
  | "enabled"
>;

type Status = {
  task_id: number;
  current_line?: string;
  state: "pending" | "observing" | "healthy" | "switched" | "unknown";
  confidence: number;
  asn_path?: string[];
  route_path?: string[];
  candidate_line?: string;
  candidate_count?: number;
  last_error?: string;
  last_checked_at?: string;
};

type RouteEvent = {
  id: number;
  task_id: number;
  client: string;
  kind: "switch" | "recovery";
  from_line: string;
  to_line: string;
  confidence: number;
  asn_path?: string[];
  route_path?: string[];
  occurred_at: string;
  task_name?: string;
  node_name?: string;
  carrier?: Task["carrier"];
  region?: string;
  target?: string;
  ip_version?: number;
  expected_line?: string;
};

type TaskPage = { tasks: Task[]; statuses: Status[]; probing_task_ids: number[]; total: number; page: number; page_size: number };
type RecordPage = { events: RouteEvent[]; total: number; page: number; page_size: number };
type SummaryData = { tasks: number; healthy: number; switched: number; recent_events: number };
type RuleDocument = {
  schema_version: number;
  rule_version: string;
  asn_groups: Record<string, number[]>;
  prefix_groups: Record<string, string[]>;
  confidence: Record<string, number>;
  custom_lines?: Record<string, { groups: string[]; confidence: number }>;
};
type RuleStatus = {
  source: "builtin" | "external";
  rule_version: string;
  schema_version: number;
  loaded_at?: string;
  external_path: string;
  asn_rule_count: number;
  manual_cidr_count: number;
  bgp_cidr_count: number;
  cidr_rule_count: number;
  last_error?: string;
  watching: boolean;
  bgp_source_url: string;
  bgp_generated_at?: string;
  bgp_loaded_at?: string;
  bgp_next_refresh_at?: string;
  bgp_last_error?: string;
};
type RuleView = { status: RuleStatus; rules: RuleDocument };

const returnRouteTaskSnapshots = new Map<string, TaskPage>();
const returnRouteSummarySnapshots = new Map<string, SummaryData>();

function returnRouteTaskSnapshotKey(
  accountKey: string,
  query: { page: number; page_size: number; keyword: string; carrier: string; state: string },
  routeState: string,
  routeTask: number,
) {
  return JSON.stringify([
    accountKey,
    query.page,
    query.page_size,
    query.keyword,
    query.carrier,
    routeTask ? "" : routeState || query.state,
    routeTask || 0,
  ]);
}

const defaults: Task = {
  name: "",
  client: "",
  carrier: "mobile",
  region: "华东",
  target: "",
  ip_version: 4,
  expected_line: "CMIN2",
  protocol: "icmp",
  interval: 180,
  switch_confirm: 2,
  recovery_confirm: 3,
  cooldown: 1800,
  notify: true,
  notify_recovery: true,
  notify_repeated: false,
  enabled: true,
};

function toTaskForm(task?: Task): TaskForm {
  const value = { ...defaults, ...task };
  return {
    ...value,
    interval: String(value.interval),
    switch_confirm: String(value.switch_confirm),
    recovery_confirm: String(value.recovery_confirm),
    cooldown: String(value.cooldown),
  };
}

function toTaskPayload(form: TaskForm): Task {
  return {
    ...form,
    interval: Number(form.interval),
    switch_confirm: Number(form.switch_confirm),
    recovery_confirm: Number(form.recovery_confirm),
    cooldown: Number(form.cooldown),
  };
}

function toTaskBatchForm(task: Task): TaskBatchForm {
  const form = toTaskForm(task);
  return {
    carrier: form.carrier,
    region: form.region,
    target: form.target,
    ip_version: form.ip_version,
    expected_line: form.expected_line,
    protocol: form.protocol,
    interval: form.interval,
    switch_confirm: form.switch_confirm,
    recovery_confirm: form.recovery_confirm,
    cooldown: form.cooldown,
    notify: form.notify,
    notify_recovery: form.notify_recovery,
    notify_repeated: form.notify_repeated,
    enabled: form.enabled,
  };
}

function toTaskBatchPayload(form: TaskBatchForm) {
  return {
    ...form,
    interval: Number(form.interval),
    switch_confirm: Number(form.switch_confirm),
    recovery_confirm: Number(form.recovery_confirm),
    cooldown: Number(form.cooldown),
  };
}

const lineOptions: Record<Task["carrier"], string[]> = {
  mobile: ["CMIN2", "CMI", "CMNET"],
  telecom: ["CN2 GIA", "CN2 GT", "163"],
  unicom: ["CUG VIP", "CUG 优化", "9929", "4837"],
};

const internationalLineOptions = ["SoftBank", "IIJ", "Lumen"];

const ruleGroupNames: Record<string, string> = {
  cmin2: "CMIN2",
  cmi: "CMI",
  cmnet: "CMNET",
  cn2_global: "CN2 GIA 入口",
  cn2_backbone: "CN2 骨干",
  telecom_163: "163",
  unicom_10099: "CUG 接入（AS10099）",
  unicom_9929: "9929",
  unicom_4837: "4837",
  softbank: "SoftBank（AS17676）",
  iij: "IIJ（AS2497）",
  lumen: "Lumen（AS3356）",
};

const ruleGroupOrder = ["cmin2", "cmi", "cmnet", "cn2_global", "cn2_backbone", "telecom_163", "unicom_10099", "unicom_9929", "unicom_4837", "softbank", "iij", "lumen"];

const builtinLineOptions = [...Object.values(lineOptions).flat(), ...internationalLineOptions];

const regionOptions = ["华北", "东北", "华东", "华中", "华南", "西南", "西北", "港澳台", "其他"];

const carrierNames: Record<Task["carrier"], string> = {
  mobile: "中国移动",
  telecom: "中国电信",
  unicom: "中国联通",
};

async function request(path: string, body?: unknown) {
  const response = await fetch(`/api/admin/return-route${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.status === "error") {
    throw new Error(payload?.message || payload?.error?.message || "请求失败");
  }
  return payload?.data ?? payload;
}

function stateBadge(status?: Status) {
  if (!status) return <Badge color="gray">等待首次探测</Badge>;
  const states = {
    pending: { color: "gray" as const, text: "等待首次探测" },
    observing: { color: "amber" as const, text: "确认中" },
    healthy: { color: "green" as const, text: "线路正常" },
    switched: { color: "red" as const, text: "已切线" },
    unknown: { color: "gray" as const, text: "暂时无法识别" },
  };
  const item = states[status.state] || states.unknown;
  return <Badge color={item.color}>{item.text}</Badge>;
}

function formatTime(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString("zh-CN", { hour12: false });
}

function MultiNodeSelect({
  nodes,
  value,
  onChange,
}: {
  nodes: Array<{ uuid: string; name: string }>;
  value: string[];
  onChange: (clients: string[]) => void;
}) {
  const listboxRef = useRef<HTMLDivElement>(null);
  const selected = useMemo(() => new Set(value), [value]);
  const selectedNames = value.map(
    (uuid) => nodes.find((node) => node.uuid === uuid)?.name || uuid,
  );
  const triggerLabel = selectedNames.length > 0
    ? selectedNames.join("、")
    : "选择服务器（支持多选）";

  const toggle = (uuid: string) => {
    if (selected.has(uuid)) {
      onChange(value.filter((item) => item !== uuid));
    } else {
      onChange([...value, uuid]);
    }
  };

  return (
    <Popover.Root>
      <Popover.Trigger>
        <button
          type="button"
          className="rt-reset rt-SelectTrigger rt-r-size-2 rt-variant-surface w-full"
          aria-label="选择探测节点"
        >
          <span
            className={`rt-SelectTriggerInner ${selectedNames.length === 0 ? "text-[var(--gray-a10)]" : ""}`}
          >
            {triggerLabel}
          </span>
          <ChevronDown className="rt-SelectIcon" size={14} aria-hidden="true" />
        </button>
      </Popover.Trigger>
      <Popover.Content
        align="start"
        sideOffset={4}
        style={{
          padding: 4,
          width: "var(--radix-popover-trigger-width)",
          minWidth: 260,
          maxWidth: "min(420px, calc(100vw - 24px))",
        }}
      >
        <div
          ref={listboxRef}
          tabIndex={-1}
          className="max-h-[320px] overflow-y-auto py-1 focus:outline-none"
          role="listbox"
          aria-multiselectable="true"
        >
          {nodes.length === 0 ? (
            <Text as="div" size="2" color="gray" className="px-3 py-2">
              暂无可选服务器
            </Text>
          ) : nodes.map((node) => {
            const checked = selected.has(node.uuid);
            return (
              <button
                key={node.uuid}
                type="button"
                role="option"
                aria-selected={checked}
                data-state={checked ? "checked" : "unchecked"}
                className="flex min-h-9 w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm font-normal text-[var(--gray-12)] transition-colors duration-150 hover:bg-[var(--accent-9)] hover:text-[var(--accent-contrast)] focus-visible:bg-[var(--accent-9)] focus-visible:text-[var(--accent-contrast)] focus-visible:outline-none"
                onClick={(event) => {
                  toggle(node.uuid);
                  if (event.detail > 0) {
                    listboxRef.current?.focus({ preventScroll: true });
                  }
                }}
              >
                <span
                  className="flex size-4 shrink-0 items-center justify-center"
                  aria-hidden="true"
                >
                  {checked ? <Check size={16} strokeWidth={2.5} /> : null}
                </span>
                <span className="min-w-0 truncate">{node.name || node.uuid}</span>
              </button>
            );
          })}
        </div>
      </Popover.Content>
    </Popover.Root>
  );
}

function RouteTaskDialog({
  task,
  nodes,
  onSaved,
  lineOptions,
  children,
}: {
  task?: Task;
  nodes: Array<{ uuid: string; name: string }>;
  onSaved: () => void;
  lineOptions: string[];
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<TaskForm>(() => toTaskForm(task));
  const [selectedClients, setSelectedClients] = useState<string[]>(() =>
    task?.client ? [task.client] : [],
  );

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setForm(toTaskForm(task));
      setSelectedClients(task?.client ? [task.client] : []);
    }
    setOpen(nextOpen);
  };

  const setCarrier = (carrier: Task["carrier"]) => {
    setForm((current) => ({
      ...current,
      carrier,
    }));
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const clients = task?.id ? [form.client] : selectedClients;
    if (!form.name.trim() || clients.length === 0 || !form.target.trim() || !form.expected_line.trim()) {
      toast.error("任务名称、客户端、探测目标和预期线路为必填项");
      return;
    }
    setSaving(true);
    try {
      if (task?.id) {
        await request("/edit", toTaskPayload(form));
        toast.success("任务已更新");
      } else {
        let dispatched = 0;
        for (const client of clients) {
          const result = await request(
            "/add",
            toTaskPayload({ ...form, client }),
          );
          if (result?.dispatched) dispatched += 1;
        }
        if (dispatched === clients.length) {
          toast.success(
            `已为 ${clients.length} 台节点创建任务，首次探测已下发`,
          );
        } else if (dispatched > 0) {
          toast.success(
            `已创建 ${clients.length} 个任务，其中 ${dispatched} 个已下发首次探测`,
          );
        } else {
          toast.success(
            `已为 ${clients.length} 台节点创建任务，将在节点连接后按周期探测`,
          );
        }
      }
      setOpen(false);
      onSaved();
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      toast.error(
        message.includes("name, client, target and expected_line are required")
          ? "任务名称、客户端、探测目标和预期线路为必填项"
          : message || "保存失败",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Trigger>{children}</Dialog.Trigger>
      <Dialog.Content maxWidth="760px">
        <Dialog.Title>{task?.id ? "编辑回程监测" : "新建回程监测"}</Dialog.Title>
        <Dialog.Description size="2" color="gray">
          从所选服务器探测到国内目标的逐跳路径，并在线路变化稳定后通知。
        </Dialog.Description>
        <form onSubmit={submit} className="mt-5 space-y-6">
          <FormSection title="基本信息">
            <Field label="任务名称">
              <TextField.Root required value={form.name} placeholder="例如：东京到上海移动" onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="探测节点">
              {task?.id ? (
                <Select.Root value={form.client || undefined} onValueChange={(client) => setForm({ ...form, client })}>
                  <Select.Trigger placeholder="选择服务器" className="w-full" />
                  <Select.Content>{nodes.map((node) => <Select.Item key={node.uuid} value={node.uuid}>{node.name || node.uuid}</Select.Item>)}</Select.Content>
                </Select.Root>
              ) : (
                <MultiNodeSelect
                  nodes={nodes}
                  value={selectedClients}
                  onChange={setSelectedClients}
                />
              )}
            </Field>
            <Field label="运营商">
              <Select.Root value={form.carrier} onValueChange={(value) => setCarrier(value as Task["carrier"])}>
                <Select.Trigger className="w-full" />
                <Select.Content>{Object.entries(carrierNames).map(([value, label]) => <Select.Item key={value} value={value}>{label}</Select.Item>)}</Select.Content>
              </Select.Root>
            </Field>
            <Field label="地区（仅用于标记）">
              <Select.Root value={form.region || undefined} onValueChange={(region) => setForm({ ...form, region })}>
                <Select.Trigger placeholder="选择地区" className="w-full" />
                <Select.Content>{regionOptions.map((region) => <Select.Item key={region} value={region}>{region}</Select.Item>)}</Select.Content>
              </Select.Root>
            </Field>
            <Field label="目标 IP 或域名">
              <TextField.Root required value={form.target} placeholder="运营商测试目标" onChange={(e) => setForm({ ...form, target: e.target.value })} />
            </Field>
            <Field label="地址类型">
              <Select.Root value={String(form.ip_version)} onValueChange={(value) => setForm({ ...form, ip_version: Number(value) })}>
                <Select.Trigger className="w-full" />
                <Select.Content><Select.Item value="4">IPv4</Select.Item><Select.Item value="6">IPv6</Select.Item></Select.Content>
              </Select.Root>
            </Field>
          </FormSection>

          <FormSection title="判定规则">
            <Field label="预期线路">
              <Select.Root value={form.expected_line} onValueChange={(expected_line) => setForm({ ...form, expected_line })}>
                <Select.Trigger className="w-full" />
                <Select.Content>{lineOptions.map((line) => <Select.Item key={line} value={line}>{line}</Select.Item>)}</Select.Content>
              </Select.Root>
            </Field>
            <Field label="探测协议">
              <Select.Root value="icmp" disabled><Select.Trigger className="w-full" /><Select.Content><Select.Item value="icmp">内置 ICMP（推荐）</Select.Item></Select.Content></Select.Root>
            </Field>
            <Field label="探测间隔（秒）">
              <TextField.Root required type="number" min="60" max="86400" step="1" value={form.interval} onChange={(e) => setForm({ ...form, interval: e.target.value })} />
            </Field>
            <Field label="切线确认次数">
              <TextField.Root required type="number" min="1" max="20" step="1" value={form.switch_confirm} onChange={(e) => setForm({ ...form, switch_confirm: e.target.value })} />
            </Field>
            <Field label="恢复确认次数">
              <TextField.Root required type="number" min="1" max="20" step="1" value={form.recovery_confirm} onChange={(e) => setForm({ ...form, recovery_confirm: e.target.value })} />
            </Field>
          </FormSection>

          <FormSection title="通知与状态">
            <div className="flex flex-col justify-end gap-3 pb-1">
              <label className="flex items-center justify-between gap-3 text-sm"><span>发送切线通知</span><Switch checked={form.notify} onCheckedChange={(notify) => setForm({ ...form, notify })} /></label>
              <label className="flex items-center justify-between gap-3 text-sm"><span>发送恢复通知</span><Switch checked={form.notify_recovery} onCheckedChange={(notify_recovery) => setForm({ ...form, notify_recovery })} /></label>
              <label className="flex items-center justify-between gap-3 text-sm"><span>逐次报警（切线持续时每次探测提醒）</span><Switch checked={form.notify_repeated} disabled={!form.notify} onCheckedChange={(notify_repeated) => setForm({ ...form, notify_repeated })} /></label>
              <label className="flex items-center justify-between gap-3 text-sm"><span>启用任务</span><Switch checked={form.enabled} onCheckedChange={(enabled) => setForm({ ...form, enabled })} /></label>
            </div>
          </FormSection>
          <Flex justify="end" gap="3" mt="6">
            <Dialog.Close><Button type="button" variant="soft" color="gray">取消</Button></Dialog.Close>
            <Button type="submit" loading={saving}>保存</Button>
          </Flex>
        </form>
      </Dialog.Content>
    </Dialog.Root>
  );
}

function RouteTaskBatchDialog({
  tasks,
  onSaved,
  onClear,
  lineOptions,
  children,
}: {
  tasks: Task[];
  onSaved: () => void;
  onClear: () => void;
  lineOptions: string[];
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<TaskBatchForm>(() =>
    toTaskBatchForm(tasks[0] || defaults),
  );

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen && tasks.length > 0) {
      setForm(toTaskBatchForm(tasks[0]));
    }
    setOpen(nextOpen);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const ids = tasks.flatMap((task) => task.id ? [task.id] : []);
    if (ids.length === 0 || !form.target.trim() || !form.expected_line.trim()) {
      toast.error("请选择任务并填写探测目标和预期线路");
      return;
    }
    setSaving(true);
    try {
      await request("/edit/batch", { ids, ...toTaskBatchPayload(form) });
      toast.success(`已批量更新 ${ids.length} 个任务`);
      setOpen(false);
      onClear();
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "批量修改失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Trigger>{children}</Dialog.Trigger>
      <Dialog.Content maxWidth="760px">
        <Dialog.Title>批量修改回程监测</Dialog.Title>
        <Dialog.Description size="2" color="gray">
          已选择 {tasks.length} 个任务。下列配置会同步更新，任务名称和各自的探测节点保持不变。
        </Dialog.Description>
        <div className="mt-3 flex max-h-20 flex-wrap gap-1.5 overflow-y-auto rounded-md bg-[var(--gray-a2)] p-2">
          {tasks.map((task) => (
            <Badge key={task.id} color="gray" variant="soft">
              {task.name} · {task.client_info?.name || task.client}
            </Badge>
          ))}
        </div>
        <form onSubmit={submit} className="mt-5 space-y-6">
          <FormSection title="探测配置">
            <Field label="运营商">
              <Select.Root value={form.carrier} onValueChange={(carrier) => setForm({ ...form, carrier: carrier as Task["carrier"] })}>
                <Select.Trigger className="w-full" />
                <Select.Content>{Object.entries(carrierNames).map(([value, label]) => <Select.Item key={value} value={value}>{label}</Select.Item>)}</Select.Content>
              </Select.Root>
            </Field>
            <Field label="地区（仅用于标记）">
              <Select.Root value={form.region || undefined} onValueChange={(region) => setForm({ ...form, region })}>
                <Select.Trigger placeholder="选择地区" className="w-full" />
                <Select.Content>{regionOptions.map((region) => <Select.Item key={region} value={region}>{region}</Select.Item>)}</Select.Content>
              </Select.Root>
            </Field>
            <Field label="目标 IP 或域名">
              <TextField.Root required value={form.target} placeholder="运营商测试目标" onChange={(event) => setForm({ ...form, target: event.target.value })} />
            </Field>
            <Field label="地址类型">
              <Select.Root value={String(form.ip_version)} onValueChange={(value) => setForm({ ...form, ip_version: Number(value) })}>
                <Select.Trigger className="w-full" />
                <Select.Content><Select.Item value="4">IPv4</Select.Item><Select.Item value="6">IPv6</Select.Item></Select.Content>
              </Select.Root>
            </Field>
          </FormSection>

          <FormSection title="判定规则">
            <Field label="预期线路">
              <Select.Root value={form.expected_line} onValueChange={(expected_line) => setForm({ ...form, expected_line })}>
                <Select.Trigger className="w-full" />
                <Select.Content>{lineOptions.map((line) => <Select.Item key={line} value={line}>{line}</Select.Item>)}</Select.Content>
              </Select.Root>
            </Field>
            <Field label="探测协议">
              <Select.Root value="icmp" disabled><Select.Trigger className="w-full" /><Select.Content><Select.Item value="icmp">内置 ICMP（推荐）</Select.Item></Select.Content></Select.Root>
            </Field>
            <Field label="探测间隔（秒）">
              <TextField.Root required type="number" min="60" max="86400" step="1" value={form.interval} onChange={(event) => setForm({ ...form, interval: event.target.value })} />
            </Field>
            <Field label="切线确认次数">
              <TextField.Root required type="number" min="1" max="20" step="1" value={form.switch_confirm} onChange={(event) => setForm({ ...form, switch_confirm: event.target.value })} />
            </Field>
            <Field label="恢复确认次数">
              <TextField.Root required type="number" min="1" max="20" step="1" value={form.recovery_confirm} onChange={(event) => setForm({ ...form, recovery_confirm: event.target.value })} />
            </Field>
          </FormSection>

          <FormSection title="通知与状态">
            <div className="flex flex-col justify-end gap-3 pb-1">
              <label className="flex items-center justify-between gap-3 text-sm"><span>发送切线通知</span><Switch checked={form.notify} onCheckedChange={(notify) => setForm({ ...form, notify })} /></label>
              <label className="flex items-center justify-between gap-3 text-sm"><span>发送恢复通知</span><Switch checked={form.notify_recovery} onCheckedChange={(notify_recovery) => setForm({ ...form, notify_recovery })} /></label>
              <label className="flex items-center justify-between gap-3 text-sm"><span>逐次报警（切线持续时每次探测提醒）</span><Switch checked={form.notify_repeated} disabled={!form.notify} onCheckedChange={(notify_repeated) => setForm({ ...form, notify_repeated })} /></label>
              <label className="flex items-center justify-between gap-3 text-sm"><span>启用任务</span><Switch checked={form.enabled} onCheckedChange={(enabled) => setForm({ ...form, enabled })} /></label>
            </div>
          </FormSection>
          <Flex justify="end" gap="3" mt="6">
            <Dialog.Close><Button type="button" variant="soft" color="gray">取消</Button></Dialog.Close>
            <Button type="submit" loading={saving}>保存到 {tasks.length} 个任务</Button>
          </Flex>
        </form>
      </Dialog.Content>
    </Dialog.Root>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="flex min-w-0 flex-col gap-1.5"><Text size="2" weight="medium">{label}</Text>{children}</label>;
}

function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <fieldset><legend className="mb-3 text-sm font-medium">{title}</legend><div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div></fieldset>;
}

function ReturnRouteContent() {
  const { t } = useTranslation();
  const { account } = useAccount();
  const accountKey = account?.uuid || account?.username || "authenticated";
  const [searchParams] = useSearchParams();
  const routeState = searchParams.get("state")?.trim() || "";
  const routeTask = Number(searchParams.get("task") || 0);
  const defaultPageSize = useAdminDefaultPageSize();
  const { nodeDetail, isLoading: nodesLoading } = useNodeDetails();
  const nodes = Array.isArray(nodeDetail) ? nodeDetail.map((node) => ({ uuid: node.uuid, name: node.name })) : [];
  const [activeTab, setActiveTab] = useState<"tasks" | "records" | "rules">("tasks");
  const [taskQuery, setTaskQuery] = useState({ page: 1, page_size: defaultPageSize, keyword: "", carrier: "", state: "" });
  const taskSnapshotKey = useMemo(
    () => returnRouteTaskSnapshotKey(accountKey, taskQuery, routeState, routeTask),
    [accountKey, routeState, routeTask, taskQuery],
  );
  const initialTaskSnapshot = returnRouteTaskSnapshots.get(taskSnapshotKey);
  const [recordQuery, setRecordQuery] = useState({ page: 1, page_size: defaultPageSize, keyword: "", range: "24h", kind: "", carrier: "", region: "", expected_line: "", actual_line: "" });
  const [taskData, setTaskData] = useState<TaskPage>(() => initialTaskSnapshot || { tasks: [], statuses: [], probing_task_ids: [], total: 0, page: 1, page_size: defaultPageSize });
  const [recordData, setRecordData] = useState<RecordPage>({ events: [], total: 0, page: 1, page_size: defaultPageSize });
  const [summary, setSummary] = useState<SummaryData>(() => returnRouteSummarySnapshots.get(accountKey) || { tasks: 0, healthy: 0, switched: 0, recent_events: 0 });
  const [taskLoading, setTaskLoading] = useState(() => !initialTaskSnapshot);
  const hasRenderedTaskData = useRef(Boolean(initialTaskSnapshot));
  const [recordLoading, setRecordLoading] = useState(false);
  const [probingTasks, setProbingTasks] = useState<Set<number>>(new Set());
  const [selectedTaskIDs, setSelectedTaskIDs] = useState<Set<number>>(new Set());
  const [ruleView, setRuleView] = useState<RuleView | null>(null);
  const [rulesLoading, setRulesLoading] = useState(false);
  const [rulesBusy, setRulesBusy] = useState<"reload" | "refresh" | "upload" | "">("");
  const allLineOptions = useMemo(() => {
    const configured = Object.keys(ruleView?.rules.custom_lines || {});
    return [...builtinLineOptions, ...configured.filter((line) => !builtinLineOptions.includes(line))];
  }, [ruleView]);
  const ruleFileInput = useRef<HTMLInputElement>(null);

  const loadSummary = useCallback(async (quiet = false) => {
    try {
      const data = await request("/summary");
      const next = { tasks: data?.tasks || 0, healthy: data?.healthy || 0, switched: data?.switched || 0, recent_events: data?.recent_events || 0 };
      returnRouteSummarySnapshots.set(accountKey, next);
      setSummary(next);
    } catch (error) {
      if (!quiet) toast.error(error instanceof Error ? error.message : "概览加载失败");
    }
  }, [accountKey]);

  const loadTasks = useCallback(async (quiet = false) => {
    if (!quiet && !hasRenderedTaskData.current && !returnRouteTaskSnapshots.has(taskSnapshotKey)) setTaskLoading(true);
    try {
      const data = await request("/tasks/query", {
        ...taskQuery,
        task_id: routeTask || undefined,
        state: routeTask ? "" : routeState || taskQuery.state,
      });
      const probingTaskIDs = data?.probing_task_ids || [];
      const next = { tasks: data?.tasks || [], statuses: data?.statuses || [], probing_task_ids: probingTaskIDs, total: data?.total || 0, page: data?.page || 1, page_size: data?.page_size || taskQuery.page_size };
      returnRouteTaskSnapshots.set(taskSnapshotKey, next);
      hasRenderedTaskData.current = true;
      setTaskData(next);
      setProbingTasks(new Set(probingTaskIDs));
    } catch (error) {
      if (!quiet) toast.error(error instanceof Error ? error.message : "任务加载失败");
    } finally {
      if (!quiet) setTaskLoading(false);
    }
  }, [routeState, routeTask, taskQuery, taskSnapshotKey]);

  const loadRecords = useCallback(async (quiet = false) => {
    if (!quiet) setRecordLoading(true);
    try {
      const start = recordRangeStart(recordQuery.range);
      const data = await request("/events/query", { ...recordQuery, range: undefined, start });
      setRecordData({ events: data?.events || [], total: data?.total || 0, page: data?.page || 1, page_size: data?.page_size || recordQuery.page_size });
    } catch (error) {
      if (!quiet) toast.error(error instanceof Error ? error.message : "监测记录加载失败");
    } finally {
      if (!quiet) setRecordLoading(false);
    }
  }, [recordQuery]);

  const loadRules = useCallback(async (quiet = false) => {
    if (!quiet) setRulesLoading(true);
    try {
      setRuleView(await request("/rules"));
    } catch (error) {
      if (!quiet) toast.error(error instanceof Error ? error.message : "规则库加载失败");
    } finally {
      if (!quiet) setRulesLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    loadRules(true);
  }, [loadRules]);

  useEffect(() => {
    setTaskQuery((current) => ({ ...current, page: 1, page_size: defaultPageSize }));
    setRecordQuery((current) => ({ ...current, page: 1, page_size: defaultPageSize }));
  }, [defaultPageSize]);

  useEffect(() => {
    if (!routeState && !routeTask) return;
    setActiveTab("tasks");
    setTaskQuery((current) => ({
      ...current,
      page: 1,
      state: routeTask ? "" : routeState,
    }));
  }, [routeState, routeTask]);

  useEffect(() => {
    if (activeTab !== "tasks") return;
    const timer = window.setTimeout(() => loadTasks(), taskQuery.keyword ? 300 : 0);
    return () => window.clearTimeout(timer);
  }, [activeTab, loadTasks, taskQuery.keyword]);

  useEffect(() => {
    if (activeTab !== "records") return;
    const timer = window.setTimeout(() => loadRecords(), recordQuery.keyword ? 300 : 0);
    return () => window.clearTimeout(timer);
  }, [activeTab, loadRecords, recordQuery.keyword]);

  useEffect(() => {
    if (activeTab === "rules") loadRules();
  }, [activeTab, loadRules]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      loadSummary(true);
      if (activeTab === "tasks") loadTasks(true);
      else if (activeTab === "records") loadRecords(true);
      else loadRules(true);
    }, 10000);
    return () => window.clearInterval(timer);
  }, [activeTab, loadRecords, loadRules, loadSummary, loadTasks]);

  const statuses = useMemo(() => new Map(taskData.statuses.map((item) => [item.task_id, item])), [taskData.statuses]);
  const selectedTasks = useMemo(
    () => taskData.tasks.filter((task) => task.id && selectedTaskIDs.has(task.id)),
    [selectedTaskIDs, taskData.tasks],
  );
  const visibleTaskIDs = useMemo(
    () => taskData.tasks.flatMap((task) => task.id ? [task.id] : []),
    [taskData.tasks],
  );
  const allVisibleTasksSelected = visibleTaskIDs.length > 0 && visibleTaskIDs.every((id) => selectedTaskIDs.has(id));

  useEffect(() => {
    const visible = new Set(visibleTaskIDs);
    setSelectedTaskIDs((current) => {
      const next = new Set([...current].filter((id) => visible.has(id)));
      if (next.size === current.size && [...next].every((id) => current.has(id))) return current;
      return next;
    });
  }, [visibleTaskIDs]);

  const toggleTaskSelection = (id: number) => {
    setSelectedTaskIDs((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleVisibleTaskSelection = () => {
    setSelectedTaskIDs((current) => {
      const next = new Set(current);
      if (allVisibleTasksSelected) visibleTaskIDs.forEach((id) => next.delete(id));
      else visibleTaskIDs.forEach((id) => next.add(id));
      return next;
    });
  };
  const updateTaskQuery = (updates: Partial<typeof taskQuery>) => setTaskQuery((current) => ({ ...current, ...updates, page: updates.page ?? 1 }));
  const updateRecordQuery = (updates: Partial<typeof recordQuery>) => setRecordQuery((current) => ({ ...current, ...updates, page: updates.page ?? 1 }));
  const refreshTasksAfterChange = () => {
    loadSummary(true);
    if (taskQuery.page === 1) loadTasks();
    else updateTaskQuery({ page: 1 });
  };
  const activeFilterLabel = useMemo(() => {
    if (routeTask) {
      const task = taskData.tasks.find((item) => item.id === routeTask);
      return task?.name || `#${routeTask}`;
    }
    if (routeState === "switched") return "已确认切线";
    return routeState;
  }, [routeState, routeTask, taskData.tasks]);

  const runNow = async (id?: number) => {
    if (!id) return;
    try {
      await request("/probe", { id });
      setProbingTasks((current) => new Set(current).add(id));
      toast.success("探测任务已下发，逐跳探测通常需要 10-30 秒");
      window.setTimeout(() => loadTasks(true), 1500);
      window.setTimeout(() => {
        setProbingTasks((current) => {
          const next = new Set(current);
          next.delete(id);
          return next;
        });
      }, 45000);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "下发失败");
    }
  };

  const remove = async (task: Task) => {
    if (!task.id || !window.confirm(`确定删除“${task.name}”及其切换历史吗？`)) return;
    try {
      await request("/delete", { ids: [task.id] });
      toast.success("任务已删除");
      refreshTasksAfterChange();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除失败");
    }
  };

  const reloadRules = async () => {
    setRulesBusy("reload");
    try {
      setRuleView(await request("/rules/reload", {}));
      toast.success("本地规则已重新加载");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "重新加载失败");
      loadRules(true);
    } finally {
      setRulesBusy("");
    }
  };

  const refreshBGPRules = async () => {
    setRulesBusy("refresh");
    try {
      setRuleView(await request("/rules/refresh", {}));
      toast.success("BGP 网段规则已更新");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "BGP 网段更新失败");
      loadRules(true);
    } finally {
      setRulesBusy("");
    }
  };

  const importRules = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setRulesBusy("upload");
    try {
      const rules = JSON.parse(await file.text());
      setRuleView(await request("/rules/update", { rules }));
      toast.success("规则文件已校验并生效");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "规则文件导入失败");
      loadRules(true);
    } finally {
      setRulesBusy("");
    }
  };

  const exportRules = () => {
    if (!ruleView?.rules) return;
    const blob = new Blob([`${JSON.stringify(ruleView.rules, null, 2)}\n`], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "return-route-signatures.json";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (nodesLoading) return <Loading text="" />;

  return (
    <div className="flex w-full min-w-0 flex-col gap-4 p-0 md:p-4">
      <AdminPageTitle
        description={t(
          "return_route.description",
          "识别移动、电信、联通回程线路，确认切线后告警，恢复后自动通知。",
        )}
      >
        {t("return_route.title", "回程线路监测")}
      </AdminPageTitle>

      {activeFilterLabel ? (
        <AdminActiveFilter label={activeFilterLabel} clearTo="/admin/return-route" />
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Summary label="监测任务" value={summary.tasks} icon={<Route size={20} />} />
        <Summary label="线路正常" value={summary.healthy} tone="green" icon={<CheckCircle2 size={20} />} />
        <Summary label="已确认切线" value={summary.switched} tone="red" icon={<AlertTriangle size={20} />} />
        <Summary label="最近事件" value={summary.recent_events} icon={<History size={20} />} />
      </div>

      <Tabs.Root value={activeTab} onValueChange={(value) => setActiveTab(value as "tasks" | "records" | "rules")}>
        <Tabs.List>
          <Tabs.Trigger value="tasks"><Route size={15} />监测任务</Tabs.Trigger>
          <Tabs.Trigger value="records"><History size={15} />监测记录</Tabs.Trigger>
          <Tabs.Trigger value="rules"><BookOpen size={15} />规则库</Tabs.Trigger>
        </Tabs.List>

        <Box pt="4">
          <Tabs.Content value="tasks">
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="flex flex-wrap items-end gap-3">
                  <Field label="搜索任务、节点或目标">
                    <TextField.Root className="min-w-[240px]" value={taskQuery.keyword} placeholder="输入关键词" onChange={(event) => updateTaskQuery({ keyword: event.target.value })}>
                      <TextField.Slot><Search size={16} /></TextField.Slot>
                    </TextField.Root>
                  </Field>
                  <Field label="运营商">
                    <Select.Root value={taskQuery.carrier || "all"} onValueChange={(carrier) => updateTaskQuery({ carrier: carrier === "all" ? "" : carrier })}>
                      <Select.Trigger className="min-w-[130px]" />
                      <Select.Content><Select.Item value="all">全部</Select.Item>{Object.entries(carrierNames).map(([value, label]) => <Select.Item key={value} value={value}>{label}</Select.Item>)}</Select.Content>
                    </Select.Root>
                  </Field>
                  <Field label="状态">
                    <Select.Root disabled={Boolean(routeState || routeTask)} value={(routeTask ? "" : routeState || taskQuery.state) || "all"} onValueChange={(state) => updateTaskQuery({ state: state === "all" ? "" : state })}>
                      <Select.Trigger className="min-w-[130px]" />
                      <Select.Content><Select.Item value="all">全部</Select.Item><Select.Item value="healthy">线路正常</Select.Item><Select.Item value="probing">探测中</Select.Item><Select.Item value="observing">确认中</Select.Item><Select.Item value="switched">已切线</Select.Item><Select.Item value="unknown">无法识别</Select.Item><Select.Item value="pending">等待探测</Select.Item><Select.Item value="disabled">已暂停</Select.Item></Select.Content>
                    </Select.Root>
                  </Field>
                </div>
                <div className="flex w-full shrink-0 flex-wrap items-center justify-end gap-2 sm:w-auto">
                  <Button variant="soft" disabled={!taskQuery.keyword && !taskQuery.carrier && (!taskQuery.state || Boolean(routeState || routeTask))} onClick={() => setTaskQuery((current) => ({ ...current, page: 1, keyword: "", carrier: "", state: routeTask ? "" : routeState }))}>重置</Button>
                  <Button type="button" variant="soft" disabled={visibleTaskIDs.length === 0} onClick={toggleVisibleTaskSelection}>
                    {allVisibleTasksSelected ? "取消全选" : "全选"}
                  </Button>
                  <RouteTaskBatchDialog
                    tasks={selectedTasks}
                    onClear={() => setSelectedTaskIDs(new Set())}
                    onSaved={refreshTasksAfterChange}
                    lineOptions={allLineOptions}
                  >
                    <Button type="button" variant="soft" disabled={selectedTasks.length === 0}>
                      <Pencil size={16} />批量修改
                      {selectedTasks.length > 0 ? <Badge color="blue">{selectedTasks.length}</Badge> : null}
                    </Button>
                  </RouteTaskBatchDialog>
                  <RouteTaskDialog nodes={nodes} onSaved={refreshTasksAfterChange} lineOptions={allLineOptions}><Button><Plus size={16} />新建任务</Button></RouteTaskDialog>
                </div>
              </div>

              {taskLoading ? <Loading text="" /> : taskData.tasks.length === 0 ? (
                <Callout.Root color="gray"><Callout.Icon><Activity size={16} /></Callout.Icon><Callout.Text>{taskData.total === 0 && !taskQuery.keyword && !taskQuery.carrier && !taskQuery.state ? "暂无任务" : "没有符合条件的任务"}</Callout.Text></Callout.Root>
              ) : (
                <section className="admin-responsive-table-wrap overflow-hidden rounded-md border border-[var(--gray-a5)]">
                  <div className="admin-responsive-table-scroll overflow-x-auto">
                    <table className="admin-responsive-table w-full min-w-[1120px] text-left text-sm">
                      <thead className="admin-table-header text-sm"><tr><th className="w-11 p-3"><span className="sr-only">选择</span></th><th className="p-3">任务 / 节点</th><th className="p-3">运营商 / 地区</th><th className="p-3">线路</th><th className="p-3">状态</th><th className="p-3">关键 ASN</th><th className="p-3">最后探测</th><th className="py-3 pl-6 pr-3">操作</th></tr></thead>
                      <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                        {taskData.tasks.map((task) => {
                          const status = statuses.get(task.id || 0);
                          const needed = status?.candidate_line === task.expected_line ? task.recovery_confirm : task.switch_confirm;
                          const probing = probingTasks.has(task.id || 0);
                          const selected = Boolean(task.id && selectedTaskIDs.has(task.id));
                          return <tr key={task.id} className={`align-top hover:bg-gray-50/60 dark:hover:bg-gray-900/50 ${selected ? "bg-[var(--accent-a2)]" : ""}`}>
                            <td data-label="选择" className="p-3 align-middle"><Checkbox aria-label={`选择任务 ${task.name}`} checked={selected} onCheckedChange={() => task.id && toggleTaskSelection(task.id)} /></td>
                            <td data-label="任务 / 节点" className="p-3"><div className="return-route-cell-pair"><div className="font-medium">{task.name}</div><div className="mt-1 text-xs text-gray-500">{task.client_info?.name || task.client}</div></div></td>
                            <td data-label="运营商 / 地区" className="p-3"><div className="return-route-cell-pair"><div>{carrierNames[task.carrier]}</div><div className="mt-1 text-xs text-gray-500">{task.region || "未标记"} · IPv{task.ip_version}</div></div></td>
                            <td data-label="线路" className="p-3"><div className="return-route-cell-pair"><div><span className="text-gray-500">当前 </span><strong>{status?.current_line || "-"}</strong></div><div className="mt-1 text-xs text-gray-500">预期 {task.expected_line}</div></div></td>
                            <td data-label="状态" className="p-3"><div className="return-route-cell-content">{!task.enabled ? <Badge color="gray">已暂停</Badge> : probing ? <Badge color="blue"><RefreshCw size={12} className="mr-1 animate-spin" />探测中</Badge> : stateBadge(status)}{status?.candidate_line && <div className="mt-1 text-xs text-amber-600">{status.candidate_line}{status.candidate_line === "CN2 待确认" ? null : <> {status.candidate_count}/{needed}</>}</div>}{(status?.confidence ?? 0) > 0 && <div className="mt-1 text-xs text-gray-500">置信度 {((status?.confidence ?? 0) * 100).toFixed(0)}%</div>}</div></td>
                            <td data-label="关键 ASN" className="max-w-[320px] p-3"><div className="return-route-cell-content"><div className="flex flex-wrap gap-1">{status?.asn_path?.length ? status.asn_path.map((asn) => <Badge key={asn} color="gray" variant="soft">{asn}</Badge>) : <span className="text-gray-400">-</span>}</div>{status?.route_path?.length ? <details className="mt-2 text-xs text-gray-500"><summary className="cursor-pointer">查看完整路径</summary><div className="mt-2 max-h-48 overflow-auto whitespace-pre font-mono leading-5">{status.route_path.join("\n")}</div></details> : null}{status?.last_error && <div className="mt-2 max-w-xs text-xs text-red-600">{status.last_error}</div>}</div></td>
                            <td data-label="最后探测" className="p-3 text-gray-600"><div className="return-route-cell-pair"><span>{formatTime(status?.last_checked_at)}</span><div className="mt-1 text-xs text-gray-400">每 {Math.round(task.interval / 60)} 分钟</div></div></td>
                            <td data-label="操作" className="p-3"><Flex justify="start" gap="1" className="admin-card-actions"><IconButton variant="ghost" title={probing ? "探测中" : "立即探测"} disabled={probing || !task.enabled} onClick={() => runNow(task.id)}>{probing ? <RefreshCw size={16} className="animate-spin" /> : <Play size={16} />}</IconButton><RouteTaskDialog task={task} nodes={nodes} onSaved={refreshTasksAfterChange} lineOptions={allLineOptions}><IconButton variant="ghost" title="编辑"><Pencil size={16} /></IconButton></RouteTaskDialog><IconButton variant="ghost" color="red" title="删除" onClick={() => remove(task)}><Trash2 size={16} /></IconButton></Flex></td>
                          </tr>;
                        })}
                      </tbody>
                    </table>
                  </div>
                  <AdminPagination
                    page={taskQuery.page}
                    pageSize={taskQuery.page_size}
                    total={taskData.total}
                    onPageChange={(page) => updateTaskQuery({ page })}
                    onPageSizeChange={(page_size) => updateTaskQuery({ page_size })}
                    showSummary={false}
                  />
                </section>
              )}
            </div>
          </Tabs.Content>

          <Tabs.Content value="records">
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="搜索任务、节点、目标、ASN 或 IP">
                  <TextField.Root value={recordQuery.keyword} placeholder="输入关键词" onChange={(event) => updateRecordQuery({ keyword: event.target.value })}><TextField.Slot><Search size={16} /></TextField.Slot></TextField.Root>
                </Field>
                <Field label="时间范围">
                  <Select.Root value={recordQuery.range} onValueChange={(range) => updateRecordQuery({ range })}><Select.Trigger className="w-full" /><Select.Content><Select.Item value="24h">最近 24 小时</Select.Item><Select.Item value="7d">最近 7 天</Select.Item><Select.Item value="30d">最近 30 天</Select.Item><Select.Item value="all">全部时间</Select.Item></Select.Content></Select.Root>
                </Field>
                <Field label="记录类型">
                  <Select.Root value={recordQuery.kind || "all"} onValueChange={(kind) => updateRecordQuery({ kind: kind === "all" ? "" : kind })}><Select.Trigger className="w-full" /><Select.Content><Select.Item value="all">全部</Select.Item><Select.Item value="switch">切线</Select.Item><Select.Item value="recovery">恢复</Select.Item></Select.Content></Select.Root>
                </Field>
                <Field label="运营商">
                  <Select.Root value={recordQuery.carrier || "all"} onValueChange={(carrier) => updateRecordQuery({ carrier: carrier === "all" ? "" : carrier })}><Select.Trigger className="w-full" /><Select.Content><Select.Item value="all">全部</Select.Item>{Object.entries(carrierNames).map(([value, label]) => <Select.Item key={value} value={value}>{label}</Select.Item>)}</Select.Content></Select.Root>
                </Field>
                <Field label="地区">
                  <Select.Root value={recordQuery.region || "all"} onValueChange={(region) => updateRecordQuery({ region: region === "all" ? "" : region })}><Select.Trigger className="w-full" /><Select.Content><Select.Item value="all">全部</Select.Item>{regionOptions.map((region) => <Select.Item key={region} value={region}>{region}</Select.Item>)}</Select.Content></Select.Root>
                </Field>
                <Field label="预期线路">
                  <Select.Root value={recordQuery.expected_line || "all"} onValueChange={(expected_line) => updateRecordQuery({ expected_line: expected_line === "all" ? "" : expected_line })}><Select.Trigger className="w-full" /><Select.Content><Select.Item value="all">全部</Select.Item>{allLineOptions.map((line) => <Select.Item key={line} value={line}>{line}</Select.Item>)}</Select.Content></Select.Root>
                </Field>
                <Field label="实际线路">
                  <Select.Root value={recordQuery.actual_line || "all"} onValueChange={(actual_line) => updateRecordQuery({ actual_line: actual_line === "all" ? "" : actual_line })}><Select.Trigger className="w-full" /><Select.Content><Select.Item value="all">全部</Select.Item>{allLineOptions.map((line) => <Select.Item key={line} value={line}>{line}</Select.Item>)}</Select.Content></Select.Root>
                </Field>
                <div className="flex items-end"><Button variant="soft" disabled={!recordQuery.keyword && recordQuery.range === "24h" && !recordQuery.kind && !recordQuery.carrier && !recordQuery.region && !recordQuery.expected_line && !recordQuery.actual_line} onClick={() => setRecordQuery((current) => ({ ...current, page: 1, keyword: "", range: "24h", kind: "", carrier: "", region: "", expected_line: "", actual_line: "" }))}>重置筛选</Button></div>
              </div>

              {recordLoading ? <Loading text="" /> : recordData.events.length === 0 ? <div className="rounded-md border border-[var(--gray-a5)] bg-[var(--color-panel-solid)] p-10 text-center text-sm text-gray-500">暂无符合条件的监测记录</div> : (
                <section className="admin-responsive-table-wrap overflow-hidden rounded-md border border-[var(--gray-a5)]">
                  <div className="admin-responsive-table-scroll overflow-x-auto">
                    <table className="admin-responsive-table w-full min-w-[1120px] text-left text-sm">
                      <thead className="admin-table-header text-sm"><tr><th className="p-3">发生时间</th><th className="p-3">类型</th><th className="p-3">任务 / 节点</th><th className="p-3">目标</th><th className="p-3">预期线路</th><th className="p-3">线路变化</th><th className="p-3">关键 ASN</th><th className="p-3">路径</th></tr></thead>
                      <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                        {recordData.events.map((event) => <tr key={event.id} className="align-top hover:bg-gray-50/60 dark:hover:bg-gray-900/50">
                          <td data-label="发生时间" className="p-3 whitespace-nowrap">{formatTime(event.occurred_at)}</td>
                          <td data-label="类型" className="p-3"><Badge color={event.kind === "recovery" ? "green" : "red"}>{event.kind === "recovery" ? "恢复" : "切线"}</Badge></td>
                          <td data-label="任务 / 节点" className="p-3"><div className="font-medium">{event.task_name || `#${event.task_id}`}</div><div className="mt-1 text-xs text-gray-500">{event.node_name || event.client}</div></td>
                          <td data-label="目标" className="p-3"><div>{event.target || "-"}</div><div className="mt-1 text-xs text-gray-500">{event.carrier ? carrierNames[event.carrier] : "-"} · {event.region || "未标记"} · IPv{event.ip_version || 4}</div></td>
                          <td data-label="预期线路" className="p-3 font-medium">{event.expected_line || "-"}</td>
                          <td data-label="线路变化" className="p-3 whitespace-nowrap"><span>{event.from_line || "-"}</span><span className="px-2 text-gray-400">→</span><strong>{event.to_line}</strong></td>
                          <td data-label="关键 ASN" className="max-w-[260px] p-3"><div className="flex flex-wrap gap-1">{event.asn_path?.length ? event.asn_path.map((asn) => <Badge key={asn} color="gray" variant="soft">{asn}</Badge>) : <span className="text-gray-400">-</span>}</div></td>
                          <td data-label="路径" className="p-3">{event.route_path?.length ? <details className="text-xs text-gray-500"><summary className="cursor-pointer">查看完整路径</summary><div className="mt-2 max-h-48 overflow-auto whitespace-pre font-mono leading-5">{event.route_path.join("\n")}</div></details> : <span className="text-gray-400">-</span>}</td>
                        </tr>)}
                      </tbody>
                    </table>
                  </div>
                  <AdminPagination
                    page={recordQuery.page}
                    pageSize={recordQuery.page_size}
                    total={recordData.total}
                    onPageChange={(page) => updateRecordQuery({ page })}
                    onPageSizeChange={(page_size) => updateRecordQuery({ page_size })}
                    showSummary={false}
                  />
                </section>
              )}
            </div>
          </Tabs.Content>

          <Tabs.Content value="rules">
            {rulesLoading && !ruleView ? <Loading text="" /> : ruleView ? (
              <div className="flex flex-col gap-5">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <Text size="2" weight="medium">识别方式</Text>
                    <Text as="p" size="2" color="gray" className="mt-1">本地骨干特征库（BGPtools 定时更新） + 有序路径判断 + Cymru/RIPEstat/BGPView 按需回退</Text>
                  </div>
                  <Flex gap="2" wrap="wrap">
                    <Button variant="soft" color="gray" onClick={exportRules}><Download size={16} />导出规则</Button>
                    <input ref={ruleFileInput} type="file" accept="application/json,.json" className="hidden" onChange={importRules} />
                    <Button variant="soft" color="gray" loading={rulesBusy === "upload"} disabled={Boolean(rulesBusy)} onClick={() => ruleFileInput.current?.click()}><Upload size={16} />导入规则</Button>
                    <Button variant="soft" color="gray" loading={rulesBusy === "reload"} disabled={Boolean(rulesBusy)} onClick={reloadRules}><RefreshCw size={16} />重新加载</Button>
                    <Button loading={rulesBusy === "refresh"} disabled={Boolean(rulesBusy)} onClick={refreshBGPRules}><RefreshCw size={16} />更新 BGP</Button>
                  </Flex>
                </div>

                <section className="border-y border-gray-200 py-4 dark:border-gray-800">
                  <div className="grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-4">
                    <RuleStat label="当前版本" value={ruleView.status.rule_version || "-"} />
                    <RuleStat label="规则来源" value={ruleView.status.source === "external" ? "外部规则" : "内置规则"} />
                    <RuleStat label="热加载" value={ruleView.status.watching ? "运行中" : "未运行"} />
                    <RuleStat label="最近加载" value={formatTime(ruleView.status.loaded_at)} />
                    <RuleStat label="ASN 规则" value={String(ruleView.status.asn_rule_count)} />
                    <RuleStat label="人工网段" value={String(ruleView.status.manual_cidr_count)} />
                    <RuleStat label="BGP 网段" value={String(ruleView.status.bgp_cidr_count)} />
                    <RuleStat label="网段合计" value={String(ruleView.status.cidr_rule_count)} />
                    <RuleStat label="BGP 生成时间" value={formatTime(ruleView.status.bgp_generated_at)} />
                    <RuleStat label="BGP 加载时间" value={formatTime(ruleView.status.bgp_loaded_at)} />
                    <RuleStat label="下次自动更新" value={formatTime(ruleView.status.bgp_next_refresh_at)} />
                    <RuleStat label="本地规则文件" value={ruleView.status.external_path || "-"} mono />
                  </div>
                </section>

                {ruleView.status.last_error ? <Callout.Root color="red"><Callout.Icon><AlertTriangle size={16} /></Callout.Icon><Callout.Text>本地规则：{ruleView.status.last_error}</Callout.Text></Callout.Root> : null}
                {ruleView.status.bgp_last_error ? <Callout.Root color="amber"><Callout.Icon><AlertTriangle size={16} /></Callout.Icon><Callout.Text>BGP 更新：{ruleView.status.bgp_last_error}</Callout.Text></Callout.Root> : null}

                <section className="admin-responsive-table-wrap overflow-hidden rounded-md border border-[var(--gray-a5)]">
                  <div className="admin-responsive-table-scroll overflow-x-auto">
                    <table className="admin-responsive-table w-full min-w-[760px] text-left text-sm">
                      <thead className="admin-table-header text-sm"><tr><th className="p-3">线路</th><th className="p-3">ASN</th><th className="p-3">人工网段特征</th></tr></thead>
                      <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                        {ruleGroupOrder.map((group) => <tr key={group} className="align-top">
                          <td data-label="线路" className="p-3 font-medium">{ruleGroupNames[group] || group}</td>
                          <td data-label="ASN" className="p-3"><div className="flex flex-wrap gap-1">{ruleView.rules.asn_groups[group]?.length ? ruleView.rules.asn_groups[group].map((asn) => <Badge key={asn} color="gray" variant="soft">AS{asn}</Badge>) : <span className="text-gray-400">-</span>}</div></td>
                          <td data-label="人工网段特征" className="p-3"><div className="flex flex-wrap gap-1">{ruleView.rules.prefix_groups[group]?.length ? ruleView.rules.prefix_groups[group].map((prefix) => <Badge key={prefix} color="blue" variant="soft">{prefix}</Badge>) : <span className="text-gray-400">-</span>}</div></td>
                        </tr>)}
                      </tbody>
                    </table>
                  </div>
                </section>
              </div>
            ) : <Callout.Root color="gray"><Callout.Text>规则库暂不可用</Callout.Text></Callout.Root>}
          </Tabs.Content>
        </Box>
      </Tabs.Root>
    </div>
  );
}

function recordRangeStart(range: string) {
  const hours = range === "24h" ? 24 : range === "7d" ? 24 * 7 : range === "30d" ? 24 * 30 : 0;
  return hours ? new Date(Date.now() - hours * 60 * 60 * 1000).toISOString() : undefined;
}

function Summary({ label, value, icon, tone = "gray" }: { label: string; value: number; icon: React.ReactNode; tone?: "gray" | "green" | "red" }) {
  const color = tone === "green" ? "text-green-600" : tone === "red" ? "text-red-600" : "text-gray-500";
  return <div className="flex min-h-24 items-center justify-between rounded-md border border-[var(--gray-a5)] bg-[var(--color-panel-solid)] px-5 py-4"><div><div className="text-sm text-gray-500">{label}</div><div className="mt-1 text-2xl font-semibold">{value}</div></div><span className={color}>{icon}</span></div>;
}

function RuleStat({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div className="min-w-0"><div className="text-xs text-gray-500">{label}</div><div className={`mt-1 break-words text-sm ${mono ? "font-mono" : "font-medium"}`}>{value}</div></div>;
}

export default function ReturnRoutePage() {
  return (
    <NodeDetailsProvider>
      <ReturnRouteContent />
    </NodeDetailsProvider>
  );
}
