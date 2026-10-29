import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Button, Card, Flex, Heading, Table, Text, TextField } from "@radix-ui/themes";
import { CredentialPurpose } from "@komari/proto/komari/credential/v1/credential_pb";
import TrustedCredentialVerification from "@/components/TrustedCredentialVerification";
import { applyCredentialLifecycle, credentialActionPath, loadCredentialLifecycle, validCredentialPolicy } from "@/api/credentialLifecycle";
import type { CredentialLifecycle, CredentialLifecycleAction, CredentialPolicy } from "@/api/credentialLifecycle";

const fields: { key: keyof Omit<CredentialPolicy, "revision">; label: string; min: number; max: number }[] = [
  { key: "idle_days", label: "RT 闲置期限（天）", min: 1, max: 30 },
  { key: "absolute_days", label: "机器授权最长有效期（天）", min: 30, max: 365 },
  { key: "migration_grace_days", label: "首次迁移宽限（天）", min: 1, max: 90 },
  { key: "warning_days", label: "提前提示到期（天）", min: 1, max: 30 },
];
const labels: Record<string, string> = { active: "正常", migration: "迁移宽限", expiring: "即将到期", expired: "需要重新授权", revoked: "已撤销，需重新绑定" };
function date(value: string | null) { return value ? new Date(value).toLocaleString() : "—"; }

export default function AgentCredentialLifecycle() {
  const [data, setData] = useState<CredentialLifecycle>();
  const [policy, setPolicy] = useState<CredentialPolicy>();
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [action, setAction] = useState<CredentialLifecycleAction>();
  const request = useRef<AbortController | null>(null);
  const reload = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    try {
      const result = await loadCredentialLifecycle(page, controller.signal);
      if (controller.signal.aborted) return;
      setData(result); setPolicy({ ...result.policy }); setError("");
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
    } finally { if (!controller.signal.aborted) setLoading(false); }
  }, [page]);
  useEffect(() => { void reload(); return () => request.current?.abort(); }, [reload]);
  return <Card className="km-agent-credential-lifecycle km-setting-card" size="3">
    <Flex direction="column" gap="4">
      <Heading size="4">Agent 凭据生命周期</Heading>
      <Text size="2" color="gray">AT 有效期最多 1 小时；Agent 提前约 5 分钟续期。RT 每次使用后轮换，闲置失效；续期不会延长机器授权的固定到期日。</Text>
      {error && <Text role="alert" color="red">{error}</Text>}
      <Flex gap="3" wrap="wrap">
        {policy && fields.map(field => <label key={field.key}>
          <Flex direction="column" gap="1"><Text size="2">{field.label}</Text>
            <TextField.Root aria-label={field.label} type="number" min={field.min} max={field.max} step="1" value={String(policy[field.key])} disabled={loading || !!action}
              onChange={event => setPolicy({ ...policy, [field.key]: event.target.value === "" ? 0 : Number(event.target.value) })} />
          </Flex>
        </label>)}
      </Flex>
      <Text size="2" color="gray">策略只影响后续续期及人工授权，不会延长已有固定到期日；迁移宽限仅首次生效，不随重启或修改设置延长。</Text>
      <Flex gap="2" wrap="wrap">
        <Button disabled={loading || !!action || !policy || !validCredentialPolicy(policy)} onClick={() => policy && setAction({ kind: "policy", policy: { ...policy } })}>验证并保存策略</Button>
        <Button variant="soft" disabled={loading || !!action} onClick={() => void reload()}>刷新状态</Button>
      </Flex>
      {action && <Card variant="surface">
        <Flex direction="column" gap="3">
          <Text weight="bold">{action.kind === "policy" ? "验证本次策略修改" : "重新授权：" + (action.agent.name || action.agent.agent_id)}</Text>
          <Text size="2">{action.kind === "policy" ? "闲置 " + action.policy.idle_days + " 天，固定授权 " + action.policy.absolute_days + " 天。" : "仅延长当前机器身份的期限，不恢复已撤销身份或丢失的 RT。完成后请重启 Agent 立即续期；如仍失败，请在机器上重新登录绑定。"}</Text>
          <TrustedCredentialVerification purpose={CredentialPurpose.SENSITIVE_OPERATION} resource={"rest:POST:" + credentialActionPath(action)}
            onAuthorized={async (token, signal) => {
              await applyCredentialLifecycle(action, token, signal);
              if (signal.aborted) return;
              setAction(undefined); await reload();
            }} />
          <Button variant="soft" color="gray" onClick={() => setAction(undefined)}>取消</Button>
        </Flex>
      </Card>}
      {data && <Text size="2">共 {data.total} 台已绑定机器；第 {data.page} 页。临近固定期限会提示，撤销后须使用新设备密钥重新绑定。</Text>}
      <Table.Root variant="surface">
        <Table.Header><Table.Row>
          <Table.ColumnHeaderCell>机器 / 状态</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>最近续期 / RT 闲置到期</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>机器授权固定到期 / 迁移宽限</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>操作</Table.ColumnHeaderCell>
        </Table.Row></Table.Header>
        <Table.Body>{data?.credentials.map(agent => <Table.Row key={agent.agent_id}>
          <Table.Cell><Flex direction="column" gap="1"><Text weight="medium">{agent.name || agent.agent_id}</Text><Text size="1" color="gray">{agent.agent_id}</Text><Badge color={agent.status === "revoked" || agent.status === "expired" ? "red" : agent.status === "expiring" ? "orange" : "green"}>{labels[agent.status] || agent.status}</Badge><Text size="1">代次 {agent.generation} · 协议 {agent.protocol || 1}</Text></Flex></Table.Cell>
          <Table.Cell><Text as="p" size="2">{date(agent.last_refresh_at)}</Text><Text size="2">{date(agent.idle_expires_at)}</Text></Table.Cell>
          <Table.Cell><Text as="p" size="2">{date(agent.absolute_expires_at)}</Text><Text size="2" color="gray">{date(agent.migration_grace_until)}</Text></Table.Cell>
          <Table.Cell><Button variant="soft" disabled={!agent.can_reapprove || loading || !!action} onClick={() => setAction({ kind: "reapprove", agent: { ...agent } })}>验证并重新授权</Button></Table.Cell>
        </Table.Row>)}</Table.Body>
      </Table.Root>
      {data && data.total > data.page_size && <Flex gap="2">
        <Button variant="soft" disabled={page <= 1 || loading || !!action} onClick={() => setPage(page - 1)}>上一页</Button>
        <Button variant="soft" disabled={page * data.page_size >= data.total || loading || !!action} onClick={() => setPage(page + 1)}>下一页</Button>
      </Flex>}
    </Flex>
  </Card>;
}
