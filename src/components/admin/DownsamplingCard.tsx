import { useRPC2Call } from "@/contexts/RPC2Context";
import { Badge, Button, Callout, Flex, Switch, Text } from "@radix-ui/themes";
import { AlertTriangle, RefreshCw, Save } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { SettingCard } from "./SettingCard";

type DownsamplingTier = {
  interval: string;
  retention: string;
};

type DownsamplingPolicy = {
  enabled: boolean;
  raw_retention: string;
  tiers: DownsamplingTier[];
};

const fallbackPolicy: DownsamplingPolicy = {
  enabled: false,
  raw_retention: "15min",
  tiers: [
    { interval: "1min", retention: "48h" },
    { interval: "5min", retention: "14d" },
    { interval: "1h", retention: "metric retention" },
  ],
};

function normalizePolicy(value: unknown): DownsamplingPolicy {
  if (!value || typeof value !== "object") return fallbackPolicy;
  const policy = value as Partial<DownsamplingPolicy>;
  return {
    enabled: policy.enabled === true,
    raw_retention:
      typeof policy.raw_retention === "string"
        ? policy.raw_retention
        : fallbackPolicy.raw_retention,
    tiers: Array.isArray(policy.tiers) && policy.tiers.length === 3
      ? policy.tiers
      : fallbackPolicy.tiers,
  };
}

export function DownsamplingCard() {
  const { t } = useTranslation();
  const { callViaHTTP } = useRPC2Call();
  const [policy, setPolicy] = React.useState(fallbackPolicy);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const response = await callViaHTTP<Record<string, never>, unknown>(
        "admin:getDownsamplingPolicy",
        {},
      );
      setPolicy(normalizePolicy(response));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setLoading(false);
    }
  }, [callViaHTTP]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      const response = await callViaHTTP<{ enabled: boolean }, unknown>(
        "admin:setDownsamplingPolicy",
        { enabled: policy.enabled },
      );
      setPolicy(normalizePolicy(response));
      toast.success(t("settings.settings_saved"));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingCard
      title={t("settings.downsampling.title", "历史数据降采样")}
      description={t(
        "settings.downsampling.description",
        "三级 rollup 始终用于查询加速；只有启用后才会删除已聚合的原始点。",
      )}
      direction="column"
    >
      <Flex direction="column" gap="3" className="w-full pt-3">
        <Flex justify="between" align="center" gap="3">
          <div>
            <Text as="div" size="2" weight="medium">
              {t("settings.downsampling.enabled", "允许删除原始点")}
            </Text>
            <Text as="div" size="1" color="gray">
              {policy.enabled
                ? t("settings.downsampling.active", "已启用三级物理降采样")
                : t("settings.downsampling.raw_preserved", "已关闭，原始点完整保留")}
            </Text>
          </div>
          <Switch
            checked={policy.enabled}
            disabled={loading || saving}
            onCheckedChange={(enabled) =>
              setPolicy((current) => ({ ...current, enabled }))
            }
          />
        </Flex>

        <div className="grid grid-cols-[minmax(5rem,auto)_1fr] gap-2 text-sm">
          <Text color="gray">Raw</Text>
          <Text>{policy.enabled ? policy.raw_retention : "preserved"}</Text>
          {policy.tiers.map((tier) => (
            <React.Fragment key={tier.interval}>
              <Badge variant="soft">{tier.interval}</Badge>
              <Text>{tier.retention}</Text>
            </React.Fragment>
          ))}
        </div>

        {policy.enabled && (
          <Callout.Root color="amber" size="1">
            <Callout.Icon><AlertTriangle size={16} /></Callout.Icon>
            <Callout.Text>
              {t(
                "settings.downsampling.irreversible",
                "后台维护会逐步删除已经进入 rollup 的原始点；关闭开关不会恢复已删除数据。",
              )}
            </Callout.Text>
          </Callout.Root>
        )}

        <Flex justify="end" gap="2">
          <Button
            variant="soft"
            disabled={loading || saving}
            onClick={() => void load()}
          >
            <RefreshCw size={16} />
            {t("common.refresh")}
          </Button>
          <Button disabled={loading || saving} onClick={() => void save()}>
            <Save size={16} />
            {t("common.save")}
          </Button>
        </Flex>
      </Flex>
    </SettingCard>
  );
}
