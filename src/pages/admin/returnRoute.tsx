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
import type { TFunction } from "i18next";
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
  custom_lines?: Record<string, { name?: string; groups: string[]; confidence: number }>;
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
  telecom_163: "163",
  unicom_9929: "9929",
  unicom_4837: "4837",
  softbank: "SoftBank（AS17676）",
  iij: "IIJ（AS2497）",
  lumen: "Lumen（AS3356）",
};

const ruleGroupLabels: Record<string, string> = {
  cn2_global: "group_cn2_global",
  cn2_backbone: "group_cn2_backbone",
  unicom_10099: "group_unicom_10099",
};

const ruleGroupOrder = ["cmin2", "cmi", "cmnet", "cn2_global", "cn2_backbone", "telecom_163", "unicom_10099", "unicom_9929", "unicom_4837", "softbank", "iij", "lumen"];

const builtinLineOptions = [...Object.values(lineOptions).flat(), ...internationalLineOptions];

// These values are persisted and sent to the API. Only the labels are translated.
const regions: Record<string, string> = {
  华北: "region_north",
  东北: "region_northeast",
  华东: "region_east",
  华中: "region_central",
  华南: "region_south",
  西南: "region_southwest",
  西北: "region_northwest",
  港澳台: "region_hmt",
  其他: "region_other",
};
const carriers = ["mobile", "telecom", "unicom"] as const;
const builtInLineLabels: Record<string, string> = {
  "CUG 优化": "line_cug_optimized",
  "CN2 待确认": "line_cn2_unconfirmed",
};

function routeLabel(t: TFunction, value: string, labels: Record<string, string>, fallback = value) {
  if (!Object.prototype.hasOwnProperty.call(labels, value)) return fallback;
  return t("return_route." + labels[value]);
}

