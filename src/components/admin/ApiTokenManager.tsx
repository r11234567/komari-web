import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, Checkbox, Flex, Heading, Table, Text, TextField } from "@radix-ui/themes";
import { timestampDate, timestampFromDate } from "@bufbuild/protobuf/wkt";
import type { ApiToken, ListApiTokensResponse } from "@komari/proto/komari/admin/v1/api_token_pb";
import type { AgentSummary } from "@komari/proto/komari/browser/v1/browser_pb";
import { connectClients } from "@/api/connect/client";
import SensitiveActionDialog, { type SensitiveAction } from "@/components/SensitiveActionDialog";
import { API_TOKEN_SCOPES, apiTokenExpiryInput, apiTokenPolicyTargets } from "@/utils/apiTokenPolicy";

function date(value: ApiToken["expiresAt"]) { return value ? timestampDate(value).toLocaleString() : "—"; }

export default function ApiTokenManager() {
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
      setError("填写名称、权限、节点范围以及未来一年内的到期时间。"); return;
    }
    const input = { name: name.trim(), scopes: [...scopes], agentIds: allAgents ? [] : [...agentIds], allAgents,
      expiresAt: timestampFromDate(expiryDate), allowedCidrs: cidrs.split(/[\s,]+/).filter(Boolean), replacesTokenId: replaces };
    setIssuedSecret("");
    const range = allAgents ? "全部节点（含未来节点）" : `${agentIds.length} 个指定节点`;
    setAction({ action: "api-token:create", targets: apiTokenPolicyTargets(input),
      title: `${replaces ? "轮换" : "创建"} Token：${input.name} · ${input.scopes.join(" / ")} · ${range} · 到期 ${expiryDate.toLocaleString()}`,
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
    <Heading size="4">API Tokens</Heading>
    <Text size="2" color="gray">每个用途单独创建 Token，选择权限与节点，设置有效期；密钥只展示一次。当前提供节点与指标读取权限，远控、文件、账号和授权管理需要人工验证。</Text>
    {error && <Text role="alert" color="red">{error}</Text>}
    {data?.legacyApiKeyEnabled && <Card><Flex direction="column" gap="2">
      <Text color="orange">旧全局 API Key 仍启用，保留原管理员权限。请迁移调用方后停用。</Text>
      <Button color="orange" variant="soft" disabled={!!action} onClick={() => setAction({ action: "api-token:disable-legacy", targets: [], title: "停用旧全局 API Key（原调用方将立即失效）",
        execute: async (authorizationToken, signal) => { await connectClients.apiToken.disableLegacyApiKey({ twoFactor: { authorizationToken } }, { signal }); if (!signal.aborted) await reload(signal); },
      })}>验证并停用旧 Key</Button>
    </Flex></Card>}
    {issuedSecret && <Card><Flex direction="column" gap="2">
      <Text weight="bold">请现在保存密钥，关闭后无法再次查看。</Text>
      <TextField.Root aria-label="新 API Token 密钥" readOnly value={issuedSecret} autoComplete="off" />
      <Flex gap="2"><Button variant="soft" onClick={() => { void navigator.clipboard.writeText(issuedSecret).catch(() => setError("剪贴板不可用，请手动复制密钥。")); }}>复制密钥</Button><Button onClick={() => setIssuedSecret("")}>我已保存</Button></Flex>
    </Flex></Card>}
    <Flex gap="3" wrap="wrap">
      <label><Text as="div" size="2">Token 名称</Text><TextField.Root value={name} maxLength={80} onChange={event => setName(event.target.value)} disabled={!!action} /></label>
      <label><Text as="div" size="2">有效至</Text><TextField.Root type="datetime-local" value={expiry} onChange={event => setExpiry(event.target.value)} disabled={!!action} /></label>
    </Flex>
    <Flex gap="3" wrap="wrap">{API_TOKEN_SCOPES.map(scope => <label key={scope.value}><Flex gap="2" align="center"><Checkbox checked={scopes.includes(scope.value)} disabled={!!action} onCheckedChange={value => setScopes(toggle(scopes, scope.value, value === true))} /><Text size="2">{scope.label}</Text></Flex></label>)}</Flex>
    <label><Flex gap="2" align="center"><Checkbox checked={allAgents} disabled={!!action} onCheckedChange={value => setAllAgents(value === true)} /><Text size="2">全部节点，包含未来新增节点</Text></Flex></label>
    {!allAgents && <Flex gap="3" wrap="wrap">{nodes.map(node => <label key={node.agentId}><Flex gap="2" align="center"><Checkbox disabled={!!action} checked={agentIds.includes(node.agentId)} onCheckedChange={value => setAgentIds(toggle(agentIds, node.agentId, value === true))} /><Text size="2">{node.name || node.agentId}</Text></Flex></label>)}</Flex>}
    <label><Text as="div" size="2">允许的来源网段（可选，逗号分隔 CIDR）</Text><TextField.Root value={cidrs} placeholder="203.0.113.10/32, 2001:db8::/32" disabled={!!action} onChange={event => setCidrs(event.target.value)} /></label>
    {replaces && <Text color="orange" size="2">正在轮换 {replaces}：新密钥创建成功时旧 Token 立即撤销。需要平滑迁移时，请先新建 Token，迁移后再撤销旧 Token。</Text>}
    <Flex gap="2"><Button disabled={loading || !!action} onClick={create}>{replaces ? "验证并轮换" : "验证并创建"}</Button>{replaces && <Button variant="soft" onClick={() => setReplaces("")}>取消轮换</Button>}<Button variant="soft" disabled={loading || !!action} onClick={() => void reload()}>刷新</Button></Flex>
    <Table.Root variant="surface"><Table.Header><Table.Row><Table.ColumnHeaderCell>名称 / 状态</Table.ColumnHeaderCell><Table.ColumnHeaderCell>权限 / 节点范围</Table.ColumnHeaderCell><Table.ColumnHeaderCell>到期 / 最近使用</Table.ColumnHeaderCell><Table.ColumnHeaderCell>操作</Table.ColumnHeaderCell></Table.Row></Table.Header>
      <Table.Body>{data?.tokens.map(token => <Table.Row key={token.id}>
        <Table.Cell><Text as="p">{token.name}</Text><Text size="1" color="gray">{token.id}</Text><Badge color={token.revokedAt ? "red" : token.expiresAt && timestampDate(token.expiresAt).getTime() <= Date.now() ? "gray" : "green"}>{token.revokedAt ? "已撤销" : token.expiresAt && timestampDate(token.expiresAt).getTime() <= Date.now() ? "已到期" : "有效"}</Badge></Table.Cell>
        <Table.Cell><Text as="p" size="2">{token.scopes.join(" / ")}</Text><Text size="2">{token.allAgents ? "全部节点（含未来）" : token.agentIds.map(id => nodes.find(node => node.agentId === id)?.name || id).join("、")}</Text><Text as="p" size="1">{token.allowedCidrs.join(", ")}</Text></Table.Cell>
        <Table.Cell><Text as="p" size="2">{date(token.expiresAt)}</Text><Text size="2">{date(token.lastUsedAt)}</Text></Table.Cell>
        <Table.Cell><Flex gap="2"><Button variant="soft" disabled={!!token.revokedAt || !!action} onClick={() => rotate(token)}>轮换</Button><Button color="red" variant="soft" disabled={!!token.revokedAt || !!action} onClick={() => setAction({ action: "api-token:revoke", targets: [token.id], title: `立即撤销 Token：${token.name}`,
          execute: async (authorizationToken, signal) => { await connectClients.apiToken.revokeApiToken({ id: token.id, twoFactor: { authorizationToken } }, { signal }); if (!signal.aborted) await reload(signal); },
        })}>撤销</Button></Flex></Table.Cell>
      </Table.Row>)}</Table.Body>
    </Table.Root>
    <Flex gap="2" align="center"><Button variant="soft" disabled={page <= 1 || loading || !!action} onClick={() => setPage(page - 1)}>上一页</Button><Text size="2">第 {page} 页 / 共 {data?.total ?? 0} 个</Text><Button variant="soft" disabled={!data || page * 25 >= data.total || loading || !!action} onClick={() => setPage(page + 1)}>下一页</Button></Flex>
    <SensitiveActionDialog request={action} onClose={() => setAction(null)} />
  </Flex></Card>;
}
