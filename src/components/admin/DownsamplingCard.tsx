import { useRPC2Call } from "@/contexts/RPC2Context";
import {
  Button,
  Callout,
  Flex,
  Switch,
  Text,
  TextField,
} from "@radix-ui/themes";
import { AlertTriangle, RefreshCw, Save } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { SettingCard } from "./SettingCard";

type DownsamplingPolicy = {
  enabled: boolean;
  raw_retention: string;
  minute_retention_minutes: number;
  five_minute_retention_minutes: number;
  hour_retention_hours: number;
};

const fallbackPolicy: DownsamplingPolicy = {
  enabled: false,
  raw_retention: "15m",
  minute_retention_minutes: 600,
  five_minute_retention_minutes: 3000,
  hour_retention_hours: 600,
};

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : fallback;
}

function normalizePolicy(value: unknown): DownsamplingPolicy {
  if (!value || typeof value !== "object") return fallbackPolicy;
  const policy = value as Partial<DownsamplingPolicy>;
  return {
    enabled: policy.enabled === true,
    raw_retention:
      typeof policy.raw_retention === "string"
        ? policy.raw_retention
        : fallbackPolicy.raw_retention,
    minute_retention_minutes: positiveInteger(
      policy.minute_retention_minutes,
      fallbackPolicy.minute_retention_minutes,
    ),
    five_minute_retention_minutes: positiveInteger(
      policy.five_minute_retention_minutes,
      fallbackPolicy.five_minute_retention_minutes,
    ),
    hour_retention_hours: positiveInteger(
      policy.hour_retention_hours,
      fallbackPolicy.hour_retention_hours,
    ),
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
    if (
      !Number.isSafeInteger(policy.minute_retention_minutes) ||
      !Number.isSafeInteger(policy.five_minute_retention_minutes) ||
      !Number.isSafeInteger(policy.hour_retention_hours) ||
      policy.minute_retention_minutes <= 0 ||
      policy.five_minute_retention_minutes <= 0 ||
      policy.hour_retention_hours <= 0
    ) {
      toast.error(
        t("settings.downsampling.invalid", "三个保留时间都必须是正整数。"),
      );
      return;
    }
    if (
      policy.minute_retention_minutes > policy.five_minute_retention_minutes ||
      policy.five_minute_retention_minutes > policy.hour_retention_hours * 60
    ) {
      toast.error(
        t(
          "settings.downsampling.order_invalid",
          "保留时间必须按 1 分钟、5 分钟、1 小时桶递增或保持不变。",
        ),
      );
      return;
    }
    setSaving(true);
    try {
      const response = await callViaHTTP<{
        enabled: boolean;
        minute_retention_minutes: number;
        five_minute_retention_minutes: number;
        hour_retention_hours: number;
      }, unknown>(
        "admin:setDownsamplingPolicy",
        {
          enabled: policy.enabled,
          minute_retention_minutes: policy.minute_retention_minutes,
          five_minute_retention_minutes: policy.five_minute_retention_minutes,
          hour_retention_hours: policy.hour_retention_hours,
        },
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
        "默认关闭。启用后生成三级聚合数据，并在聚合完成后按策略删除原始点。",
      )}
      direction="column"
    >
      <Flex direction="column" gap="3" className="w-full pt-3">
        <Flex justify="between" align="center" gap="3">
          <div>
            <Text as="div" size="2" weight="medium">
              {t("settings.downsampling.enabled", "启用三级降采样")}
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

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <RetentionInput
            label={t("settings.downsampling.minute_tier", "1 分钟桶")}
            unit={t("settings.downsampling.minutes", "分钟")}
            value={policy.minute_retention_minutes}
            disabled={loading || saving}
            onChange={(value) =>
              setPolicy((current) => ({
                ...current,
                minute_retention_minutes: value,
              }))
            }
          />
          <RetentionInput
            label={t("settings.downsampling.five_minute_tier", "5 分钟桶")}
            unit={t("settings.downsampling.minutes", "分钟")}
            value={policy.five_minute_retention_minutes}
            disabled={loading || saving}
            onChange={(value) =>
              setPolicy((current) => ({
                ...current,
                five_minute_retention_minutes: value,
              }))
            }
          />
          <RetentionInput
            label={t("settings.downsampling.hour_tier", "1 小时桶")}
            unit={t("settings.downsampling.hours", "小时")}
            value={policy.hour_retention_hours}
            disabled={loading || saving}
            onChange={(value) =>
              setPolicy((current) => ({
                ...current,
                hour_retention_hours: value,
              }))
            }
          />
        </div>

        <Text size="1" color="gray">
          {policy.enabled
            ? t("settings.downsampling.raw_window", {
                defaultValue: "原始点保留 {{retention}} 后进入降采样清理。",
                retention: policy.raw_retention,
              })
            : t("settings.downsampling.raw_preserved", "已关闭，原始点完整保留")}
        </Text>

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

function RetentionInput({
  label,
  unit,
  value,
  disabled,
  onChange,
}: {
  label: string;
  unit: string;
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <Flex direction="column" gap="1">
      <Text size="2" weight="medium">{label}</Text>
      <TextField.Root
        type="number"
        min="1"
        step="1"
        value={Number.isFinite(value) && value > 0 ? String(value) : ""}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      >
        <TextField.Slot side="right">{unit}</TextField.Slot>
      </TextField.Root>
    </Flex>
  );
}
