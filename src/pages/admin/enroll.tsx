import * as React from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import {
  Badge,
  Button,
  Card,
  Callout,
  Dialog,
  Flex,
  Text,
  TextField,
  Separator,
} from "@radix-ui/themes";
import {
  CheckCircle2,
  MonitorSmartphone,
  RefreshCw,
  ShieldAlert,
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

// ─── helpers ────────────────────────────────────────────────────────────────

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

// ─── main page ───────────────────────────────────────────────────────────────

export default function EnrollPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const initialCode = (params.get("code") ?? "").toUpperCase();

  const [code, setCode] = React.useState(initialCode);
  const [inputCode, setInputCode] = React.useState(initialCode);
  const [enrollment, setEnrollment] = React.useState<PendingEnrollment | null>(null);
  const [candidates, setCandidates] = React.useState<EnrollmentCandidate[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [approving, setApproving] = React.useState(false);

  // new-machine form
  const [newName, setNewName] = React.useState("");
  const [newGroup, setNewGroup] = React.useState("");
  const [newRemark, setNewRemark] = React.useState("");

  // existing-machine binding
  const [bindTarget, setBindTarget] = React.useState("");
  const [twoFaCode, setTwoFaCode] = React.useState("");
  const [confirmBindOpen, setConfirmBindOpen] = React.useState(false);

  const abortRef = React.useRef<AbortController | null>(null);

  const lookup = React.useCallback(async (lookupCode: string) => {
    const trimmed = lookupCode.trim().toUpperCase();
    if (!trimmed) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setEnrollment(null);
    setCandidates([]);
    try {
      const response = await connectUnary({ signal: controller.signal }, (signal, timeoutMs) =>
        connectClients.enrollmentAdmin.getPendingEnrollment(
          { userCode: trimmed },
          { signal, timeoutMs },
        ),
      );
      setEnrollment(response.enrollment ?? null);
      setCandidates(response.candidates ?? []);
      if (response.enrollment?.device?.hostname && !newName) {
        setNewName(response.enrollment.device.hostname);
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        toast.error(err instanceof Error ? err.message : "验证码不存在或已过期");
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [newName]);

  React.useEffect(() => {
    if (initialCode) void lookup(initialCode);
    return () => abortRef.current?.abort();
  }, []);  // only on mount

  const approveNew = async () => {
    if (!enrollment) return;
    if (!newName.trim()) { toast.error("机器名称不能为空"); return; }
    setApproving(true);
    try {
      const response = await connectUnary({ signal: new AbortController().signal }, (signal, timeoutMs) =>
        connectClients.enrollmentAdmin.approveEnrollment(
          {
            userCode: code,
            target: { case: "newAgent", value: { name: newName.trim(), group: newGroup.trim(), remark: newRemark.trim() } },
          },
          { signal, timeoutMs },
        ),
      );
      toast.success(`机器已注册：${response.agentId}`);
      navigate(`/admin/servers`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "注册失败");
    } finally {
      setApproving(false);
    }
  };

  const approveBind = async () => {
    if (!enrollment || !bindTarget || !twoFaCode.trim()) return;
    setApproving(true);
    setConfirmBindOpen(false);
    try {
      await connectUnary({ signal: new AbortController().signal }, (signal, timeoutMs) =>
        connectClients.enrollmentAdmin.approveEnrollment(
          {
            userCode: code,
            target: { case: "existingAgentId", value: bindTarget },
            twoFactor: create(TwoFactorProofSchema, { code: twoFaCode.trim() }),
          },
          { signal, timeoutMs },
        ),
      );
      toast.success("已绑定到已有机器");
      navigate(`/admin/servers`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "绑定失败");
    } finally {
      setApproving(false);
    }
  };

  const deny = async () => {
    if (!enrollment) return;
    try {
      await connectUnary({ signal: new AbortController().signal }, (signal, timeoutMs) =>
        connectClients.enrollmentAdmin.denyEnrollment({ userCode: code }, { signal, timeoutMs }),
      );
      toast.success("申请已拒绝");
      setEnrollment(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "拒绝失败");
    }
  };

  const st = enrollment ? stateLabel(enrollment.state) : null;
  const isPending = enrollment?.state === EnrollmentState.PENDING;

  return (
    <div className="max-w-2xl mx-auto p-6 flex flex-col gap-6">
      <Flex align="center" gap="2">
        <UserPlus size={20} />
        <Text size="5" weight="bold">添加机器向导</Text>
      </Flex>

      {/* ── code lookup ── */}
      <Card>
        <Flex direction="column" gap="3" p="4">
          <Text size="2" weight="medium">输入验证码</Text>
          <Text size="2" color="gray">
            在要注册的机器上运行 <code>komari-agent login</code>，将打印的验证码输入到此处。
          </Text>
          <Flex gap="2">
            <TextField.Root
              placeholder="ABCD-EFGH"
              value={inputCode}
              onChange={(e) => setInputCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => { if (e.key === "Enter") { setCode(inputCode); void lookup(inputCode); } }}
              style={{ fontFamily: "monospace", letterSpacing: "0.1em", width: "160px" }}
            />
            <Button
              variant="soft"
              onClick={() => { setCode(inputCode); void lookup(inputCode); }}
              disabled={loading}
            >
              {loading ? <RefreshCw size={14} className="animate-spin" /> : "查询"}
            </Button>
          </Flex>
        </Flex>
      </Card>

      {/* ── enrollment info ── */}
      {enrollment && (
        <Card>
          <Flex direction="column" gap="3" p="4">
            <Flex align="center" gap="2">
              <MonitorSmartphone size={16} />
              <Text size="3" weight="medium">申请机器</Text>
              {st && <Badge color={st.color}>{st.label}</Badge>}
            </Flex>

            <Flex direction="column" gap="1">
              {enrollment.device?.hostname && (
                <Text size="2">主机名：<code>{enrollment.device.hostname}</code></Text>
              )}
              {enrollment.device?.operatingSystem && (
                <Text size="2">系统：{enrollment.device.operatingSystem} {enrollment.device?.architecture}</Text>
              )}
              {enrollment.remoteIp && (
                <Text size="2">来源 IP：{enrollment.remoteIp}</Text>
              )}
              {enrollment.agentKeyFingerprint && (
                <Text size="2" color="gray" style={{ fontFamily: "monospace", fontSize: "11px" }}>
                  密钥指纹：{enrollment.agentKeyFingerprint}
                </Text>
              )}
            </Flex>

            <Callout.Root color="blue" size="1">
              <Callout.Icon><ShieldAlert size={14} /></Callout.Icon>
              <Callout.Text>
                请在机器上确认上方指纹与 <code>komari-agent login</code> 打印的一致，再批准。
              </Callout.Text>
            </Callout.Root>

            {!isPending && (
              <Callout.Root color="gray" size="1">
                <Callout.Text>此申请已{st?.label}，无法操作。</Callout.Text>
              </Callout.Root>
            )}
          </Flex>
        </Card>
      )}

      {/* ── action: new machine ── */}
      {enrollment && isPending && (
        <Card>
          <Flex direction="column" gap="3" p="4">
            <Text size="3" weight="medium">新建机器</Text>
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
                  placeholder="production"
                  value={newGroup}
                  onChange={(e) => setNewGroup(e.target.value)}
                />
              </Flex>
              <Flex direction="column" gap="1">
                <Text size="1" color="gray">备注（可选）</Text>
                <TextField.Root
                  value={newRemark}
                  onChange={(e) => setNewRemark(e.target.value)}
                />
              </Flex>
            </Flex>
            <Flex gap="2" justify="end">
              <Button color="red" variant="soft" onClick={() => void deny()} disabled={approving}>
                <XCircle size={14} />拒绝申请
              </Button>
              <Button onClick={() => void approveNew()} disabled={approving || !newName.trim()}>
                <CheckCircle2 size={14} />新建并批准
              </Button>
            </Flex>
          </Flex>
        </Card>
      )}

      {/* ── action: bind to existing ── */}
      {enrollment && isPending && candidates.length > 0 && (
        <Card>
          <Flex direction="column" gap="3" p="4">
            <Text size="3" weight="medium">绑定到已有机器</Text>
            <Text size="2" color="gray">
              绑定会将此机器的密钥替换为申请者的密钥，申请者将获得该机器的全部访问权限，因此需要二次验证。
            </Text>
            <Separator size="4" />
            <Flex direction="column" gap="2">
              {candidates.map((c) => (
                <Flex key={c.agentId} align="center" justify="between" gap="2">
                  <Flex direction="column" gap="1">
                    <Text size="2" weight="medium">{c.name}</Text>
                    <Text size="1" color="gray">{c.matchReason}</Text>
                    {c.fingerprintMatch && <Badge color="green" size="1">指纹匹配</Badge>}
                  </Flex>
                  <Button
                    size="1"
                    variant="soft"
                    onClick={() => { setBindTarget(c.agentId); setConfirmBindOpen(true); }}
                    disabled={approving}
                  >
                    绑定
                  </Button>
                </Flex>
              ))}
            </Flex>
          </Flex>
        </Card>
      )}

      {/* ── bind confirm dialog ── */}
      <Dialog.Root open={confirmBindOpen} onOpenChange={setConfirmBindOpen}>
        <Dialog.Content maxWidth="400px">
          <Dialog.Title>确认绑定</Dialog.Title>
          <Dialog.Description size="2" color="gray">
            绑定后申请者将持有该机器的全部权限。请输入 2FA 验证码确认。
          </Dialog.Description>
          <Flex direction="column" gap="3" mt="4">
            <TextField.Root
              type="password"
              placeholder="2FA 验证码"
              value={twoFaCode}
              onChange={(e) => setTwoFaCode(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && twoFaCode.trim()) void approveBind(); }}
            />
            <Flex gap="2" justify="end">
              <Dialog.Close>
                <Button variant="soft" color="gray">取消</Button>
              </Dialog.Close>
              <Button
                color="red"
                onClick={() => void approveBind()}
                disabled={!twoFaCode.trim() || approving}
              >
                确认绑定
              </Button>
            </Flex>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>
    </div>
  );
}
