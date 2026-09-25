import * as React from "react";
import { useSearchParams } from "react-router-dom";
import {
  Badge,
  Button,
  Card,
  Callout,
  Flex,
  Select,
  Separator,
  Text,
  TextField,
} from "@radix-ui/themes";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Clock,
  Copy,
  RefreshCw,
  ShieldCheck,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { connectUnary, connectClients } from "@/api/connect/client";
import { create } from "@bufbuild/protobuf";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { TwoFactorProofSchema } from "@komari/proto/komari/common/v1/common_pb";
import {
  PrivilegedDeliveryState,
  UpgradeClass,
  type PrivilegedRevision,
} from "@komari/proto/komari/config/v1/config_pb";
import { PrivilegeMode } from "@komari/proto/komari/report/v1/report_pb";
import NodeSelector from "@/components/NodeSelector";

// ─── helpers ─────────────────────────────────────────────────────────────────

function stateInfo(state: PrivilegedDeliveryState): {
  label: string;
  color: "orange" | "green" | "red" | "gray" | "blue";
  icon: React.ReactNode;
} {
  switch (state) {
    case PrivilegedDeliveryState.NEEDS_CONFIRMATION:
      return { label: "需要面板二次确认", color: "orange", icon: <Clock size={13} /> };
    case PrivilegedDeliveryState.NEEDS_MANUAL_AUTHORIZATION:
      return { label: "需要在机器上执行升级", color: "orange", icon: <ShieldAlert size={13} /> };
    case PrivilegedDeliveryState.DELIVERED:
      return { label: "已应用", color: "green", icon: <CheckCircle2 size={13} /> };
    case PrivilegedDeliveryState.ROLLED_BACK:
      return { label: "已回滚", color: "gray", icon: <XCircle size={13} /> };
    case PrivilegedDeliveryState.FAILED:
      return { label: "失败", color: "red", icon: <XCircle size={13} /> };
    default:
      return { label: "未知", color: "gray", icon: null };
  }
}

function privilegeModeLabel(mode: PrivilegeMode): string {
  switch (mode) {
    case PrivilegeMode.LINUX_ROOT: return "root（Linux）";
    case PrivilegeMode.LINUX_NON_ROOT: return "非 root 服务账号（Linux）";
    case PrivilegeMode.WINDOWS_ADMINISTRATOR: return "管理员（Windows）";
    case PrivilegeMode.WINDOWS_STANDARD_USER: return "标准用户（Windows）";
    default: return "未知";
  }
}

function upgradeClassLabel(cls: UpgradeClass): string {
  switch (cls) {
    case UpgradeClass.MANUAL_CONFIRM: return "同权限级（面板确认）";
    case UpgradeClass.MANUAL_PRIVILEGED: return "跨权限级（机器上执行）";
    case UpgradeClass.AUTOMATIC: return "自动（已阻止）";
    default: return "未知";
  }
}

function formatTime(ts: unknown): string {
  if (!ts) return "—";
  try {
    if (typeof (ts as any).toDate === "function") return (ts as any).toDate().toLocaleString();
    return timestampDate(ts as any).toLocaleString();
  } catch { return "—"; }
}

// Countdown until a deadline timestamp; returns null if no deadline or already expired.
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

// ─── main page ───────────────────────────────────────────────────────────────

