import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, Checkbox, DropdownMenu, Flex, Heading, Table, Text, TextField } from "@radix-ui/themes";
import { timestampDate, timestampFromDate } from "@bufbuild/protobuf/wkt";
import type { ApiToken, ListApiTokensResponse } from "@komari/proto/komari/admin/v1/api_token_pb";
import type { AgentSummary } from "@komari/proto/komari/browser/v1/browser_pb";
import { connectClients } from "@/api/connect/client";
import { useTranslation } from "react-i18next";
import ConfirmActionDialog, { type ConfirmAction } from "@/components/ConfirmActionDialog";
import SensitiveActionDialog, { type SensitiveAction } from "@/components/SensitiveActionDialog";
import { API_TOKEN_SCOPES, apiTokenExpiryInput, apiTokenPolicyTargets } from "@/utils/apiTokenPolicy";

function date(value: ApiToken["expiresAt"], locale?: string) { return value ? timestampDate(value).toLocaleString(locale) : "—"; }

export default function ApiTokenManager() {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState<ListApiTokensResponse>();
  const [nodes, setNodes] = useState<AgentSummary[]>([]);
  const [page, setPage] = useState(1);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["nodes:read"]);
  const [agentIds, setAgentIds] = useState<string[]>([]);
  const [allAgents, setAllAgents] = useState(false);
  const [expiry, setExpiry] = useState(apiTokenExpiryInput);
  const [cidrs, setCidrs] = useState("");
  const [replaces, setReplaces] = useState("");
  const [issuedSecret, setIssuedSecret] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState<SensitiveAction | null>(null);
  const [confirmation, setConfirmation] = useState<ConfirmAction | null>(null);
  const blocked = !!action || !!confirmation;
  const reload = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const [result, agents] = await Promise.all([
        connectClients.apiToken.listApiTokens({ page }, { signal }),
        connectClients.browser.listAgents({}, { signal }),
      ]);
      if (signal?.aborted) return;
      setData(result); setNodes(agents.agents); setError("");
    } catch (cause) { if (!signal?.aborted) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, [page]);
  useEffect(() => { const controller = new AbortController(); void reload(controller.signal); return () => controller.abort(); }, [reload]);
  const toggle = (items: string[], item: string, enabled: boolean) => enabled ? [...items.filter(value => value !== item), item] : items.filter(value => value !== item);

  const create = () => {
    const expiryDate = new Date(expiry);
    if (!name.trim() || !scopes.length || (!allAgents && !agentIds.length) || !Number.isFinite(expiryDate.getTime()) || expiryDate.getTime() <= Date.now() || expiryDate.getTime() > Date.now() + 365 * 86400_000) {
      setError(t("api_tokens.invalid_input")); return;
    }
    const input = { name: name.trim(), scopes: [...scopes], agentIds: allAgents ? [] : [...agentIds], allAgents,
      expiresAt: timestampFromDate(expiryDate), allowedCidrs: cidrs.split(/[\s,]+/).filter(Boolean), replacesTokenId: replaces };
    setIssuedSecret("");
    const range = allAgents ? t("api_tokens.all_future") : t("api_tokens.selected_count", { count: agentIds.length });
    setAction({ action: "api-token:create", targets: apiTokenPolicyTargets(input),
      title: t(replaces ? "api_tokens.rotate_title" : "api_tokens.create_title", { name: input.name, scopes: input.scopes.map(scope => t(scope === "nodes:read" ? "api_tokens.nodes_read" : "api_tokens.metrics_read")).join(" / "), range, expiry: expiryDate.toLocaleString(i18n.resolvedLanguage) }),
      execute: async (authorizationToken, signal) => {
        const result = await connectClients.apiToken.createApiToken({ ...input, twoFactor: { authorizationToken } }, { signal });
        if (signal.aborted) return;
        setIssuedSecret(result.secret); setReplaces(""); setName(""); await reload(signal);
      },
    });
  };

  const rotate = (token: ApiToken) => {
    setReplaces(token.id); setName(token.name); setScopes([...token.scopes]); setAllAgents(token.allAgents);
    setAgentIds([...token.agentIds]); setCidrs(token.allowedCidrs.join("\n")); setExpiry(apiTokenExpiryInput()); setIssuedSecret("");
  };

  return <Card className="km-setting-card" size="3"><Flex direction="column" gap="4">
    <Heading size="4">{t("api_tokens.title")}</Heading>
    <Text size="2" color="gray">{t("api_tokens.description")}</Text>
    {error && <Text role="alert" color="red">{error}</Text>}
    {data?.legacyApiKeyEnabled && <Card><Flex direction="column" gap="2">
      <Text color="orange">{t("api_tokens.legacy_warning")}</Text>
      <Button color="orange" variant="soft" disabled={blocked} onClick={() => setConfirmation({ title: t("api_tokens.disable_legacy"), description: t("api_tokens.disable_legacy_confirm"), label: t("api_tokens.disable_legacy"),
        execute: async signal => { await connectClients.apiToken.disableLegacyApiKey({}, { signal }); if (!signal.aborted) await reload(signal); },
      })}>{t("api_tokens.disable_legacy")}</Button>
    </Flex></Card>}
    {issuedSecret && <Card><Flex direction="column" gap="2">
      <Text weight="bold">{t("api_tokens.save_secret")}</Text>
      <TextField.Root aria-label={t("api_tokens.new_secret")} readOnly value={issuedSecret} autoComplete="off" />
      <Flex gap="2"><Button variant="soft" onClick={() => { void navigator.clipboard.writeText(issuedSecret).catch(() => setError(t("api_tokens.clipboard_error"))); }}>{t("api_tokens.copy_secret")}</Button><Button onClick={() => setIssuedSecret("")}>{t("api_tokens.saved_secret")}</Button></Flex>
    </Flex></Card>}
    <Flex gap="3" wrap="wrap">
      <label><Text as="div" size="2">{t("api_tokens.name")}</Text><TextField.Root value={name} maxLength={80} onChange={event => setName(event.target.value)} disabled={blocked} /></label>
      <label><Text as="div" size="2">{t("api_tokens.expires_at")}</Text><TextField.Root type="datetime-local" value={expiry} onChange={event => setExpiry(event.target.value)} disabled={blocked} /></label>
    </Flex>
    <Flex gap="3" wrap="wrap">{API_TOKEN_SCOPES.map(scope => <label key={scope.value}><Flex gap="2" align="center"><Checkbox checked={scopes.includes(scope.value)} disabled={blocked} onCheckedChange={value => setScopes(toggle(scopes, scope.value, value === true))} /><Text size="2">{t(scope.value === "nodes:read" ? "api_tokens.nodes_read" : "api_tokens.metrics_read")}</Text></Flex></label>)}</Flex>
    <label><Flex gap="2" align="center"><Checkbox checked={allAgents} disabled={blocked} onCheckedChange={value => setAllAgents(value === true)} /><Text size="2">{t("api_tokens.all_future")}</Text></Flex></label>
    {!allAgents && <DropdownMenu.Root><DropdownMenu.Trigger>
      <Button variant="surface" disabled={blocked || loading} style={{ alignSelf: "flex-start" }} aria-label={t("api_tokens.select_nodes")}>{agentIds.length ? t("api_tokens.selected_count", { count: agentIds.length }) : t("api_tokens.select_nodes")}<DropdownMenu.TriggerIcon /></Button>
    </DropdownMenu.Trigger><DropdownMenu.Content style={{ minWidth: 240, maxHeight: 320, overflowY: "auto" }}>
      {nodes.map(node => <DropdownMenu.CheckboxItem key={node.agentId} disabled={blocked} checked={agentIds.includes(node.agentId)} onSelect={event => event.preventDefault()} onCheckedChange={value => setAgentIds(toggle(agentIds, node.agentId, value))}>{node.name || node.agentId}</DropdownMenu.CheckboxItem>)}
      {agentIds.filter(id => !nodes.some(node => node.agentId === id)).map(id => <DropdownMenu.CheckboxItem key={id} disabled={blocked} checked onSelect={event => event.preventDefault()} onCheckedChange={value => setAgentIds(toggle(agentIds, id, value))}>{id}</DropdownMenu.CheckboxItem>)}
      {!nodes.length && !agentIds.length && <DropdownMenu.Item disabled>{t("api_tokens.no_nodes")}</DropdownMenu.Item>}
    </DropdownMenu.Content></DropdownMenu.Root>}
    <label><Text as="div" size="2">{t("api_tokens.cidrs")}</Text><TextField.Root value={cidrs} placeholder="203.0.113.10/32, 2001:db8::/32" disabled={blocked} onChange={event => setCidrs(event.target.value)} /></label>
    {replaces && <Text color="orange" size="2">{t("api_tokens.rotation_notice", { id: replaces })}</Text>}
    <Flex gap="2"><Button disabled={loading || blocked} onClick={create}>{t(replaces ? "api_tokens.verify_rotate" : "api_tokens.verify_create")}</Button>{replaces && <Button variant="soft" onClick={() => setReplaces("")}>{t("api_tokens.cancel_rotation")}</Button>}<Button variant="soft" disabled={loading || blocked} onClick={() => void reload()}>{t("api_tokens.refresh")}</Button></Flex>
    <Table.Root variant="surface"><Table.Header><Table.Row><Table.ColumnHeaderCell>{t("api_tokens.name_status")}</Table.ColumnHeaderCell><Table.ColumnHeaderCell>{t("api_tokens.scope_nodes")}</Table.ColumnHeaderCell><Table.ColumnHeaderCell>{t("api_tokens.expiry_usage")}</Table.ColumnHeaderCell><Table.ColumnHeaderCell>{t("api_tokens.actions")}</Table.ColumnHeaderCell></Table.Row></Table.Header>
      <Table.Body>{data?.tokens.map(token => <Table.Row key={token.id}>
        <Table.Cell><Text as="p">{token.name}</Text><Text size="1" color="gray">{token.id}</Text><Badge color={token.revokedAt ? "red" : token.expiresAt && timestampDate(token.expiresAt).getTime() <= Date.now() ? "gray" : "green"}>{t(token.revokedAt ? "api_tokens.revoked" : token.expiresAt && timestampDate(token.expiresAt).getTime() <= Date.now() ? "api_tokens.expired" : "api_tokens.active")}</Badge></Table.Cell>
        <Table.Cell><Text as="p" size="2">{token.scopes.map(scope => scope === "nodes:read" ? t("api_tokens.nodes_read") : scope === "metrics:read" ? t("api_tokens.metrics_read") : scope).join(" / ")}</Text><Text size="2">{token.allAgents ? t("api_tokens.all_future") : token.agentIds.map(id => nodes.find(node => node.agentId === id)?.name || id).join("、")}</Text><Text as="p" size="1">{token.allowedCidrs.join(", ")}</Text></Table.Cell>
        <Table.Cell><Text as="p" size="2">{date(token.expiresAt, i18n.resolvedLanguage)}</Text><Text size="2">{date(token.lastUsedAt, i18n.resolvedLanguage)}</Text></Table.Cell>
        <Table.Cell><Flex gap="2"><Button variant="soft" disabled={!!token.revokedAt || blocked} onClick={() => rotate(token)}>{t("api_tokens.rotate")}</Button><Button color="red" variant="soft" disabled={!!token.revokedAt || blocked} onClick={() => setConfirmation({ title: t("api_tokens.revoke_title", { name: token.name }), description: t("api_tokens.revoke_confirm"), label: t("api_tokens.revoke"),
          execute: async signal => { await connectClients.apiToken.revokeApiToken({ id: token.id }, { signal }); if (!signal.aborted) await reload(signal); },
        })}>{t("api_tokens.revoke")}</Button></Flex></Table.Cell>
      </Table.Row>)}</Table.Body>
    </Table.Root>
    <Flex gap="2" align="center"><Button variant="soft" disabled={page <= 1 || loading || blocked} onClick={() => setPage(page - 1)}>{t("api_tokens.previous")}</Button><Text size="2">{t("api_tokens.page", { page, total: data?.total ?? 0 })}</Text><Button variant="soft" disabled={!data || page * 25 >= data.total || loading || blocked} onClick={() => setPage(page + 1)}>{t("api_tokens.next")}</Button></Flex>
    <SensitiveActionDialog request={action} onClose={() => setAction(null)} />
    <ConfirmActionDialog request={confirmation} onClose={() => setConfirmation(null)} />
  </Flex></Card>;
}