async function request(path: string, body?: unknown) {
  const response = await fetch(`/api/admin/return-route${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.status === "error") {
    throw new Error(payload?.message || payload?.error?.message || `HTTP ${response.status}`);
  }
  return payload?.data ?? payload;
}

function RouteStateBadge({ status }: { status?: Status }) {
  const { t } = useTranslation();
  if (!status) return <Badge color="gray">{t("return_route.first_probe")}</Badge>;
  const states = {
    pending: { color: "gray" as const, text: t("return_route.first_probe") },
    observing: { color: "amber" as const, text: t("return_route.observing") },
    healthy: { color: "green" as const, text: t("return_route.healthy") },
    switched: { color: "red" as const, text: t("return_route.switched") },
    unknown: { color: "gray" as const, text: t("return_route.unknown") },
  };
  const item = states[status.state] || states.unknown;
  return <Badge color={item.color}>{item.text}</Badge>;
}

function formatTime(value: string | undefined, locale: string | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString(locale, { hour12: false });
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
  const { t } = useTranslation();
  const listboxRef = useRef<HTMLDivElement>(null);
  const selected = useMemo(() => new Set(value), [value]);
  const selectedNames = value.map(
    (uuid) => nodes.find((node) => node.uuid === uuid)?.name || uuid,
  );
  const triggerLabel = selectedNames.length > 0
    ? selectedNames.join(", ")
    : t("return_route.select_multiple_nodes");

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
          aria-label={t("return_route.probe_node")}
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
              {t("return_route.no_nodes")}
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
  const { t } = useTranslation();
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
      toast.error(t("return_route.task_required"));
      return;
    }
    setSaving(true);
    try {
      if (task?.id) {
        await request("/edit", toTaskPayload(form));
        toast.success(t("return_route.task_updated"));
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
            t("return_route.created_dispatched", { count: clients.length }),
          );
        } else if (dispatched > 0) {
          toast.success(
            t("return_route.created_partial", { count: clients.length, dispatched }),
          );
        } else {
          toast.success(
            t("return_route.created_deferred", { count: clients.length }),
          );
        }
      }
      setOpen(false);
      onSaved();
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      toast.error(
        message.includes("name, client, target and expected_line are required")
          ? t("return_route.task_required")
          : message || t("return_route.save_failed"),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Trigger>{children}</Dialog.Trigger>
      <Dialog.Content maxWidth="760px">
        <Dialog.Title>{task?.id ? t("return_route.edit_task") : t("return_route.create_task")}</Dialog.Title>
        <Dialog.Description size="2" color="gray">
          {t("return_route.task_description")}
        </Dialog.Description>
        <form onSubmit={submit} className="mt-5 space-y-6">
          <FormSection title={t("return_route.basic")}>
            <Field label={t("return_route.task_name")}>
              <TextField.Root required value={form.name} placeholder={t("return_route.task_example")} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label={t("return_route.probe_node")}>
              {task?.id ? (
                <Select.Root value={form.client || undefined} onValueChange={(client) => setForm({ ...form, client })}>
                  <Select.Trigger placeholder={t("common.select_clients")} className="w-full" />
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
            <Field label={t("return_route.carrier")}>
              <Select.Root value={form.carrier} onValueChange={(value) => setCarrier(value as Task["carrier"])}>
                <Select.Trigger className="w-full" />
                <Select.Content>{carriers.map((value) => <Select.Item key={value} value={value}>{t("return_route.carrier_" + value)}</Select.Item>)}</Select.Content>
              </Select.Root>
            </Field>
            <Field label={t("return_route.region_tag")}>
              <Select.Root value={form.region || undefined} onValueChange={(region) => setForm({ ...form, region })}>
                <Select.Trigger placeholder={t("return_route.select_region")} className="w-full" />
                <Select.Content>{Object.keys(regions).map((region) => <Select.Item key={region} value={region}>{routeLabel(t, region, regions)}</Select.Item>)}</Select.Content>
              </Select.Root>
            </Field>
            <Field label={t("return_route.target_address")}>
              <TextField.Root required value={form.target} placeholder={t("return_route.target_example")} onChange={(e) => setForm({ ...form, target: e.target.value })} />
            </Field>
            <Field label={t("return_route.address_type")}>
              <Select.Root value={String(form.ip_version)} onValueChange={(value) => setForm({ ...form, ip_version: Number(value) })}>
                <Select.Trigger className="w-full" />
                <Select.Content><Select.Item value="4">IPv4</Select.Item><Select.Item value="6">IPv6</Select.Item></Select.Content>
              </Select.Root>
            </Field>
          </FormSection>

          <FormSection title={t("return_route.decision_rules")}>
            <Field label={t("return_route.expected_route")}>
              <Select.Root value={form.expected_line} onValueChange={(expected_line) => setForm({ ...form, expected_line })}>
                <Select.Trigger className="w-full" />
                <Select.Content>{lineOptions.map((line) => <Select.Item key={line} value={line}>{routeLabel(t, line, builtInLineLabels)}</Select.Item>)}</Select.Content>
              </Select.Root>
            </Field>
            <Field label={t("return_route.probe_protocol")}>
              <Select.Root value="icmp" disabled><Select.Trigger className="w-full" /><Select.Content><Select.Item value="icmp">{t("return_route.builtin_icmp")}</Select.Item></Select.Content></Select.Root>
            </Field>
            <Field label={t("return_route.probe_interval")}>
              <TextField.Root required type="number" min="60" max="86400" step="1" value={form.interval} onChange={(e) => setForm({ ...form, interval: e.target.value })} />
            </Field>
            <Field label={t("return_route.switch_threshold")}>
              <TextField.Root required type="number" min="1" max="20" step="1" value={form.switch_confirm} onChange={(e) => setForm({ ...form, switch_confirm: e.target.value })} />
            </Field>
            <Field label={t("return_route.recovery_threshold")}>
              <TextField.Root required type="number" min="1" max="20" step="1" value={form.recovery_confirm} onChange={(e) => setForm({ ...form, recovery_confirm: e.target.value })} />
            </Field>
          </FormSection>

          <FormSection title={t("return_route.notifications_and_status")}>
            <div className="flex flex-col justify-end gap-3 pb-1">
              <label className="flex items-center justify-between gap-3 text-sm"><span>{t("return_route.notify_switch")}</span><Switch checked={form.notify} onCheckedChange={(notify) => setForm({ ...form, notify })} /></label>
              <label className="flex items-center justify-between gap-3 text-sm"><span>{t("return_route.notify_recovery")}</span><Switch checked={form.notify_recovery} onCheckedChange={(notify_recovery) => setForm({ ...form, notify_recovery })} /></label>
              <label className="flex items-center justify-between gap-3 text-sm"><span>{t("return_route.notify_repeated")}</span><Switch checked={form.notify_repeated} disabled={!form.notify} onCheckedChange={(notify_repeated) => setForm({ ...form, notify_repeated })} /></label>
              <label className="flex items-center justify-between gap-3 text-sm"><span>{t("return_route.enable_task")}</span><Switch checked={form.enabled} onCheckedChange={(enabled) => setForm({ ...form, enabled })} /></label>
            </div>
          </FormSection>
          <Flex justify="end" gap="3" mt="6">
            <Dialog.Close><Button type="button" variant="soft" color="gray">{t("common.cancel")}</Button></Dialog.Close>
            <Button type="submit" loading={saving}>{t("common.save")}</Button>
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
  const { t } = useTranslation();
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
      toast.error(t("return_route.batch_required"));
      return;
    }
    setSaving(true);
    try {
      await request("/edit/batch", { ids, ...toTaskBatchPayload(form) });
      toast.success(t("return_route.batch_updated", { count: ids.length }));
      setOpen(false);
      onClear();
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("return_route.batch_failed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Trigger>{children}</Dialog.Trigger>
      <Dialog.Content maxWidth="760px">
        <Dialog.Title>{t("return_route.batch_title")}</Dialog.Title>
        <Dialog.Description size="2" color="gray">
          {t("return_route.batch_description", { count: tasks.length })}
        </Dialog.Description>
        <div className="mt-3 flex max-h-20 flex-wrap gap-1.5 overflow-y-auto rounded-md bg-[var(--gray-a2)] p-2">
          {tasks.map((task) => (
            <Badge key={task.id} color="gray" variant="soft">
              {task.name} · {task.client_info?.name || task.client}
            </Badge>
          ))}
        </div>
        <form onSubmit={submit} className="mt-5 space-y-6">
          <FormSection title={t("return_route.probe_settings")}>
            <Field label={t("return_route.carrier")}>
              <Select.Root value={form.carrier} onValueChange={(carrier) => setForm({ ...form, carrier: carrier as Task["carrier"] })}>
                <Select.Trigger className="w-full" />
                <Select.Content>{carriers.map((value) => <Select.Item key={value} value={value}>{t("return_route.carrier_" + value)}</Select.Item>)}</Select.Content>
              </Select.Root>
            </Field>
            <Field label={t("return_route.region_tag")}>
              <Select.Root value={form.region || undefined} onValueChange={(region) => setForm({ ...form, region })}>
                <Select.Trigger placeholder={t("return_route.select_region")} className="w-full" />
                <Select.Content>{Object.keys(regions).map((region) => <Select.Item key={region} value={region}>{routeLabel(t, region, regions)}</Select.Item>)}</Select.Content>
              </Select.Root>
            </Field>
            <Field label={t("return_route.target_address")}>
              <TextField.Root required value={form.target} placeholder={t("return_route.target_example")} onChange={(event) => setForm({ ...form, target: event.target.value })} />
            </Field>
            <Field label={t("return_route.address_type")}>
              <Select.Root value={String(form.ip_version)} onValueChange={(value) => setForm({ ...form, ip_version: Number(value) })}>
                <Select.Trigger className="w-full" />
                <Select.Content><Select.Item value="4">IPv4</Select.Item><Select.Item value="6">IPv6</Select.Item></Select.Content>
              </Select.Root>
            </Field>
          </FormSection>

          <FormSection title={t("return_route.decision_rules")}>
            <Field label={t("return_route.expected_route")}>
              <Select.Root value={form.expected_line} onValueChange={(expected_line) => setForm({ ...form, expected_line })}>
                <Select.Trigger className="w-full" />
                <Select.Content>{lineOptions.map((line) => <Select.Item key={line} value={line}>{routeLabel(t, line, builtInLineLabels)}</Select.Item>)}</Select.Content>
              </Select.Root>
            </Field>
            <Field label={t("return_route.probe_protocol")}>
              <Select.Root value="icmp" disabled><Select.Trigger className="w-full" /><Select.Content><Select.Item value="icmp">{t("return_route.builtin_icmp")}</Select.Item></Select.Content></Select.Root>
            </Field>
            <Field label={t("return_route.probe_interval")}>
              <TextField.Root required type="number" min="60" max="86400" step="1" value={form.interval} onChange={(event) => setForm({ ...form, interval: event.target.value })} />
            </Field>
            <Field label={t("return_route.switch_threshold")}>
              <TextField.Root required type="number" min="1" max="20" step="1" value={form.switch_confirm} onChange={(event) => setForm({ ...form, switch_confirm: event.target.value })} />
            </Field>
            <Field label={t("return_route.recovery_threshold")}>
              <TextField.Root required type="number" min="1" max="20" step="1" value={form.recovery_confirm} onChange={(event) => setForm({ ...form, recovery_confirm: event.target.value })} />
            </Field>
          </FormSection>

          <FormSection title={t("return_route.notifications_and_status")}>
            <div className="flex flex-col justify-end gap-3 pb-1">
              <label className="flex items-center justify-between gap-3 text-sm"><span>{t("return_route.notify_switch")}</span><Switch checked={form.notify} onCheckedChange={(notify) => setForm({ ...form, notify })} /></label>
              <label className="flex items-center justify-between gap-3 text-sm"><span>{t("return_route.notify_recovery")}</span><Switch checked={form.notify_recovery} onCheckedChange={(notify_recovery) => setForm({ ...form, notify_recovery })} /></label>
              <label className="flex items-center justify-between gap-3 text-sm"><span>{t("return_route.notify_repeated")}</span><Switch checked={form.notify_repeated} disabled={!form.notify} onCheckedChange={(notify_repeated) => setForm({ ...form, notify_repeated })} /></label>
              <label className="flex items-center justify-between gap-3 text-sm"><span>{t("return_route.enable_task")}</span><Switch checked={form.enabled} onCheckedChange={(enabled) => setForm({ ...form, enabled })} /></label>
            </div>
          </FormSection>
          <Flex justify="end" gap="3" mt="6">
            <Dialog.Close><Button type="button" variant="soft" color="gray">{t("common.cancel")}</Button></Dialog.Close>
            <Button type="submit" loading={saving}>{t("return_route.batch_save", { count: tasks.length })}</Button>
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
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage;
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
    const configured = Object.entries(ruleView?.rules.custom_lines || {}).map(([key, line]) => line.name?.trim() || key);
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
      if (!quiet) toast.error(error instanceof Error ? error.message : i18n.t("return_route.summary_failed"));
    }
  }, [accountKey, i18n]);

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
      if (!quiet) toast.error(error instanceof Error ? error.message : i18n.t("return_route.tasks_failed"));
    } finally {
      if (!quiet) setTaskLoading(false);
    }
  }, [routeState, routeTask, taskQuery, taskSnapshotKey, i18n]);

  const loadRecords = useCallback(async (quiet = false) => {
    if (!quiet) setRecordLoading(true);
    try {
      const start = recordRangeStart(recordQuery.range);
      const data = await request("/events/query", { ...recordQuery, range: undefined, start });
      setRecordData({ events: data?.events || [], total: data?.total || 0, page: data?.page || 1, page_size: data?.page_size || recordQuery.page_size });
    } catch (error) {
      if (!quiet) toast.error(error instanceof Error ? error.message : i18n.t("return_route.records_failed"));
    } finally {
      if (!quiet) setRecordLoading(false);
    }
  }, [recordQuery, i18n]);

  const loadRules = useCallback(async (quiet = false) => {
    if (!quiet) setRulesLoading(true);
    try {
      setRuleView(await request("/rules"));
    } catch (error) {
      if (!quiet) toast.error(error instanceof Error ? error.message : i18n.t("return_route.rules_failed"));
    } finally {
      if (!quiet) setRulesLoading(false);
    }
  }, [i18n]);

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
    if (routeState === "switched") return t("return_route.confirmed_switch");
    return routeState;
  }, [routeState, routeTask, t, taskData.tasks]);

  const runNow = async (id?: number) => {
    if (!id) return;
    try {
      await request("/probe", { id });
      setProbingTasks((current) => new Set(current).add(id));
      toast.success(t("return_route.probe_sent"));
      window.setTimeout(() => loadTasks(true), 1500);
      window.setTimeout(() => {
        setProbingTasks((current) => {
          const next = new Set(current);
          next.delete(id);
          return next;
        });
      }, 45000);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("return_route.probe_failed"));
    }
  };

  const remove = async (task: Task) => {
    if (!task.id || !window.confirm(t("return_route.delete_task", { name: task.name }))) return;
    try {
      await request("/delete", { ids: [task.id] });
      toast.success(t("return_route.task_deleted"));
      refreshTasksAfterChange();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("return_route.delete_failed"));
    }
  };

  const reloadRules = async () => {
    setRulesBusy("reload");
    try {
      setRuleView(await request("/rules/reload", {}));
      toast.success(t("return_route.rules_reloaded"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("return_route.reload_failed"));
      loadRules(true);
    } finally {
      setRulesBusy("");
    }
  };

  const refreshBGPRules = async () => {
    setRulesBusy("refresh");
    try {
      setRuleView(await request("/rules/refresh", {}));
      toast.success(t("return_route.bgp_updated"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("return_route.bgp_update_failed"));
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
      toast.success(t("return_route.rules_imported"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("return_route.import_failed"));
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
        description={t("return_route.description")}
      >
        {t("return_route.title")}
      </AdminPageTitle>

      {activeFilterLabel ? (
        <AdminActiveFilter label={activeFilterLabel} clearTo="/admin/return-route" />
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Summary label={t("return_route.tasks")} value={summary.tasks} icon={<Route size={20} />} />
        <Summary label={t("return_route.healthy")} value={summary.healthy} tone="green" icon={<CheckCircle2 size={20} />} />
        <Summary label={t("return_route.confirmed_switch")} value={summary.switched} tone="red" icon={<AlertTriangle size={20} />} />
        <Summary label={t("return_route.recent_events")} value={summary.recent_events} icon={<History size={20} />} />
      </div>

      <Tabs.Root value={activeTab} onValueChange={(value) => setActiveTab(value as "tasks" | "records" | "rules")}>
        <Tabs.List>
          <Tabs.Trigger value="tasks"><Route size={15} />{t("return_route.tasks")}</Tabs.Trigger>
          <Tabs.Trigger value="records"><History size={15} />{t("return_route.records")}</Tabs.Trigger>
          <Tabs.Trigger value="rules"><BookOpen size={15} />{t("return_route.rules")}</Tabs.Trigger>
        </Tabs.List>

        <Box pt="4">
          <Tabs.Content value="tasks">
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="flex flex-wrap items-end gap-3">
                  <Field label={t("return_route.task_search")}>
                    <TextField.Root className="min-w-[240px]" value={taskQuery.keyword} placeholder={t("return_route.keyword")} onChange={(event) => updateTaskQuery({ keyword: event.target.value })}>
                      <TextField.Slot><Search size={16} /></TextField.Slot>
                    </TextField.Root>
                  </Field>
                  <Field label={t("return_route.carrier")}>
                    <Select.Root value={taskQuery.carrier || "all"} onValueChange={(carrier) => updateTaskQuery({ carrier: carrier === "all" ? "" : carrier })}>
                      <Select.Trigger className="min-w-[130px]" />
                      <Select.Content><Select.Item value="all">{t("common.all")}</Select.Item>{carriers.map((value) => <Select.Item key={value} value={value}>{t("return_route.carrier_" + value)}</Select.Item>)}</Select.Content>
                    </Select.Root>
                  </Field>
                  <Field label={t("common.status")}>
                    <Select.Root disabled={Boolean(routeState || routeTask)} value={(routeTask ? "" : routeState || taskQuery.state) || "all"} onValueChange={(state) => updateTaskQuery({ state: state === "all" ? "" : state })}>
                      <Select.Trigger className="min-w-[130px]" />
                      <Select.Content><Select.Item value="all">{t("common.all")}</Select.Item><Select.Item value="healthy">{t("return_route.healthy")}</Select.Item><Select.Item value="probing">{t("return_route.probing")}</Select.Item><Select.Item value="observing">{t("return_route.observing")}</Select.Item><Select.Item value="switched">{t("return_route.switched")}</Select.Item><Select.Item value="unknown">{t("return_route.unknown")}</Select.Item><Select.Item value="pending">{t("return_route.pending")}</Select.Item><Select.Item value="disabled">{t("return_route.paused")}</Select.Item></Select.Content>
                    </Select.Root>
                  </Field>
                </div>
                <div className="flex w-full shrink-0 flex-wrap items-center justify-end gap-2 sm:w-auto">
                  <Button variant="soft" disabled={!taskQuery.keyword && !taskQuery.carrier && (!taskQuery.state || Boolean(routeState || routeTask))} onClick={() => setTaskQuery((current) => ({ ...current, page: 1, keyword: "", carrier: "", state: routeTask ? "" : routeState }))}>{t("common.reset")}</Button>
                  <Button type="button" variant="soft" disabled={visibleTaskIDs.length === 0} onClick={toggleVisibleTaskSelection}>
                    {allVisibleTasksSelected ? t("common.deselect_all") : t("common.select_all")}
                  </Button>
                  <RouteTaskBatchDialog
                    tasks={selectedTasks}
                    onClear={() => setSelectedTaskIDs(new Set())}
                    onSaved={refreshTasksAfterChange}
                    lineOptions={allLineOptions}
                  >
                    <Button type="button" variant="soft" disabled={selectedTasks.length === 0}>
                      <Pencil size={16} />{t("common.batch_edit")}
                      {selectedTasks.length > 0 ? <Badge color="blue">{selectedTasks.length}</Badge> : null}
                    </Button>
                  </RouteTaskBatchDialog>
                  <RouteTaskDialog nodes={nodes} onSaved={refreshTasksAfterChange} lineOptions={allLineOptions}><Button><Plus size={16} />{t("return_route.new_task")}</Button></RouteTaskDialog>
                </div>
              </div>

              {taskLoading ? <Loading text="" /> : taskData.tasks.length === 0 ? (
                <Callout.Root color="gray"><Callout.Icon><Activity size={16} /></Callout.Icon><Callout.Text>{taskData.total === 0 && !taskQuery.keyword && !taskQuery.carrier && !taskQuery.state ? t("return_route.no_tasks") : t("return_route.no_matching_tasks")}</Callout.Text></Callout.Root>
              ) : (
                <section className="admin-responsive-table-wrap overflow-hidden rounded-md border border-[var(--gray-a5)]">
                  <div className="admin-responsive-table-scroll overflow-x-auto">
                    <table className="admin-responsive-table w-full min-w-[1120px] text-left text-sm">
                      <thead className="admin-table-header text-sm"><tr><th className="w-11 p-3"><span className="sr-only">{t("common.select")}</span></th><th className="p-3">{t("return_route.task_node")}</th><th className="p-3">{t("return_route.carrier_region")}</th><th className="p-3">{t("return_route.route")}</th><th className="p-3">{t("common.status")}</th><th className="p-3">{t("return_route.key_asns")}</th><th className="p-3">{t("return_route.last_probe")}</th><th className="py-3 pl-6 pr-3">{t("common.action")}</th></tr></thead>
                      <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                        {taskData.tasks.map((task) => {
                          const status = statuses.get(task.id || 0);
                          const needed = status?.candidate_line === task.expected_line ? task.recovery_confirm : task.switch_confirm;
                          const probing = probingTasks.has(task.id || 0);
                          const selected = Boolean(task.id && selectedTaskIDs.has(task.id));
                          return <tr key={task.id} className={`align-top hover:bg-gray-50/60 dark:hover:bg-gray-900/50 ${selected ? "bg-[var(--accent-a2)]" : ""}`}>
                            <td data-label={t("common.select")} className="p-3 align-middle"><Checkbox aria-label={t("return_route.select_task", { name: task.name })} checked={selected} onCheckedChange={() => task.id && toggleTaskSelection(task.id)} /></td>
                            <td data-label={t("return_route.task_node")} className="p-3"><div className="return-route-cell-pair"><div className="font-medium">{task.name}</div><div className="mt-1 text-xs text-gray-500">{task.client_info?.name || task.client}</div></div></td>
                            <td data-label={t("return_route.carrier_region")} className="p-3"><div className="return-route-cell-pair"><div>{t("return_route.carrier_" + task.carrier, { defaultValue: task.carrier })}</div><div className="mt-1 text-xs text-gray-500">{task.region ? routeLabel(t, task.region, regions) : t("return_route.untagged")} · IPv{task.ip_version}</div></div></td>
                            <td data-label={t("return_route.route")} className="p-3"><div className="return-route-cell-pair"><div><span className="text-gray-500">{t("return_route.current_route")} </span><strong>{status?.current_line ? routeLabel(t, status.current_line, builtInLineLabels) : "-"}</strong></div><div className="mt-1 text-xs text-gray-500">{t("return_route.expected")} {routeLabel(t, task.expected_line, builtInLineLabels)}</div></div></td>
                            <td data-label={t("common.status")} className="p-3"><div className="return-route-cell-content">{!task.enabled ? <Badge color="gray">{t("return_route.paused")}</Badge> : probing ? <Badge color="blue"><RefreshCw size={12} className="mr-1 animate-spin" />{t("return_route.probing")}</Badge> : <RouteStateBadge status={status} />}{status?.candidate_line && <div className="mt-1 text-xs text-amber-600">{routeLabel(t, status.candidate_line, builtInLineLabels)}{status.candidate_line === "CN2 待确认" ? null : <> {status.candidate_count}/{needed}</>}</div>}{(status?.confidence ?? 0) > 0 && <div className="mt-1 text-xs text-gray-500">{t("return_route.confidence", { percent: ((status?.confidence ?? 0) * 100).toFixed(0) })}</div>}</div></td>
                            <td data-label={t("return_route.key_asns")} className="max-w-[320px] p-3"><div className="return-route-cell-content"><div className="flex flex-wrap gap-1">{status?.asn_path?.length ? status.asn_path.map((asn) => <Badge key={asn} color="gray" variant="soft">{asn}</Badge>) : <span className="text-gray-400">-</span>}</div>{status?.route_path?.length ? <details className="mt-2 text-xs text-gray-500"><summary className="cursor-pointer">{t("return_route.full_path")}</summary><div className="mt-2 max-h-48 overflow-auto whitespace-pre font-mono leading-5">{status.route_path.join("\n")}</div></details> : null}{status?.last_error && <div className="mt-2 max-w-xs text-xs text-red-600">{status.last_error}</div>}</div></td>
                            <td data-label={t("return_route.last_probe")} className="p-3 text-gray-600"><div className="return-route-cell-pair"><span>{formatTime(status?.last_checked_at, locale)}</span><div className="mt-1 text-xs text-gray-400">{t("return_route.every_minutes", { minutes: Math.round(task.interval / 60) })}</div></div></td>
                            <td data-label={t("common.action")} className="p-3"><Flex justify="start" gap="1" className="admin-card-actions"><IconButton variant="ghost" title={probing ? t("return_route.probing") : t("return_route.probe_now")} disabled={probing || !task.enabled} onClick={() => runNow(task.id)}>{probing ? <RefreshCw size={16} className="animate-spin" /> : <Play size={16} />}</IconButton><RouteTaskDialog task={task} nodes={nodes} onSaved={refreshTasksAfterChange} lineOptions={allLineOptions}><IconButton variant="ghost" title={t("common.edit")}><Pencil size={16} /></IconButton></RouteTaskDialog><IconButton variant="ghost" color="red" title={t("common.delete")} onClick={() => remove(task)}><Trash2 size={16} /></IconButton></Flex></td>
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
                <Field label={t("return_route.record_search")}>
                  <TextField.Root value={recordQuery.keyword} placeholder={t("return_route.keyword")} onChange={(event) => updateRecordQuery({ keyword: event.target.value })}><TextField.Slot><Search size={16} /></TextField.Slot></TextField.Root>
                </Field>
                <Field label={t("return_route.time_range")}>
                  <Select.Root value={recordQuery.range} onValueChange={(range) => updateRecordQuery({ range })}><Select.Trigger className="w-full" /><Select.Content><Select.Item value="24h">{t("return_route.last_24h")}</Select.Item><Select.Item value="7d">{t("return_route.last_7d")}</Select.Item><Select.Item value="30d">{t("return_route.last_30d")}</Select.Item><Select.Item value="all">{t("return_route.all_time")}</Select.Item></Select.Content></Select.Root>
                </Field>
                <Field label={t("return_route.record_type")}>
                  <Select.Root value={recordQuery.kind || "all"} onValueChange={(kind) => updateRecordQuery({ kind: kind === "all" ? "" : kind })}><Select.Trigger className="w-full" /><Select.Content><Select.Item value="all">{t("common.all")}</Select.Item><Select.Item value="switch">{t("return_route.switch")}</Select.Item><Select.Item value="recovery">{t("return_route.recovery")}</Select.Item></Select.Content></Select.Root>
                </Field>
                <Field label={t("return_route.carrier")}>
                  <Select.Root value={recordQuery.carrier || "all"} onValueChange={(carrier) => updateRecordQuery({ carrier: carrier === "all" ? "" : carrier })}><Select.Trigger className="w-full" /><Select.Content><Select.Item value="all">{t("common.all")}</Select.Item>{carriers.map((value) => <Select.Item key={value} value={value}>{t("return_route.carrier_" + value)}</Select.Item>)}</Select.Content></Select.Root>
                </Field>
                <Field label={t("return_route.region")}>
                  <Select.Root value={recordQuery.region || "all"} onValueChange={(region) => updateRecordQuery({ region: region === "all" ? "" : region })}><Select.Trigger className="w-full" /><Select.Content><Select.Item value="all">{t("common.all")}</Select.Item>{Object.keys(regions).map((region) => <Select.Item key={region} value={region}>{routeLabel(t, region, regions)}</Select.Item>)}</Select.Content></Select.Root>
                </Field>
                <Field label={t("return_route.expected_route")}>
                  <Select.Root value={recordQuery.expected_line || "all"} onValueChange={(expected_line) => updateRecordQuery({ expected_line: expected_line === "all" ? "" : expected_line })}><Select.Trigger className="w-full" /><Select.Content><Select.Item value="all">{t("common.all")}</Select.Item>{allLineOptions.map((line) => <Select.Item key={line} value={line}>{routeLabel(t, line, builtInLineLabels)}</Select.Item>)}</Select.Content></Select.Root>
                </Field>
                <Field label={t("return_route.actual_route")}>
                  <Select.Root value={recordQuery.actual_line || "all"} onValueChange={(actual_line) => updateRecordQuery({ actual_line: actual_line === "all" ? "" : actual_line })}><Select.Trigger className="w-full" /><Select.Content><Select.Item value="all">{t("common.all")}</Select.Item>{allLineOptions.map((line) => <Select.Item key={line} value={line}>{routeLabel(t, line, builtInLineLabels)}</Select.Item>)}</Select.Content></Select.Root>
                </Field>
                <div className="flex items-end"><Button variant="soft" disabled={!recordQuery.keyword && recordQuery.range === "24h" && !recordQuery.kind && !recordQuery.carrier && !recordQuery.region && !recordQuery.expected_line && !recordQuery.actual_line} onClick={() => setRecordQuery((current) => ({ ...current, page: 1, keyword: "", range: "24h", kind: "", carrier: "", region: "", expected_line: "", actual_line: "" }))}>{t("return_route.reset_filters")}</Button></div>
              </div>

              {recordLoading ? <Loading text="" /> : recordData.events.length === 0 ? <div className="rounded-md border border-[var(--gray-a5)] bg-[var(--color-panel-solid)] p-10 text-center text-sm text-gray-500">{t("return_route.no_records")}</div> : (
                <section className="admin-responsive-table-wrap overflow-hidden rounded-md border border-[var(--gray-a5)]">
                  <div className="admin-responsive-table-scroll overflow-x-auto">
                    <table className="admin-responsive-table w-full min-w-[1120px] text-left text-sm">
                      <thead className="admin-table-header text-sm"><tr><th className="p-3">{t("return_route.occurred_at")}</th><th className="p-3">{t("common.type")}</th><th className="p-3">{t("return_route.task_node")}</th><th className="p-3">{t("return_route.target")}</th><th className="p-3">{t("return_route.expected_route")}</th><th className="p-3">{t("return_route.route_change")}</th><th className="p-3">{t("return_route.key_asns")}</th><th className="p-3">{t("return_route.path")}</th></tr></thead>
                      <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                        {recordData.events.map((event) => <tr key={event.id} className="align-top hover:bg-gray-50/60 dark:hover:bg-gray-900/50">
                          <td data-label={t("return_route.occurred_at")} className="p-3 whitespace-nowrap">{formatTime(event.occurred_at, locale)}</td>
                          <td data-label={t("common.type")} className="p-3"><Badge color={event.kind === "recovery" ? "green" : "red"}>{event.kind === "recovery" ? t("return_route.recovery") : t("return_route.switch")}</Badge></td>
                          <td data-label={t("return_route.task_node")} className="p-3"><div className="font-medium">{event.task_name || `#${event.task_id}`}</div><div className="mt-1 text-xs text-gray-500">{event.node_name || event.client}</div></td>
                          <td data-label={t("return_route.target")} className="p-3"><div>{event.target || "-"}</div><div className="mt-1 text-xs text-gray-500">{event.carrier ? t("return_route.carrier_" + event.carrier, { defaultValue: event.carrier }) : "-"} · {event.region ? routeLabel(t, event.region, regions) : t("return_route.untagged")} · IPv{event.ip_version || 4}</div></td>
                          <td data-label={t("return_route.expected_route")} className="p-3 font-medium">{event.expected_line ? routeLabel(t, event.expected_line, builtInLineLabels) : "-"}</td>
                          <td data-label={t("return_route.route_change")} className="p-3 whitespace-nowrap"><span>{event.from_line ? routeLabel(t, event.from_line, builtInLineLabels) : "-"}</span><span className="px-2 text-gray-400">→</span><strong>{routeLabel(t, event.to_line, builtInLineLabels)}</strong></td>
                          <td data-label={t("return_route.key_asns")} className="max-w-[260px] p-3"><div className="flex flex-wrap gap-1">{event.asn_path?.length ? event.asn_path.map((asn) => <Badge key={asn} color="gray" variant="soft">{asn}</Badge>) : <span className="text-gray-400">-</span>}</div></td>
                          <td data-label={t("return_route.path")} className="p-3">{event.route_path?.length ? <details className="text-xs text-gray-500"><summary className="cursor-pointer">{t("return_route.full_path")}</summary><div className="mt-2 max-h-48 overflow-auto whitespace-pre font-mono leading-5">{event.route_path.join("\n")}</div></details> : <span className="text-gray-400">-</span>}</td>
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
                    <Text size="2" weight="medium">{t("return_route.detection_method")}</Text>
                    <Text as="p" size="2" color="gray" className="mt-1">{t("return_route.detection_detail")}</Text>
                  </div>
                  <Flex gap="2" wrap="wrap">
                    <Button variant="soft" color="gray" onClick={exportRules}><Download size={16} />{t("return_route.export_rules")}</Button>
                    <input ref={ruleFileInput} type="file" accept="application/json,.json" className="hidden" onChange={importRules} />
                    <Button variant="soft" color="gray" loading={rulesBusy === "upload"} disabled={Boolean(rulesBusy)} onClick={() => ruleFileInput.current?.click()}><Upload size={16} />{t("return_route.import_rules")}</Button>
                    <Button variant="soft" color="gray" loading={rulesBusy === "reload"} disabled={Boolean(rulesBusy)} onClick={reloadRules}><RefreshCw size={16} />{t("return_route.reload_rules")}</Button>
                    <Button loading={rulesBusy === "refresh"} disabled={Boolean(rulesBusy)} onClick={refreshBGPRules}><RefreshCw size={16} />{t("return_route.refresh_bgp")}</Button>
                  </Flex>
                </div>

                <section className="border-y border-gray-200 py-4 dark:border-gray-800">
                  <div className="grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-4">
                    <RuleStat label={t("return_route.version")} value={ruleView.status.rule_version || "-"} />
                    <RuleStat label={t("return_route.rule_source")} value={ruleView.status.source === "external" ? t("return_route.external_rules") : t("return_route.builtin_rules")} />
                    <RuleStat label={t("return_route.hot_reload")} value={ruleView.status.watching ? t("return_route.watching") : t("return_route.not_watching")} />
                    <RuleStat label={t("return_route.loaded_at")} value={formatTime(ruleView.status.loaded_at, locale)} />
                    <RuleStat label={t("return_route.asn_rules")} value={String(ruleView.status.asn_rule_count)} />
                    <RuleStat label={t("return_route.manual_prefixes")} value={String(ruleView.status.manual_cidr_count)} />
                    <RuleStat label={t("return_route.bgp_prefixes")} value={String(ruleView.status.bgp_cidr_count)} />
                    <RuleStat label={t("return_route.total_prefixes")} value={String(ruleView.status.cidr_rule_count)} />
                    <RuleStat label={t("return_route.bgp_generated_at")} value={formatTime(ruleView.status.bgp_generated_at, locale)} />
                    <RuleStat label={t("return_route.bgp_loaded_at")} value={formatTime(ruleView.status.bgp_loaded_at, locale)} />
                    <RuleStat label={t("return_route.next_refresh")} value={formatTime(ruleView.status.bgp_next_refresh_at, locale)} />
                    <RuleStat label={t("return_route.local_rule_file")} value={ruleView.status.external_path || "-"} mono />
                  </div>
                </section>

                {ruleView.status.last_error ? <Callout.Root color="red"><Callout.Icon><AlertTriangle size={16} /></Callout.Icon><Callout.Text>{t("return_route.local_rule_error", { message: ruleView.status.last_error })}</Callout.Text></Callout.Root> : null}
                {ruleView.status.bgp_last_error ? <Callout.Root color="amber"><Callout.Icon><AlertTriangle size={16} /></Callout.Icon><Callout.Text>{t("return_route.bgp_error", { message: ruleView.status.bgp_last_error })}</Callout.Text></Callout.Root> : null}

                <section className="admin-responsive-table-wrap overflow-hidden rounded-md border border-[var(--gray-a5)]">
                  <div className="admin-responsive-table-scroll overflow-x-auto">
                    <table className="admin-responsive-table w-full min-w-[760px] text-left text-sm">
                      <thead className="admin-table-header text-sm"><tr><th className="p-3">{t("return_route.route")}</th><th className="p-3">ASN</th><th className="p-3">{t("return_route.manual_prefix_signatures")}</th></tr></thead>
                      <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                        {ruleGroupOrder.map((group) => <tr key={group} className="align-top">
                          <td data-label={t("return_route.route")} className="p-3 font-medium">{routeLabel(t, group, ruleGroupLabels, ruleGroupNames[group] || group)}</td>
                          <td data-label="ASN" className="p-3"><div className="flex flex-wrap gap-1">{ruleView.rules.asn_groups[group]?.length ? ruleView.rules.asn_groups[group].map((asn) => <Badge key={asn} color="gray" variant="soft">AS{asn}</Badge>) : <span className="text-gray-400">-</span>}</div></td>
                          <td data-label={t("return_route.manual_prefix_signatures")} className="p-3"><div className="flex flex-wrap gap-1">{ruleView.rules.prefix_groups[group]?.length ? ruleView.rules.prefix_groups[group].map((prefix) => <Badge key={prefix} color="blue" variant="soft">{prefix}</Badge>) : <span className="text-gray-400">-</span>}</div></td>
                        </tr>)}
                      </tbody>
                    </table>
                  </div>
                </section>
              </div>
            ) : <Callout.Root color="gray"><Callout.Text>{t("return_route.rules_unavailable")}</Callout.Text></Callout.Root>}
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
