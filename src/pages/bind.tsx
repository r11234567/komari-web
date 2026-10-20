import * as React from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import {
  Badge,
  Button,
  Card,
  Callout,
  Dialog,
  Flex,
  Select,
  Separator,
  Text,
  TextField,
} from "@radix-ui/themes";
import {
  CheckCircle2,
  Clock,
  Lock,
  MonitorSmartphone,
  RefreshCw,
  Server,
  ShieldAlert,
  UserCheck,
  UserPlus,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { connectUnary, connectClients } from "@/api/connect/client";
import { create } from "@bufbuild/protobuf";
import { TwoFactorProofSchema } from "@komari/proto/komari/common/v1/common_pb";
import {
  EnrollmentState,
  type PendingEnrollment,
  type EnrollmentCandidate,
} from "@komari/proto/komari/enrollment/v1/enrollment_pb";
import { AccountProvider, useAccount } from "@/contexts/AccountContext";

function stateLabel(state: EnrollmentState) {
  switch (state) {
    case EnrollmentState.PENDING:
      return { label: "待批准", color: "orange" as const };
    case EnrollmentState.APPROVED:
      return { label: "已批准", color: "green" as const };
    case EnrollmentState.DENIED:
      return { label: "已拒绝", color: "red" as const };
    case EnrollmentState.EXPIRED:
      return { label: "已过期", color: "gray" as const };
    default:
      return { label: "未知", color: "gray" as const };
  }
}

type SimpleNode = {
  uuid: string;
  name: string;
};

const BindPageContent = () => {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { account, loading: accountLoading } = useAccount();

  const initialCode = (params.get("code") ?? "").toUpperCase();
  const [code, setCode] = React.useState(initialCode);
  const [inputCode, setInputCode] = React.useState(initialCode);
  const [enrollment, setEnrollment] = React.useState<PendingEnrollment | null>(null);
  const [candidates, setCandidates] = React.useState<EnrollmentCandidate[]>([]);
  const [allServers, setAllServers] = React.useState<SimpleNode[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [approving, setApproving] = React.useState(false);

  // Bind Ticket (2-minute single-use ticket protection)
  const [bindTicket, setBindTicket] = React.useState<string | null>(null);
  const [ticketExpiresAt, setTicketExpiresAt] = React.useState<number | null>(null);
  const [ticketTimeLeft, setTicketTimeLeft] = React.useState<number>(0);
  const [ticketUsername, setTicketUsername] = React.useState(account?.username || "admin");
  const [ticketPassword, setTicketPassword] = React.useState("");
  const [ticket2FA, setTicket2FA] = React.useState("");
  const [requestingTicket, setRequestingTicket] = React.useState(false);
  const [ticketError, setTicketError] = React.useState<string | null>(null);

  // new-machine form
  const [newName, setNewName] = React.useState("");
  const [newGroup, setNewGroup] = React.useState("");
  const [newRemark, setNewRemark] = React.useState("");

  // existing-machine binding
  const [bindTarget, setBindTarget] = React.useState("");
  const [twoFaCode, setTwoFaCode] = React.useState("");
  const [confirmBindOpen, setConfirmBindOpen] = React.useState(false);

  const [lookupError, setLookupError] = React.useState<string | null>(null);
  const initialLookupDoneRef = React.useRef(false);
  const abortRef = React.useRef<AbortController | null>(null);

  // Sync ticketUsername if account changes
  React.useEffect(() => {
    if (account?.username && (!ticketUsername || ticketUsername === "admin")) {
      setTicketUsername(account.username);
    }
  }, [account?.username, ticketUsername]);

  // Ticket live countdown timer
  React.useEffect(() => {
    if (!ticketExpiresAt || !bindTicket) {
      setTicketTimeLeft(0);
      return;
    }
    const updateCountdown = () => {
      const remaining = Math.max(0, Math.floor((ticketExpiresAt - Date.now()) / 1000));
      setTicketTimeLeft(remaining);
      if (remaining === 0) {
        setBindTicket(null);
        setTicketExpiresAt(null);
        toast.warning("绑定小票已过期，请重新认证");
      }
    };
    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [ticketExpiresAt, bindTicket]);

  const formatTicketTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  // Acquire 2-minute bind ticket via POST /api/bind/ticket (does NOT touch console session)
  const handleRequestTicket = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!ticketPassword) {
      toast.error("请输入管理员密码");
      return;
    }
    setRequestingTicket(true);
    setTicketError(null);
    try {
      const res = await fetch("/api/bind/ticket", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: ticketUsername.trim(),
          password: ticketPassword,
          two_fa_code: ticket2FA.trim(),
        }),
      });
      const data = await res.json();
      if (data.status !== "success" || !data.data?.ticket) {
        throw new Error(data.message || "获取小票失败，请检查账号密码");
      }
      const ticket = data.data.ticket;
      const duration = data.data.duration_seconds || 120;
      setBindTicket(ticket);
      setTicketExpiresAt(Date.now() + duration * 1000);
      setTicketPassword("");
      setTicket2FA("");
      toast.success("已获取绑定小票，有效期 2 分钟");

      if (initialCode && !initialLookupDoneRef.current) {
        initialLookupDoneRef.current = true;
        void lookup(initialCode, ticket);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "获取小票失败";
      setTicketError(msg);
      toast.error(msg);
    } finally {
      setRequestingTicket(false);
    }
  };

  const lookup = React.useCallback(async (lookupCode: string, overrideTicket?: string) => {
    const trimmed = lookupCode.trim().toUpperCase();
    if (!trimmed) return;
    const ticketToUse = overrideTicket ?? bindTicket;
    if (!ticketToUse) {
      toast.error("请先获取绑定小票");
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setLookupError(null);
    setEnrollment(null);
    setCandidates([]);
    try {
      const response = await connectUnary({ signal: controller.signal }, (signal, timeoutMs) =>
        connectClients.enrollmentAdmin.getPendingEnrollment(
          { userCode: trimmed },
          { signal, timeoutMs, headers: { "X-Bind-Ticket": ticketToUse } },
        ),
      );
      if (!controller.signal.aborted) {
        setEnrollment(response.enrollment ?? null);
        setCandidates(response.candidates ?? []);
        if (response.enrollment?.device?.hostname) {
          setNewName((prev) => prev || response.enrollment?.device?.hostname || "");
        }
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        const msg = err instanceof Error ? err.message : "验证码不存在或已过期";
        setLookupError(msg);
        toast.error(msg);
        if (msg.toLowerCase().includes("ticket") || msg.includes("小票") || msg.toLowerCase().includes("unauthenticated")) {
          setBindTicket(null);
          setTicketExpiresAt(null);
        }
      }
    } finally {
      if (abortRef.current === controller) {
        setLoading(false);
      }
    }
  }, [bindTicket]);

  // Load all server nodes for manual bind selection
  const loadServers = React.useCallback(async () => {
    try {
      const res = await connectUnary({ signal: new AbortController().signal }, (signal, timeoutMs) =>
        connectClients.browser.listAgents({}, { signal, timeoutMs }),
      );
      setAllServers(res.agents.map((a) => ({ uuid: a.agentId, name: a.name })));
    } catch {
      // Non-critical; fallback to candidates
    }
  }, []);

  React.useEffect(() => {
    if (account?.logged_in) {
      void loadServers();
    }
  }, [account?.logged_in, loadServers]);

  React.useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const approveNew = async () => {
    if (!enrollment) return;
    if (!bindTicket) {
      toast.error("绑定小票已过期，请重新认证");
      return;
    }
    if (!newName.trim()) {
      toast.error("机器名称不能为空");
      return;
    }
    setApproving(true);
    const controller = new AbortController();
    try {
      const response = await connectUnary({ signal: controller.signal }, (signal, timeoutMs) =>
        connectClients.enrollmentAdmin.approveEnrollment(
          {
            userCode: code,
            target: {
              case: "newAgent",
              value: {
                name: newName.trim(),
                group: newGroup.trim(),
                remark: newRemark.trim(),
              },
            },
          },
          { signal, timeoutMs, headers: { "X-Bind-Ticket": bindTicket } },
        ),
      );
      // Consumed single-use ticket
      setBindTicket(null);
      setTicketExpiresAt(null);
      toast.success(`机器已成功注册：${response.agentId}`);
      navigate("/admin/servers");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "注册失败";
      toast.error(msg);
      if (msg.toLowerCase().includes("ticket") || msg.includes("小票") || msg.toLowerCase().includes("unauthenticated")) {
        setBindTicket(null);
        setTicketExpiresAt(null);
      }
    } finally {
      setApproving(false);
    }
  };

  const approveBind = async () => {
    if (!enrollment || !bindTarget || !twoFaCode.trim()) return;
    if (!bindTicket) {
      toast.error("绑定小票已过期，请重新认证");
      return;
    }
    setApproving(true);
    setConfirmBindOpen(false);
    const controller = new AbortController();
    try {
      await connectUnary({ signal: controller.signal }, (signal, timeoutMs) =>
        connectClients.enrollmentAdmin.approveEnrollment(
          {
            userCode: code,
            target: { case: "existingAgentId", value: bindTarget },
            twoFactor: create(TwoFactorProofSchema, { code: twoFaCode.trim() }),
          },
          { signal, timeoutMs, headers: { "X-Bind-Ticket": bindTicket } },
        ),
      );
      // Consumed single-use ticket
      setBindTicket(null);
      setTicketExpiresAt(null);
      toast.success("已成功绑定到已有机器");
      navigate("/admin/servers");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "绑定失败，请核对 2FA 验证码";
      toast.error(msg);
      if (msg.toLowerCase().includes("ticket") || msg.includes("小票") || msg.toLowerCase().includes("unauthenticated")) {
        setBindTicket(null);
        setTicketExpiresAt(null);
      }
    } finally {
      setApproving(false);
    }
  };

  const deny = async () => {
    if (!enrollment) return;
    if (!bindTicket) {
      toast.error("绑定小票已过期，请重新认证");
      return;
    }
    const controller = new AbortController();
    try {
      await connectUnary({ signal: controller.signal }, (signal, timeoutMs) =>
        connectClients.enrollmentAdmin.denyEnrollment(
          { userCode: code },
          { signal, timeoutMs, headers: { "X-Bind-Ticket": bindTicket } },
        ),
      );
      setBindTicket(null);
      setTicketExpiresAt(null);
      toast.success("申请已拒绝");
      setEnrollment(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "拒绝失败";
      toast.error(msg);
      if (msg.toLowerCase().includes("ticket") || msg.includes("小票") || msg.toLowerCase().includes("unauthenticated")) {
        setBindTicket(null);
        setTicketExpiresAt(null);
      }
    }
  };

  if (accountLoading) {
    return (
      <Flex align="center" justify="center" p="6" style={{ minHeight: "50vh" }}>
        <RefreshCw size={24} className="animate-spin text-gray-400" />
      </Flex>
    );
  }

  const st = enrollment ? stateLabel(enrollment.state) : null;
  const isPending = enrollment?.state === EnrollmentState.PENDING;

  return (
    <div className="max-w-2xl mx-auto p-6 flex flex-col gap-6">
      <Flex justify="between" align="center" wrap="wrap" gap="2">
        <Flex align="center" gap="2">
          <UserPlus size={22} className="text-blue-500" />
          <Text size="5" weight="bold">机器绑定与授权</Text>
        </Flex>
        <Flex align="center" gap="2">
          {account?.logged_in && (
            <Badge color="green" variant="soft" size="2">
              <UserCheck size={12} className="mr-1" />
              控制台登录：{account.username}
            </Badge>
          )}
          <Button
            size="1"
            variant="ghost"
            color="gray"
            onClick={() => navigate("/admin/servers")}
          >
            返回服务器管理
          </Button>
        </Flex>
      </Flex>

      {/* ── Ticket Authentication Guard (requires 2-minute single-use ticket) ── */}
      {!bindTicket ? (
        <Card size="3" className="shadow-sm border">
          <Flex direction="column" gap="4" p="4">
            <Flex align="center" gap="2">
              <Lock size={20} className="text-orange-500" />
              <Text size="4" weight="bold">绑定授权安全守卫（两分钟一次性小票）</Text>
            </Flex>
            <Text size="2" color="gray">
              绑定与授权设备属于高特权操作。为保障安全，必须验证管理员身份以签发 2 分钟有效期的单次绑定小票。此验证不修改或吊销您当前控制台登录会话。
            </Text>
            {initialCode && (
              <Callout.Root color="blue" size="1">
                <Callout.Icon><MonitorSmartphone size={14} /></Callout.Icon>
                <Callout.Text>
                  待验证设备码：<code>{initialCode}</code>
                </Callout.Text>
              </Callout.Root>
            )}
            <form onSubmit={handleRequestTicket}>
              <Flex direction="column" gap="3" style={{ maxWidth: "420px" }}>
                <Flex direction="column" gap="1">
                  <Text size="1" weight="medium" color="gray">管理员用户名</Text>
                  <TextField.Root
                    value={ticketUsername}
                    onChange={(e) => setTicketUsername(e.target.value)}
                    placeholder="admin"
                    required
                  />
                </Flex>
                <Flex direction="column" gap="1">
                  <Text size="1" weight="medium" color="gray">管理员密码</Text>
                  <TextField.Root
                    type="password"
                    value={ticketPassword}
                    onChange={(e) => setTicketPassword(e.target.value)}
                    placeholder="请输入管理员密码"
                    required
                  />
                </Flex>
                <Flex direction="column" gap="1">
                  <Text size="1" weight="medium" color="gray">2FA 动态码（如已启用）</Text>
                  <TextField.Root
                    value={ticket2FA}
                    onChange={(e) => setTicket2FA(e.target.value)}
                    placeholder="6 位 TOTP 动态码（未启用可留空）"
                  />
                </Flex>
                {ticketError && (
                  <Callout.Root color="red" size="1">
                    <Callout.Icon><XCircle size={14} /></Callout.Icon>
                    <Callout.Text>{ticketError}</Callout.Text>
                  </Callout.Root>
                )}
                <Button type="submit" disabled={requestingTicket} size="2" color="orange" className="mt-1">
                  {requestingTicket ? <RefreshCw size={14} className="animate-spin" /> : "获取绑定小票并开始操作"}
                </Button>
              </Flex>
            </form>
          </Flex>
        </Card>
      ) : (
        <>
          {/* Active Ticket Banner */}
          <Flex justify="between" align="center" wrap="wrap" gap="2" className="p-3 bg-[var(--gray-a2)] rounded-lg border">
            <Flex align="center" gap="2">
              <Clock size={16} className={ticketTimeLeft > 30 ? "text-green-500" : "text-red-500"} />
              <Badge color={ticketTimeLeft > 30 ? "green" : "red"} size="2">
                绑定小票有效剩余时间：{formatTicketTime(ticketTimeLeft)}
              </Badge>
              <Text size="1" color="gray">一次性小票，执行审批后自动核销</Text>
            </Flex>
            <Button
              size="1"
              variant="soft"
              color="gray"
              onClick={() => {
                setBindTicket(null);
                setTicketExpiresAt(null);
                toast.info("已清空绑定小票，请重新认证");
              }}
            >
              重新认证
            </Button>
          </Flex>

          {/* ── code lookup ── */}
          <Card>
            <Flex direction="column" gap="3" p="4">
              <Text size="3" weight="bold">1. 输入设备验证码</Text>
              <Text size="2" color="gray">
                在目标机器上运行 <code>komari-agent login</code> 或 <code>komari-agent enroll</code>，将终端中显示的 8 位验证码填入此处进行查询。
              </Text>
              <Flex gap="2" align="center">
                <TextField.Root
                  placeholder="ABCD-EFGH"
                  value={inputCode}
                  onChange={(e) => setInputCode(e.target.value.toUpperCase())}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      setCode(inputCode);
                      void lookup(inputCode);
                    }
                  }}
                  style={{ fontFamily: "monospace", letterSpacing: "0.1em", width: "200px" }}
                />
                <Button
                  variant="solid"
                  onClick={() => {
                    setCode(inputCode);
                    void lookup(inputCode);
                  }}
                  disabled={loading || !inputCode.trim()}
                >
                  {loading ? <RefreshCw size={14} className="animate-spin" /> : "查询验证码"}
                </Button>
              </Flex>
              {lookupError && (
                <Callout.Root color="red" size="1">
                  <Callout.Icon><XCircle size={14} /></Callout.Icon>
                  <Callout.Text>{lookupError}</Callout.Text>
                </Callout.Root>
              )}
            </Flex>
          </Card>

          {/* ── enrollment info ── */}
          {enrollment && (
            <Card>
              <Flex direction="column" gap="3" p="4">
                <Flex align="center" justify="between">
                  <Flex align="center" gap="2">
                    <MonitorSmartphone size={18} className="text-blue-500" />
                    <Text size="3" weight="bold">2. 申请设备详情</Text>
                  </Flex>
                  {st && <Badge color={st.color} size="2">{st.label}</Badge>}
                </Flex>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm bg-[var(--gray-a2)] p-3 rounded-md">
                  {enrollment.device?.hostname && (
                    <div><span className="text-gray-500">报告主机名：</span><code>{enrollment.device.hostname}</code></div>
                  )}
                  {enrollment.device?.operatingSystem && (
                    <div><span className="text-gray-500">操作系统：</span>{enrollment.device.operatingSystem} ({enrollment.device?.architecture})</div>
                  )}
                  {enrollment.remoteIp && (
                    <div><span className="text-gray-500">来源 IP：</span><code>{enrollment.remoteIp}</code></div>
                  )}
                </div>

                {enrollment.agentKeyFingerprint && (
                  <Flex direction="column" gap="1" mt="1">
                    <Text size="1" color="gray">客户端公钥指纹 (SHA-256)</Text>
                    <div className="p-2 bg-[var(--gray-a3)] rounded font-mono text-xs break-all">
                      {enrollment.agentKeyFingerprint}
                    </div>
                  </Flex>
                )}

                <Callout.Root color="blue" size="1">
                  <Callout.Icon><ShieldAlert size={14} /></Callout.Icon>
                  <Callout.Text>
                    安全核验：请确认终端打印的公钥指纹与上方一致，防止中间人伪造请求。
                  </Callout.Text>
                </Callout.Root>

                {!isPending && (
                  <Callout.Root color="gray" size="1">
                    <Callout.Text>该验证码申请已处于「{st?.label}」状态，无法继续执行审批。</Callout.Text>
                  </Callout.Root>
                )}
              </Flex>
            </Card>
          )}

          {/* ── action: new machine ── */}
          {enrollment && isPending && (
            <Card>
              <Flex direction="column" gap="3" p="4">
                <Flex align="center" gap="2">
                  <Server size={18} className="text-green-600" />
                  <Text size="3" weight="bold">选项 A：接入为新机器</Text>
                </Flex>
                <Text size="2" color="gray">
                  在监控面板中创建一台全新的节点记录并分配新的机器编号。
                </Text>
                <Flex direction="column" gap="2">
                  <Flex direction="column" gap="1">
                    <Text size="1" color="gray">机器名称 *</Text>
                    <TextField.Root
                      placeholder={enrollment.device?.hostname ?? "my-server"}
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                    />
                  </Flex>
                  <Flex direction="column" gap="1">
                    <Text size="1" color="gray">分组（可选）</Text>
                    <TextField.Root
                      placeholder="default"
                      value={newGroup}
                      onChange={(e) => setNewGroup(e.target.value)}
                    />
                  </Flex>
                  <Flex direction="column" gap="1">
                    <Text size="1" color="gray">备注（可选）</Text>
                    <TextField.Root
                      placeholder="节点备注信息"
                      value={newRemark}
                      onChange={(e) => setNewRemark(e.target.value)}
                    />
                  </Flex>
                </Flex>
                <Flex gap="2" justify="end" mt="2">
                  <Button color="red" variant="soft" onClick={() => void deny()} disabled={approving}>
                    <XCircle size={14} />拒绝申请
                  </Button>
                  <Button onClick={() => void approveNew()} disabled={approving || !newName.trim()}>
                    <CheckCircle2 size={14} />确认作为新机器接入
                  </Button>
                </Flex>
              </Flex>
            </Card>
          )}

          {/* ── action: bind to existing ── */}
          {enrollment && isPending && (
            <Card>
              <Flex direction="column" gap="3" p="4">
                <Flex align="center" gap="2">
                  <Lock size={18} className="text-orange-500" />
                  <Text size="3" weight="bold">选项 B：绑定到已有机器</Text>
                </Flex>
                <Text size="2" color="gray">
                  将申请客户端绑定到系统中已存在的节点（保留原有监控历史与数据），该操作会替换目标节点的认证凭据，需要提供管理员 2FA 双因素口令确认。
                </Text>
                <Separator size="4" />

                {candidates.length > 0 && (
                  <Flex direction="column" gap="2">
                    <Text size="2" weight="medium">推荐匹配的机器：</Text>
                    {candidates.map((c) => (
                      <Flex key={c.agentId} align="center" justify="between" gap="2" p="2" className="border rounded-md">
                        <Flex direction="column" gap="1">
                          <Flex align="center" gap="2">
                            <Text size="2" weight="bold">{c.name}</Text>
                            {c.fingerprintMatch && <Badge color="green" size="1">指纹完全匹配</Badge>}
                          </Flex>
                          <Text size="1" color="gray">{c.matchReason || c.agentId}</Text>
                        </Flex>
                        <Button
                          size="2"
                          variant="soft"
                          color="orange"
                          onClick={() => {
                            setBindTarget(c.agentId);
                            setConfirmBindOpen(true);
                          }}
                          disabled={approving}
                        >
                          绑定到此机器
                        </Button>
                      </Flex>
                    ))}
                  </Flex>
                )}

                {allServers.length > 0 && (
                  <Flex direction="column" gap="2" mt="2">
                    <Text size="2" weight="medium">或者从所有机器中手动选择：</Text>
                    <Flex gap="2" align="center">
                      <Select.Root value={bindTarget || undefined} onValueChange={setBindTarget}>
                        <Select.Trigger placeholder="选择目标机器..." style={{ minWidth: "220px" }} />
                        <Select.Content>
                          {allServers.map((s) => (
                            <Select.Item key={s.uuid} value={s.uuid}>
                              {s.name} ({s.uuid.slice(0, 8)}...)
                            </Select.Item>
                          ))}
                        </Select.Content>
                      </Select.Root>
                      <Button
                        variant="soft"
                        color="orange"
                        disabled={!bindTarget || approving}
                        onClick={() => setConfirmBindOpen(true)}
                      >
                        绑定
                      </Button>
                    </Flex>
                  </Flex>
                )}
              </Flex>
            </Card>
          )}

          {/* ── bind confirm dialog with 2FA ── */}
          <Dialog.Root open={confirmBindOpen} onOpenChange={setConfirmBindOpen}>
            <Dialog.Content maxWidth="420px">
              <Dialog.Title>确认绑定到已有机器</Dialog.Title>
              <Dialog.Description size="2" color="gray">
                绑定操作将目标机器的历史记录及权限授予当前申请设备。为确保安全，请输入管理员 2FA 动态口令完成授权。
              </Dialog.Description>
              <Flex direction="column" gap="3" mt="4">
                <Flex direction="column" gap="1">
                  <Text size="2" weight="medium">2FA 动态口令 (TOTP)</Text>
                  <TextField.Root
                    type="text"
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    placeholder="6 位动态验证码"
                    value={twoFaCode}
                    onChange={(e) => setTwoFaCode(e.target.value.trim())}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && twoFaCode.trim()) void approveBind();
                    }}
                    autoFocus
                  />
                </Flex>
                <Flex gap="2" justify="end" mt="2">
                  <Dialog.Close>
                    <Button variant="soft" color="gray">取消</Button>
                  </Dialog.Close>
                  <Button
                    color="red"
                    onClick={() => void approveBind()}
                    disabled={!twoFaCode.trim() || approving}
                  >
                    {approving ? <RefreshCw size={14} className="animate-spin" /> : "确认并绑定"}
                  </Button>
                </Flex>
              </Flex>
            </Dialog.Content>
          </Dialog.Root>
        </>
      )}
    </div>
  );
};

export default function BindPage() {
  return (
    <AccountProvider>
      <BindPageContent />
    </AccountProvider>
  );
}
