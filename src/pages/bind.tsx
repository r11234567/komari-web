import * as React from "react";
import { Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
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
import { Code, ConnectError } from "@connectrpc/connect";
import { connectUnary, connectClients } from "@/api/connect/client";
import {
  EnrollmentState,
  type PendingEnrollment,
  type EnrollmentCandidate,
} from "@komari/proto/komari/enrollment/v1/enrollment_pb";
import { AccountProvider, useAccount } from "@/contexts/AccountContext";
import {
  getStoredBindTicket,
  clearStoredBindTicket,
  getBindTicketRemainingSeconds,
  formatTicketTime,
} from "@/utils/bindTicket";
import { bindLoginPath } from "@/utils/loginRedirect";

const TICKET_FAILURE_REASONS = new Set([
  "bind_ticket_missing",
  "bind_ticket_expired",
  "bind_ticket_invalid",
  "bind_ticket_subject_mismatch",
  "console_session_required",
]);

function describeBindError(error: unknown, fallback: string) {
  const connectError = ConnectError.from(error);
  const reason = connectError.metadata.get("bind-ticket-reason") ?? "";
  return {
    message: connectError.rawMessage || fallback,
    reason,
    invalidatesTicket:
      TICKET_FAILURE_REASONS.has(reason) ||
      (reason === "" &&
        (connectError.code === Code.PermissionDenied ||
          connectError.code === Code.Unauthenticated)),
  };
}

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

interface BindPageContentProps {
  initialTicket: string;
}

const BindPageContent = ({ initialTicket }: BindPageContentProps) => {
  const [params] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { account } = useAccount();

  const initialCode = (params.get("code") ?? "").toUpperCase();
  const [code, setCode] = React.useState(initialCode);
  const [inputCode, setInputCode] = React.useState(initialCode);
  const [enrollment, setEnrollment] = React.useState<PendingEnrollment | null>(null);
  const [candidates, setCandidates] = React.useState<EnrollmentCandidate[]>([]);
  const [allServers, setAllServers] = React.useState<SimpleNode[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [approving, setApproving] = React.useState(false);

  // Reusable two-minute authorization window created after a completed login.
  const [bindTicket, setBindTicket] = React.useState<string | null>(initialTicket);
  const [ticketTimeLeft, setTicketTimeLeft] = React.useState<number>(getBindTicketRemainingSeconds());

  // new-machine form
  const [newName, setNewName] = React.useState("");
  const [newGroup, setNewGroup] = React.useState("");
  const [newRemark, setNewRemark] = React.useState("");

  // existing-machine binding
  const [bindTarget, setBindTarget] = React.useState("");
  const [confirmBindOpen, setConfirmBindOpen] = React.useState(false);

  const [lookupError, setLookupError] = React.useState<string | null>(null);
  const initialLookupDoneRef = React.useRef(false);
  const abortRef = React.useRef<AbortController | null>(null);

  // Ticket live countdown timer
  React.useEffect(() => {
    const updateCountdown = () => {
      const remaining = getBindTicketRemainingSeconds();
      setTicketTimeLeft(remaining);
      if (remaining <= 0) {
        clearStoredBindTicket();
        setBindTicket(null);
        toast.warning("绑定小票已过期，请重新登录");
        navigate(bindLoginPath(location.pathname, location.search, location.hash), { replace: true });
      }
    };
    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [location.hash, location.pathname, location.search, navigate]);

  const lookup = React.useCallback(async (lookupCode: string, overrideTicket?: string) => {
    const trimmed = lookupCode.trim().toUpperCase();
    if (!trimmed) return;
    const ticketToUse = overrideTicket ?? bindTicket;
    if (!ticketToUse) {
      clearStoredBindTicket();
      setBindTicket(null);
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
        const failure = describeBindError(err, "验证码不存在或已过期");
        setLookupError(failure.message);
        toast.error(failure.message);
        if (failure.invalidatesTicket) {
          clearStoredBindTicket();
          setBindTicket(null);
          navigate(bindLoginPath(location.pathname, location.search, location.hash), {
            replace: true,
          });
        }
      }
    } finally {
      if (abortRef.current === controller) {
        setLoading(false);
      }
    }
  }, [bindTicket, location.hash, location.pathname, location.search, navigate]);

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
    if (initialCode && !initialLookupDoneRef.current && initialTicket) {
      initialLookupDoneRef.current = true;
      void lookup(initialCode, initialTicket);
    }
  }, [initialCode, initialTicket, lookup]);

  React.useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const approveNew = async () => {
    if (!enrollment) return;
    if (!bindTicket) {
      toast.error("绑定小票已过期，请重新登录");
      navigate(bindLoginPath(location.pathname, location.search, location.hash), { replace: true });
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
      toast.success(`机器已成功注册：${response.agentId}`);
      window.location.assign("/admin/servers");
    } catch (err) {
      const failure = describeBindError(err, "注册失败");
      toast.error(failure.message);
      if (failure.invalidatesTicket) {
        clearStoredBindTicket();
        setBindTicket(null);
        navigate(bindLoginPath(location.pathname, location.search, location.hash), { replace: true });
      }
    } finally {
      setApproving(false);
    }
  };

  const approveBind = async () => {
    if (!enrollment || !bindTarget) return;
    if (!bindTicket) {
      toast.error("绑定小票已过期，请重新登录");
      navigate(bindLoginPath(location.pathname, location.search, location.hash), { replace: true });
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
          },
          { signal, timeoutMs, headers: { "X-Bind-Ticket": bindTicket } },
        ),
      );
      toast.success("已成功绑定到已有机器");
      window.location.assign("/admin/servers");
    } catch (err) {
      const failure = describeBindError(err, "绑定失败");
      toast.error(failure.message);
      if (failure.invalidatesTicket) {
        clearStoredBindTicket();
        setBindTicket(null);
        navigate(bindLoginPath(location.pathname, location.search, location.hash), { replace: true });
      }
    } finally {
      setApproving(false);
    }
  };

  const deny = async () => {
    if (!enrollment) return;
    if (!bindTicket) {
      toast.error("绑定小票已过期，请重新登录");
      navigate(bindLoginPath(location.pathname, location.search, location.hash), { replace: true });
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
      toast.success("申请已拒绝");
      setEnrollment(null);
    } catch (err) {
      const failure = describeBindError(err, "拒绝失败");
      toast.error(failure.message);
      if (failure.invalidatesTicket) {
        clearStoredBindTicket();
        setBindTicket(null);
        navigate(bindLoginPath(location.pathname, location.search, location.hash), { replace: true });
      }
    }
  };

  const st = enrollment ? stateLabel(enrollment.state) : null;
  const isPending = enrollment?.state === EnrollmentState.PENDING;

  return (
    <div className="max-w-2xl mx-auto p-6 flex flex-col gap-6">
      <Flex justify="between" align="center" wrap="wrap" gap="2">
        <Flex align="center" gap="3">
          <UserPlus size={22} className="text-blue-500" />
          <Text size="5" weight="bold">机器绑定与授权</Text>
          {ticketTimeLeft > 0 && (
            <Badge color={ticketTimeLeft > 30 ? "green" : "red"} variant="soft" size="2">
              <Clock size={12} className="mr-1" />
              授权有效剩余时间：{formatTicketTime(ticketTimeLeft)}
            </Badge>
          )}
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
              将申请客户端绑定到系统中已存在的节点（保留原有监控历史与数据）。当前两分钟授权已覆盖此操作，请核对目标机器后确认。
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

      {/* ── bind confirm dialog ── */}
      <Dialog.Root open={confirmBindOpen} onOpenChange={setConfirmBindOpen}>
        <Dialog.Content maxWidth="420px">
          <Dialog.Title>确认绑定到已有机器</Dialog.Title>
          <Dialog.Description size="2" color="gray">
            绑定操作会将目标机器的历史记录及权限授予当前申请设备。请确认设备信息和目标机器无误。
          </Dialog.Description>
          <Flex gap="2" justify="end" mt="4">
            <Dialog.Close>
              <Button variant="soft" color="gray">取消</Button>
            </Dialog.Close>
            <Button
              color="red"
              onClick={() => void approveBind()}
              disabled={approving}
            >
              {approving ? <RefreshCw size={14} className="animate-spin" /> : "确认并绑定"}
            </Button>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>
    </div>
  );
};

const BindAuthGate = () => {
  const { account, loading: accountLoading } = useAccount();
  const location = useLocation();
  const storedTicket = getStoredBindTicket();

  if (accountLoading) {
    return (
      <Flex align="center" justify="center" p="6" style={{ minHeight: "50vh" }}>
        <RefreshCw size={24} className="animate-spin text-gray-400" />
      </Flex>
    );
  }

  if (!account?.logged_in || !storedTicket) {
    return (
      <Navigate
        to={bindLoginPath(location.pathname, location.search, location.hash)}
        replace
      />
    );
  }

  return <BindPageContent initialTicket={storedTicket.ticket} />;
};

export default function BindPage() {
  return (
    <AccountProvider>
      <BindAuthGate />
    </AccountProvider>
  );
}
