import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge, Button, Card, Flex, Heading, Table, Text, TextField } from "@radix-ui/themes";
import { CredentialPurpose } from "@komari/proto/komari/credential/v1/credential_pb";
import TrustedCredentialVerification from "@/components/TrustedCredentialVerification";
import { applyCredentialLifecycle, credentialActionPath, loadCredentialLifecycle, validCredentialPolicy } from "@/api/credentialLifecycle";
import type { CredentialLifecycle, CredentialLifecycleAction, CredentialPolicy } from "@/api/credentialLifecycle";
import { agentCredentialFallback } from "@/i18n/agentCredentialFallback";

const fields: { key: keyof Omit<CredentialPolicy, "revision">; min: number; max: number }[] = [
  { key: "idle_days", min: 1, max: 30 },
  { key: "absolute_days", min: 30, max: 365 },
  { key: "migration_grace_days", min: 1, max: 90 },
  { key: "warning_days", min: 1, max: 30 },
];
function date(value: string | null, locale?: string) { return value ? new Date(value).toLocaleString(locale) : "—"; }

export default function AgentCredentialLifecycle() {
  const { t: translate, i18n, ready } = useTranslation();
  const t = ready ? translate : agentCredentialFallback.t;
  const locale = (ready ? i18n : agentCredentialFallback).resolvedLanguage;
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
      <Heading size="4">{t("agent_credentials.title")}</Heading>
      <Text size="2" color="gray">{t("agent_credentials.description")}</Text>
      {error && <Text role="alert" color="red">{error}</Text>}
      <Flex gap="3" wrap="wrap">
        {policy && fields.map(field => {
          const label = t("agent_credentials." + field.key);
          return <label key={field.key}>
          <Flex direction="column" gap="1"><Text size="2">{label}</Text>
            <TextField.Root aria-label={label} type="number" min={field.min} max={field.max} step="1" value={String(policy[field.key])} disabled={loading || !!action}
              onChange={event => setPolicy({ ...policy, [field.key]: event.target.value === "" ? 0 : Number(event.target.value) })} />
          </Flex>
        </label>;
        })}
      </Flex>
      <Text size="2" color="gray">{t("agent_credentials.policy_scope")}</Text>
      <Flex gap="2" wrap="wrap">
        <Button disabled={loading || !!action || !policy || !validCredentialPolicy(policy)} onClick={() => policy && setAction({ kind: "policy", policy: { ...policy } })}>{t("agent_credentials.save_policy")}</Button>
        <Button variant="soft" disabled={loading || !!action} onClick={() => void reload()}>{t("agent_credentials.refresh_status")}</Button>
      </Flex>
      {action && <Card variant="surface">
        <Flex direction="column" gap="3">
          <Text weight="bold">{action.kind === "policy" ? t("agent_credentials.verify_policy") : t("agent_credentials.reapprove_agent", { name: action.agent.name || action.agent.agent_id })}</Text>
          <Text size="2">{action.kind === "policy" ? t("agent_credentials.policy_preview", { idle: action.policy.idle_days, absolute: action.policy.absolute_days }) : t("agent_credentials.reapprove_scope")}</Text>
          <TrustedCredentialVerification purpose={CredentialPurpose.SENSITIVE_OPERATION} resource={"rest:POST:" + credentialActionPath(action)}
            onAuthorized={async (token, signal) => {
              await applyCredentialLifecycle(action, token, signal);
              if (signal.aborted) return;
              setAction(undefined); await reload();
            }} />
          <Button variant="soft" color="gray" onClick={() => setAction(undefined)}>{t("common.cancel")}</Button>
        </Flex>
      </Card>}
      {data && <Text size="2">{t("agent_credentials.summary", { total: data.total, page: data.page })}</Text>}
      <Table.Root variant="surface">
        <Table.Header><Table.Row>
          <Table.ColumnHeaderCell>{t("agent_credentials.machine_status")}</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>{t("agent_credentials.last_refresh_idle")}</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>{t("agent_credentials.absolute_and_grace")}</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>{t("common.action")}</Table.ColumnHeaderCell>
        </Table.Row></Table.Header>
        <Table.Body>{data?.credentials.map(agent => <Table.Row key={agent.agent_id}>
          <Table.Cell><Flex direction="column" gap="1"><Text weight="medium">{agent.name || agent.agent_id}</Text><Text size="1" color="gray">{agent.agent_id}</Text><Badge color={agent.status === "revoked" || agent.status === "expired" ? "red" : agent.status === "expiring" ? "orange" : "green"}>{t("agent_credentials.status_" + agent.status, { defaultValue: agent.status })}</Badge><Text size="1">{t("agent_credentials.version", { generation: agent.generation, protocol: agent.protocol || 1 })}</Text></Flex></Table.Cell>
          <Table.Cell><Text as="p" size="2">{date(agent.last_refresh_at, locale)}</Text><Text size="2">{date(agent.idle_expires_at, locale)}</Text></Table.Cell>
          <Table.Cell><Text as="p" size="2">{date(agent.absolute_expires_at, locale)}</Text><Text size="2" color="gray">{date(agent.migration_grace_until, locale)}</Text></Table.Cell>
          <Table.Cell><Button variant="soft" disabled={!agent.can_reapprove || loading || !!action} onClick={() => setAction({ kind: "reapprove", agent: { ...agent } })}>{t("agent_credentials.verify_reapprove")}</Button></Table.Cell>
        </Table.Row>)}</Table.Body>
      </Table.Root>
      {data && data.total > data.page_size && <Flex gap="2">
        <Button variant="soft" disabled={page <= 1 || loading || !!action} onClick={() => setPage(page - 1)}>{t("common.previous_page")}</Button>
        <Button variant="soft" disabled={page * data.page_size >= data.total || loading || !!action} onClick={() => setPage(page + 1)}>{t("common.next_page")}</Button>
      </Flex>}
    </Flex>
  </Card>;
}
