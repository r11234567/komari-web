import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, Dialog, Flex, Heading, Text } from "@radix-ui/themes";
import type { PluginPackage } from "@komari/proto/komari/plugin/v1/plugin_pb";
import { connectClients } from "@/api/connect/client";
import SensitiveActionDialog, { type SensitiveAction } from "@/components/SensitiveActionDialog";
import { pluginPackageTargets, pluginPermissionChanges } from "@/utils/pluginPackagePolicy";
import { useTranslation } from "react-i18next";

interface Props { short?: string; refreshKey?: number; onChanged: () => void | Promise<void> }

export default function PluginPackageManager({ short, refreshKey = 0, onChanged }: Props) {
  const { t } = useTranslation();
  const [reviews, setReviews] = useState<PluginPackage[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState<SensitiveAction | null>(null);
  const reload = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const result = await connectClients.plugin.listPluginPackages({}, { signal });
      if (!signal?.aborted) { setReviews(result.packages); setError(""); }
    } catch (cause) { if (!signal?.aborted) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, []);
  useEffect(() => { const controller = new AbortController(); void reload(controller.signal); return () => controller.abort(); }, [reload, refreshKey]);
  const decide = (review: PluginPackage, decision: "activate" | "revoke" | "discard") => {
    const input = { shortName: review.plugin!.shortName, digest: review.digest, expectedCurrentDigest: review.currentDigest, action: decision };
    setAction({ action: `plugin-package:${decision}`, targets: pluginPackageTargets(review),
      title: `${decision} · ${input.shortName} ${review.plugin?.version} · SHA-256 ${review.digest}`,
      execute: async (authorizationToken, signal) => {
        await connectClients.plugin.decidePluginPackage({ ...input, twoFactor: { authorizationToken } }, { signal });
        if (!signal.aborted) { await reload(signal); await onChanged(); }
      },
    });
  };
  const visible = reviews.filter(review => review.plugin && (!short || review.plugin.shortName === short));
  return <Card><Flex direction="column" gap="3">
    <Flex justify="between" align="center"><Heading size="4">{t("plugin.package_review.title", "Package approval and history")}</Heading><Button variant="soft" disabled={loading || !!action} onClick={() => void reload()}>{t("common.refresh", "Refresh")}</Button></Flex>
    <Text size="2" color="gray">{t("plugin.package_review.description", "Uploads and updates are staged without running code. Every activation, rollback or approval requires fresh 2FA bound to this exact package. The approved old version stays available while a new package waits.")}</Text>
    <Text size="2" color="orange">{t("plugin.package_review.trust", "Approved plugins remain trusted code, including same-origin scripts. Package approval controls updates; it is not a sandbox.")}</Text>
    {error && <Text role="alert" color="red">{error}</Text>}
    {!loading && !visible.length && <Text color="gray">{t("plugin.package_review.empty", "No staged or retained packages.")}</Text>}
    {visible.map(review => {
      const current = reviews.find(item => item.plugin?.shortName === review.plugin!.shortName && item.digest === review.currentDigest);
      const changes = pluginPermissionChanges(current?.plugin?.permissions, review.plugin?.permissions);
      return <Card key={review.digest}><Flex direction="column" gap="2">
        <Flex gap="2" wrap="wrap"><Text weight="bold">{review.plugin!.shortName} · {current?.plugin?.version ?? "—"} → {review.plugin!.version}</Text><Badge color={review.status === "approved" ? "green" : review.status === "revoked" ? "red" : "orange"}>{review.status}</Badge></Flex>
        <Text size="1" style={{ overflowWrap: "anywhere" }}>SHA-256: {review.digest}</Text>
        <Text size="1" style={{ overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>{t("plugin.package_review.source", "Source")}: {review.source}</Text>
        {review.digest !== review.currentDigest && <Text size="1" color="orange">{t("plugin.package_review.content_changed", "The package differs from the installed version. Matching version numbers or permissions do not mean the code is unchanged.")}</Text>}
        <Text size="1">{t("plugin.package_review.created", "Staged")}: {new Date(Number(review.createdAtUnix) * 1000).toLocaleString()}</Text>
        {review.approvedAtUnix > 0n && <Text size="1">{t("plugin.package_review.approved", "Last authorized")}: {new Date(Number(review.approvedAtUnix) * 1000).toLocaleString()} · {review.approvedBy}</Text>}
        <details><summary>{t("plugin.package_review.permissions", "Permissions and runtime limits (current → candidate)")}</summary><Flex direction="column" gap="1">{changes.map(item => <Text key={item.field} size="1" color={item.changed ? "orange" : "gray"}>{item.label}: {review.currentDigest && !current ? t("common.unknown", "Unknown") : item.before} → {item.after}</Text>)}<Text size="1">{t("plugin.package_review.defaults", "Default capabilities remain: plugin configuration, plugin-owned RPC, and files in the plugin directory. Zero special permissions still requires package approval.")}</Text></Flex></details>
        <Flex gap="2" wrap="wrap">
          <Button disabled={!!action || loading} onClick={() => decide(review, "activate")}>{t("plugin.package_review.activate", "Verify 2FA and activate / roll back")}</Button>
          {!review.revoked && <Button color="red" variant="soft" disabled={!!action || loading} onClick={() => decide(review, "revoke")}>{t("plugin.package_review.revoke", "Verify 2FA and revoke")}</Button>}
          {review.digest !== review.currentDigest && <Button color="gray" variant="soft" disabled={!!action || loading} onClick={() => decide(review, "discard")}>{t("plugin.package_review.discard", "Verify 2FA and discard")}</Button>}
        </Flex>
      </Flex></Card>;
    })}
    <SensitiveActionDialog request={action} onClose={() => setAction(null)} />
  </Flex></Card>;
}

export function PluginPackageApprovalDialog({ short, onClose, onChanged }: { short: string | null; onClose: () => void; onChanged: () => void | Promise<void> }) {
  const { t } = useTranslation();
  return <Dialog.Root open={!!short} onOpenChange={open => { if (!open) onClose(); }}><Dialog.Content maxWidth="760px"><Dialog.Title>{t("plugin.package_review.title", "Package approval and history")}</Dialog.Title><Dialog.Description>{short}</Dialog.Description>{short && <PluginPackageManager short={short} onChanged={async () => { await onChanged(); onClose(); }} />}</Dialog.Content></Dialog.Root>;
}