export default function PrivilegedConfigPage() {
  const [params] = useSearchParams();
  const initialAgent = params.get("agent") ?? "";

  const [selectedAgent, setSelectedAgent] = React.useState<string>(initialAgent);
  const [revisions, setRevisions] = React.useState<PrivilegedRevision[]>([]);
  const [appliedRevision, setAppliedRevision] = React.useState<bigint>(0n);
  const [installedMode, setInstalledMode] = React.useState<PrivilegeMode>(PrivilegeMode.UNSPECIFIED);
  const [loading, setLoading] = React.useState(false);

  const [twoFaCode, setTwoFaCode] = React.useState("");
  const [confirming, setConfirming] = React.useState(false);

  // new revision form
  const [showForm, setShowForm] = React.useState(false);
  const [newRemoteControl, setNewRemoteControl] = React.useState("off");
  const [newWebSSH, setNewWebSSH] = React.useState("off");
  const [newExecution, setNewExecution] = React.useState("off");
  const [newRescueHelper, setNewRescueHelper] = React.useState("off");
  const [newReason, setNewReason] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  const abortRef = React.useRef<AbortController | null>(null);
  const pollRef = React.useRef<number | undefined>(undefined);

  const loadHistory = React.useCallback(async (agentId: string) => {
    if (!agentId) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setRevisions([]);
    try {
      const response = await connectUnary({ signal: controller.signal }, (signal, timeoutMs) =>
        connectClients.privilegedDelivery.listPrivilegedRevisions(
          { agentId, limit: 20 },
          { signal, timeoutMs },
        ),
      );
      setRevisions(response.revisions ?? []);
      setAppliedRevision(response.appliedRevision);
      setInstalledMode(response.installedPrivilegeMode);
    } catch (err) {
      if (!controller.signal.aborted) toast.error(err instanceof Error ? err.message : "加载失败");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  // Poll every 10s when there is a pending revision awaiting action
  const hasPending = React.useMemo(() => revisions.some(
    (r) => r.state === PrivilegedDeliveryState.NEEDS_CONFIRMATION ||
           r.state === PrivilegedDeliveryState.NEEDS_MANUAL_AUTHORIZATION,
  ), [revisions]);

  React.useEffect(() => {
    if (selectedAgent) void loadHistory(selectedAgent);
    return () => { abortRef.current?.abort(); };
  }, [selectedAgent, loadHistory]);

  React.useEffect(() => {
    if (pollRef.current !== undefined) window.clearInterval(pollRef.current);
    if (selectedAgent && hasPending) {
      pollRef.current = window.setInterval(() => void loadHistory(selectedAgent), 10_000);
    }
    return () => { if (pollRef.current !== undefined) window.clearInterval(pollRef.current); };
  }, [selectedAgent, hasPending, loadHistory]);

  const confirm = async (revision: PrivilegedRevision) => {
    if (!twoFaCode.trim()) { toast.error("请输入 2FA 验证码"); return; }
    setConfirming(true);
    try {
      await connectUnary({ signal: new AbortController().signal }, (signal, timeoutMs) =>
        connectClients.privilegedDelivery.confirmPrivilegedDelivery(
          {
            agentId: selectedAgent,
            revision: revision.revision,
            twoFactor: create(TwoFactorProofSchema, { code: twoFaCode.trim() }),
          },
          { signal, timeoutMs },
        ),
      );
      setTwoFaCode("");
      toast.success("已确认，等待机器应用");
      void loadHistory(selectedAgent);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "确认失败");
    } finally {
      setConfirming(false);
    }
  };

  const saveRevision = async () => {
    if (!selectedAgent) return;
    setSaving(true);
    const expected = revisions.length > 0 ? revisions[0].revision : 0n;
    try {
      await connectUnary({ signal: new AbortController().signal }, (signal, timeoutMs) =>
        connectClients.privilegedDelivery.updatePrivilegedDelivery(
          {
            agentId: selectedAgent,
            expectedRevision: expected,
            reason: newReason.trim(),
            privileged: {
              remoteControlEnabled: newRemoteControl === "on",
              websshEnabled: newWebSSH === "on",
              executionEnabled: newExecution === "on",
              rescueHelperEnabled: newRescueHelper === "on",
              enableGpu: false,
              requiredPrivilegeMode: PrivilegeMode.UNSPECIFIED,
            },
          },
          { signal, timeoutMs },
        ),
      );
      toast.success("已保存，等待确认");
      setShowForm(false);
      setNewReason("");
      void loadHistory(selectedAgent);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const pendingRevision = revisions.find(
    (r) =>
      r.state === PrivilegedDeliveryState.NEEDS_CONFIRMATION ||
      r.state === PrivilegedDeliveryState.NEEDS_MANUAL_AUTHORIZATION,
  );

  return (
    <div className="max-w-2xl mx-auto p-6 flex flex-col gap-6">
      <Flex align="center" gap="2">
        <ShieldCheck size={20} />
        <Text size="5" weight="bold">特权配置下发</Text>
      </Flex>
      <Text size="2" color="gray">
        控制每台机器上的特权功能。普通配置是自动收敛的；这里的变更需要人工确认，跨权限级的变更还需要在机器上执行。
      </Text>

      {/* ── node picker ── */}
      <Card>
        <Flex direction="column" gap="3" p="4">
          <Text size="2" weight="medium">选择机器</Text>
          <NodeSelector
            value={selectedAgent ? [selectedAgent] : []}
            onChange={(ids) => setSelectedAgent(ids[0] ?? "")}
          />
          {selectedAgent && (
            <Text size="1" color="gray">
              已安装权限：{privilegeModeLabel(installedMode)} &nbsp;·&nbsp;
              当前运行配置版本：{appliedRevision ? `r${appliedRevision.toString()}` : "未知"}
              {hasPending && <> &nbsp;·&nbsp; <Badge color="orange" size="1">有待处理变更，自动刷新中</Badge></>}
            </Text>
          )}
        </Flex>
      </Card>

      {/* ── pending revision action ── */}
      {pendingRevision && (
        <Card>
          <Flex direction="column" gap="3" p="4">
            {(() => {
              const info = stateInfo(pendingRevision.state);
              return (
                <Flex align="center" gap="2">
                  {info.icon}
                  <Text size="3" weight="medium">待处理变更</Text>
                  <Badge color={info.color}>{info.label}</Badge>
                </Flex>
              );
            })()}

            <RevisionDetail revision={pendingRevision} />

            {pendingRevision.state === PrivilegedDeliveryState.NEEDS_CONFIRMATION && (
              <>
                <Callout.Root color="orange" size="1">
                  <Callout.Icon><AlertTriangle size={13} /></Callout.Icon>
                  <Callout.Text>
                    确认将授权机器应用此变更。类型：{upgradeClassLabel(pendingRevision.plan?.upgradeClass ?? UpgradeClass.UNSPECIFIED)}
                  </Callout.Text>
                </Callout.Root>
                <Flex gap="2" align="center" wrap="wrap">
                  <TextField.Root
                    type="password"
                    placeholder="2FA 验证码"
                    value={twoFaCode}
                    onChange={(e) => setTwoFaCode(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") void confirm(pendingRevision); }}
                  />
                  <Button
                    onClick={() => void confirm(pendingRevision)}
                    disabled={confirming || !twoFaCode.trim()}
                  >
                    <CheckCircle2 size={14} />确认变更
                  </Button>
                </Flex>
              </>
            )}

            {pendingRevision.state === PrivilegedDeliveryState.NEEDS_MANUAL_AUTHORIZATION &&
              pendingRevision.plan?.manualTask && (
              <ManualTaskCard task={pendingRevision.plan.manualTask} />
            )}
          </Flex>
        </Card>
      )}

      {/* ── new revision form ── */}
      {selectedAgent && (
        <Card>
          <Flex direction="column" gap="3" p="4">
            <Flex align="center" justify="between">
              <Text size="3" weight="medium">下发新配置</Text>
              <Button variant="ghost" size="1" onClick={() => setShowForm((v) => !v)}>
                <ChevronDown size={14} style={{ transform: showForm ? "rotate(180deg)" : undefined, transition: "transform 0.15s" }} />
                {showForm ? "收起" : "展开"}
              </Button>
            </Flex>
            {showForm && (
              <Flex direction="column" gap="3">
                <ToggleRow label="远程控制" value={newRemoteControl} onChange={setNewRemoteControl} />
                <ToggleRow label="WebSSH" value={newWebSSH} onChange={setNewWebSSH} />
                <ToggleRow label="远程执行" value={newExecution} onChange={setNewExecution} />
                <ToggleRow label="救援辅助程序" value={newRescueHelper} onChange={setNewRescueHelper} />
                <Flex direction="column" gap="1">
                  <Text size="1" color="gray">变更原因（可选，会显示给机器上的操作者）</Text>
                  <TextField.Root
                    value={newReason}
                    onChange={(e) => setNewReason(e.target.value)}
                    placeholder="例如：开启远程控制以便排查故障"
                  />
                </Flex>
                <Flex justify="end">
                  <Button onClick={() => void saveRevision()} disabled={saving}>
                    {saving ? <RefreshCw size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                    保存并等待确认
                  </Button>
                </Flex>
              </Flex>
            )}
          </Flex>
        </Card>
      )}

      {/* ── history ── */}
      {selectedAgent && (
        <Card>
          <Flex direction="column" gap="2" p="4">
            <Flex align="center" justify="between">
              <Text size="3" weight="medium">历史记录</Text>
              <Button variant="ghost" size="1" onClick={() => void loadHistory(selectedAgent)} disabled={loading}>
                <RefreshCw size={14} className={loading ? "animate-spin" : undefined} />刷新
              </Button>
            </Flex>
            {loading && <Text size="2" color="gray">加载中…</Text>}
            {!loading && revisions.length === 0 && (
              <Text size="2" color="gray">暂无记录。</Text>
            )}
            {revisions.map((r) => {
              const info = stateInfo(r.state);
              const isApplied = r.revision === appliedRevision;
              return (
                <Flex key={String(r.revision)} direction="column" gap="1">
                  <Separator size="4" />
                  <Flex align="center" gap="2" wrap="wrap">
                    <Text size="2" weight="medium">r{r.revision.toString()}</Text>
                    <Badge color={info.color} size="1">{info.icon}{info.label}</Badge>
                    {isApplied && <Badge color="green" size="1">当前运行</Badge>}
                    {r.plan && (
                      <Text size="1" color="gray">{upgradeClassLabel(r.plan.upgradeClass)}</Text>
                    )}
                    <Text size="1" color="gray">{formatTime(r.savedAt)}</Text>
                  </Flex>
                  {r.errors && r.errors.length > 0 && (
                    <Text size="1" color="red">{r.errors[0].message}</Text>
                  )}
                </Flex>
              );
            })}
          </Flex>
        </Card>
      )}
    </div>
  );
}

// ─── ManualTaskCard ───────────────────────────────────────────────────────────

function ManualTaskCard({ task }: { task: NonNullable<NonNullable<PrivilegedRevision["plan"]>["manualTask"]> }) {
  const expiresDate = React.useMemo(() => {
    if (!task.expiresAt) return null;
    try {
      return timestampDate(task.expiresAt);
    } catch { return null; }
  }, [task.expiresAt]);

  const countdown = useCountdown(expiresDate);
  const isExpired = expiresDate && expiresDate.getTime() < Date.now();

  const copyCommand = () => {
    if (!task.command) return;
    navigator.clipboard.writeText(task.command).then(() => toast.success("命令已复制"));
  };

  return (
    <Callout.Root color={isExpired ? "red" : "orange"} size="1">
      <Callout.Icon><ShieldAlert size={13} /></Callout.Icon>
      <Callout.Text>
        <Flex direction="column" gap="2">
          <Text size="2">
            此变更跨越权限级别，需要在机器上以管理员权限运行升级命令。面板已确认，等待机器上执行。
          </Text>

          {task.requireLocalPassword && (
            <Text size="1" color="gray">本次升级需要本地系统认证（sudo 密码或 PAM）</Text>
          )}

          {countdown && (
            <Flex align="center" gap="1">
              <Clock size={12} />
              <Text size="1" color={isExpired ? "red" : "orange"}>{countdown}</Text>
            </Flex>
          )}

          {task.command && (
            <Flex direction="column" gap="1">
              <Text size="1" weight="medium" color="gray">在机器上运行：</Text>
              <Flex gap="2" align="start">
                <code
                  style={{
                    fontFamily: "monospace",
                    fontSize: "12px",
                    background: "var(--gray-a3)",
                    padding: "6px 10px",
                    borderRadius: "4px",
                    wordBreak: "break-all",
                    flex: 1,
                  }}
                >
                  {task.command}
                </code>
                <Button variant="soft" size="1" onClick={copyCommand} title="复制命令">
                  <Copy size={12} />
                  复制
                </Button>
              </Flex>
            </Flex>
          )}

          {task.taskId && (
            <Text size="1" color="gray" style={{ fontFamily: "monospace" }}>
              任务 ID：{task.taskId}
            </Text>
          )}
        </Flex>
      </Callout.Text>
    </Callout.Root>
  );
}

// ─── sub-components ───────────────────────────────────────────────────────────

function RevisionDetail({ revision }: { revision: PrivilegedRevision }) {
  const p = revision.privileged;
  if (!p) return null;
  return (
    <Flex direction="column" gap="1">
      <SettingRow label="远程控制" value={p.remoteControlEnabled} />
      <SettingRow label="WebSSH" value={p.websshEnabled} />
      <SettingRow label="远程执行" value={p.executionEnabled} />
      <SettingRow label="救援辅助程序" value={p.rescueHelperEnabled} />
      {revision.plan?.reasons && revision.plan.reasons.length > 0 && (
        <Flex direction="column" gap="1" mt="1">
          {revision.plan.reasons.map((r, i) => (
            <Text key={i} size="1" color="gray">• {r}</Text>
          ))}
        </Flex>
      )}
    </Flex>
  );
}

function SettingRow({ label, value }: { label: string; value: boolean | undefined }) {
  return (
    <Flex gap="2" align="center">
      <Text size="2" style={{ width: "120px" }} color="gray">{label}</Text>
      <Badge color={value ? "green" : "gray"} size="1">{value ? "开启" : "关闭"}</Badge>
    </Flex>
  );
}

function ToggleRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <Flex gap="2" align="center">
      <Text size="2" style={{ width: "120px" }} color="gray">{label}</Text>
      <Select.Root value={value} onValueChange={onChange}>
        <Select.Trigger />
        <Select.Content>
          <Select.Item value="off">关闭</Select.Item>
          <Select.Item value="on">开启</Select.Item>
        </Select.Content>
      </Select.Root>
    </Flex>
  );
}
