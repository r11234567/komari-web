import { useRPC2Call } from "@/contexts/RPC2Context";
import { Button, Flex, Switch, Text, TextField } from "@radix-ui/themes";
import { RefreshCw, Save } from "lucide-react";
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

const defaultPolicy: DownsamplingPolicy = {
  enabled: false,
  raw_retention: "1h",
  tiers: [
    { interval: "1min", retention: "24h" },
    { interval: "5min", retention: "7d" },
    { interval: "1h", retention: "90d" },
    { interval: "1d", retention: "5y" },
  ],
};

const durationPattern = /^[1-9][0-9]*(min|h|d|m|y)$/;

function normalizePolicy(value: unknown): DownsamplingPolicy {
  if (!value || typeof value !== "object") return defaultPolicy;
  const candidate = value as Partial<DownsamplingPolicy>;
  if (!Array.isArray(candidate.tiers) || candidate.tiers.length !== 4) {
    return defaultPolicy;
  }
  return {
    enabled: candidate.enabled === true,
    raw_retention:
      typeof candidate.raw_retention === "string"
        ? candidate.raw_retention
        : defaultPolicy.raw_retention,
    tiers: candidate.tiers.map((tier, index) => ({
      interval:
        typeof tier?.interval === "string"
          ? tier.interval
          : defaultPolicy.tiers[index].interval,
      retention:
        typeof tier?.retention === "string"
          ? tier.retention
          : defaultPolicy.tiers[index].retention,
    })),
  };
}

export function DownsamplingCard() {
  const { t } = useTranslation();
  const { call } = useRPC2Call();
  const [policy, setPolicy] = React.useState<DownsamplingPolicy>(defaultPolicy);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);

  const loadPolicy = React.useCallback(async () => {
    setLoading(true);
    try {
      const value = await call<Record<string, never>, unknown>(
        "admin:getDownsamplingPolicy",
        {},
      );
      setPolicy(normalizePolicy(value));
    } catch (error) {
      toast.error(t("settings.downsampling.load_error"), {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setLoading(false);
    }
  }, [call, t]);

  React.useEffect(() => {
    void loadPolicy();
  }, [loadPolicy]);

  const updateTier = (
    index: number,
    key: keyof DownsamplingTier,
    value: string,
  ) => {
    setPolicy((current) => ({
      ...current,
      tiers: current.tiers.map((tier, tierIndex) =>
        tierIndex === index ? { ...tier, [key]: value } : tier,
      ),
    }));
  };

  const savePolicy = async () => {
    const values = [
      policy.raw_retention,
      ...policy.tiers.flatMap((tier) => [tier.interval, tier.retention]),
    ];
    if (values.some((value) => !durationPattern.test(value.trim()))) {
      toast.error(t("settings.downsampling.duration_invalid"));
      return;
    }

    const normalized: DownsamplingPolicy = {
      ...policy,
      raw_retention: policy.raw_retention.trim(),
      tiers: policy.tiers.map((tier) => ({
        interval: tier.interval.trim(),
        retention: tier.retention.trim(),
      })),
    };
    setSaving(true);
    try {
      const saved = await call<DownsamplingPolicy, unknown>(
        "admin:setDownsamplingPolicy",
        normalized,
      );
      setPolicy(normalizePolicy(saved));
      toast.success(t("settings.downsampling.saved"));
    } catch (error) {
      toast.error(t("settings.downsampling.save_error"), {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingCard
      title={t("settings.downsampling.title")}
      description={t("settings.downsampling.description")}
      direction="column"
    >
      <Flex direction="column" gap="3" className="w-full pt-3">
        <Flex justify="between" align="center" gap="3">
          <Text size="2" weight="medium">
            {t("settings.downsampling.enabled")}
          </Text>
          <Switch
            checked={policy.enabled}
            disabled={loading || saving}
            onCheckedChange={(enabled) =>
              setPolicy((current) => ({ ...current, enabled }))
            }
          />
        </Flex>

        <label className="grid grid-cols-[minmax(0,1fr)_minmax(8rem,12rem)] items-center gap-3">
          <Text size="2">{t("settings.downsampling.raw_retention")}</Text>
          <TextField.Root
            value={policy.raw_retention}
            disabled={loading || saving}
            onChange={(event) =>
              setPolicy((current) => ({
                ...current,
                raw_retention: event.target.value,
              }))
            }
          />
        </label>

        <div className="overflow-x-auto">
          <div className="grid min-w-[34rem] grid-cols-[5rem_minmax(10rem,1fr)_minmax(10rem,1fr)] gap-x-3 gap-y-2 items-center">
            <Text size="1" color="gray">
              {t("settings.downsampling.level")}
            </Text>
            <Text size="1" color="gray">
              {t("settings.downsampling.interval")}
            </Text>
            <Text size="1" color="gray">
              {t("settings.downsampling.retention")}
            </Text>
            {policy.tiers.map((tier, index) => (
              <React.Fragment key={index}>
                <Text size="2">{index + 1}</Text>
                <TextField.Root
                  value={tier.interval}
                  disabled={loading || saving}
                  onChange={(event) =>
                    updateTier(index, "interval", event.target.value)
                  }
                />
                <TextField.Root
                  value={tier.retention}
                  disabled={loading || saving}
                  onChange={(event) =>
                    updateTier(index, "retention", event.target.value)
                  }
                />
              </React.Fragment>
            ))}
          </div>
        </div>

        <Flex justify="end" gap="2">
          <Button
            variant="soft"
            disabled={loading || saving}
            onClick={() => void loadPolicy()}
          >
            <RefreshCw size={16} className={loading ? "animate-spin" : undefined} />
            {t("common.refresh")}
          </Button>
          <Button disabled={loading || saving} onClick={() => void savePolicy()}>
            <Save size={16} />
            {t("common.save")}
          </Button>
        </Flex>
      </Flex>
    </SettingCard>
  );
}
