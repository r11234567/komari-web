import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, Dialog, Flex, Text } from "@radix-ui/themes";
import type { PluginPackage } from "@komari/proto/komari/plugin/v1/plugin_pb";
import { connectClients } from "@/api/connect/client";
import SensitiveActionDialog, { type SensitiveAction } from "@/components/SensitiveActionDialog";
import ConfirmActionDialog, { type ConfirmAction } from "@/components/ConfirmActionDialog";
import { pluginPackageSource, pluginPackageTargets, pluginPermissionChanges } from "@/utils/pluginPackagePolicy";
import { useTranslation } from "react-i18next";

interface Props { short?: string; compact?: boolean; refreshKey?: number; onChanged: () => void | Promise<void> }

export default function PluginPackageManager({ short, compact = false, refreshKey = 0, onChanged }: Props) {
  const { t, i18n } = useTranslation();
  const [reviews, setReviews] = useState<PluginPackage[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState<SensitiveAction | null>(null);
  const [confirmation, setConfirmation] = useState<ConfirmAction | null>(null);
  const [open, setOpen] = useState(false);
  const busy = loading || !!action || !!confirmation;
  const reload = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const result = await connectClients.plugin.listPluginPackages({}, { signal });
      if (!signal?.aborted) { setReviews(result.packages); setError(""); }
    } catch (cause) { if (!signal?.aborted) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, []);
  useEffect(() => { const controller = new AbortController(); void reload(controller.signal); return () => controller.abort(); }, [reload, refreshKey]);
  const decide = async (review: PluginPackage, decision: "activate" | "revoke" | "discard") => {
    const input = { shortName: review.plugin!.shortName, digest: review.digest, expectedCurrentDigest: review.currentDigest, action: decision };
    const execute = async (signal: AbortSignal, authorizationToken?: string) => {
      await connectClients.plugin.decidePluginPackage({ ...input, twoFactor: authorizationToken ? { authorizationToken } : undefined }, { signal });
      if (!signal.aborted) { await reload(signal); await onChanged(); }
    };
    if (decision !== "activate") {
      setConfirmation({ title: t(`plugin.package_review.${decision}`),
        description: t(`plugin.package_review.confirm_${decision}`, { name: input.shortName, version: review.plugin!.version }),
        label: t(`plugin.package_review.${decision}`), execute });
      return;
    }
    if (review.status === "ready" || review.status === "approved") {
      setLoading(true);
      try { await execute(AbortSignal.timeout(30_000)); }
      catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
      finally { setLoading(false); }
      return;
    }
    setAction({ action: "plugin-package:activate", targets: pluginPackageTargets(review),
      title: t("plugin.package_review.authorize_title", { name: input.shortName, version: review.plugin!.version }),
      execute: (authorizationToken, signal) => execute(signal, authorizationToken) });
  };
  const visible = reviews.filter(review => review.plugin && (!short || review.plugin.shortName === short));
  const content = <Flex direction="column" gap="2">
    <Flex justify="end"><Button size="1" variant="ghost" disabled={busy} onClick={() => void reload()}>{t("common.refresh")}</Button></Flex>
    {error && <Text role="alert" size="2" color="red">{error}</Text>}
    {!loading && !visible.length && <Text size="2" color="gray">{t("plugin.package_review.empty")}</Text>}
    <Flex direction="column" gap="2" style={{ maxHeight: "min(60vh, 560px)", overflowY: "auto" }}>
      {visible.map(review => {
        const current = reviews.find(item => item.plugin?.shortName === review.plugin!.shortName && item.digest === review.currentDigest);
        const changes = pluginPermissionChanges(current?.plugin?.permissions, review.plugin?.permissions);
        const source = pluginPackageSource(review.source);
        const statusKey = ["pending", "ready", "approved", "retained", "installed", "revoked"].includes(review.status) ? review.status : "unknown";
        const date = (seconds: bigint) => new Date(Number(seconds) * 1000).toLocaleString(i18n.resolvedLanguage);
        return <Card key={review.digest} size="1"><Flex direction="column" gap="2">
          <Flex gap="2" align="center" wrap="wrap">
            <Text size="2" weight="bold" style={{ overflowWrap: "anywhere" }}>{review.plugin!.shortName}</Text>
            <Text size="1" color="gray">{current && current.plugin!.version !== review.plugin!.version ? `${current.plugin!.version} → ` : ""}{review.plugin!.version}</Text>
            <Badge color={review.status === "approved" ? "green" : review.revoked ? "red" : "orange"}>{t(`plugin.package_review.status.${statusKey}`)}</Badge>
          </Flex>
          <Flex gap="2" wrap="wrap">
            {review.status !== "approved" && <Button size="1" disabled={busy} onClick={() => void decide(review, "activate")}>{t(review.status === "ready" ? "plugin.package_review.apply_update" : "plugin.package_review.activate")}</Button>}
            {!review.revoked && <Button size="1" color="red" variant="soft" disabled={busy} onClick={() => void decide(review, "revoke")}>{t("plugin.package_review.revoke")}</Button>}
            {review.digest !== review.currentDigest && <Button size="1" color="gray" variant="soft" disabled={busy} onClick={() => void decide(review, "discard")}>{t("plugin.package_review.discard")}</Button>}
          </Flex>
          <details style={{ fontSize: "var(--font-size-1)" }}><summary>{t("plugin.package_review.details")}</summary><Flex direction="column" gap="2" mt="2">
            <Text size="1" style={{ overflowWrap: "anywhere" }}>SHA-256: {review.digest}</Text>
            <Text size="1" style={{ overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>{t("plugin.package_review.source")}: {t(`plugin.package_review.sources.${source.kind}`)}{source.detail && ` · ${source.detail}`}</Text>
            <Text size="1">{t("plugin.package_review.created")}: {date(review.createdAtUnix)}</Text>
            {review.approvedAtUnix > 0n && <Text size="1" style={{ overflowWrap: "anywhere" }}>{t("plugin.package_review.approved")}: {date(review.approvedAtUnix)} · {review.approvedBy}</Text>}
            <Text size="1" weight="medium">{t("plugin.package_review.permissions")}</Text>
            {changes.map(item => {
              const value = (raw: string) => raw === "true" ? t("plugin.package_review.allowed") : raw === "false" ? t("plugin.package_review.denied") : raw;
              return <Text key={item.field} size="1" color={item.changed ? "orange" : "gray"}>{t(`plugin.package_review.capabilities.${item.field}`)}: {review.currentDigest && !current ? t("common.unknown") : value(item.before)} → {value(item.after)}</Text>;
            })}
            <Text size="1" color="gray">{t("plugin.package_review.defaults")}</Text>
          </Flex></details>
        </Flex></Card>;
      })}
    </Flex>
    <SensitiveActionDialog request={action} onClose={() => setAction(null)} />
    <ConfirmActionDialog request={confirmation} onClose={() => setConfirmation(null)} />
  </Flex>;
  if (!compact) return content;
  const pending = visible.filter(review => review.status === "pending" || review.status === "installed").length;
  return <Dialog.Root open={open} onOpenChange={setOpen}><Dialog.Trigger><Button variant="soft" color={pending ? "orange" : undefined}>{t("plugin.package_review.history")}{pending > 0 && <Badge color="orange">{pending}</Badge>}</Button></Dialog.Trigger><Dialog.Content maxWidth="620px" size="3"><Dialog.Title>{t("plugin.package_review.title")}</Dialog.Title><Dialog.Description size="2">{t("plugin.package_review.description")}</Dialog.Description>{content}<Flex justify="end" mt="3"><Dialog.Close><Button size="2" variant="soft">{t("common.close")}</Button></Dialog.Close></Flex></Dialog.Content></Dialog.Root>;
}

export function PluginPackageApprovalDialog({ short, onClose, onChanged }: { short: string | null; onClose: () => void; onChanged: () => void | Promise<void> }) {
  const { t } = useTranslation();
  return <Dialog.Root open={!!short} onOpenChange={open => { if (!open) onClose(); }}><Dialog.Content maxWidth="620px" size="3"><Dialog.Title>{t("plugin.package_review.title")}</Dialog.Title><Dialog.Description size="2">{t("plugin.package_review.description")}</Dialog.Description>{short && <PluginPackageManager short={short} onChanged={async () => { await onChanged(); onClose(); }} />}<Flex justify="end" mt="3"><Dialog.Close><Button size="2" variant="soft">{t("common.close")}</Button></Dialog.Close></Flex></Dialog.Content></Dialog.Root>;
}
