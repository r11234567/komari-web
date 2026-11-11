import { useSettings } from "@/lib/api";
import { Button, Flex, Text, TextField } from "@radix-ui/themes";
import { Save } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { SettingCard } from "./SettingCard";

const fields = [
  { key: "metric_hot_window_minutes", label: "hot", fallback: 15, min: 1, max: 120, unit: "minutes" },
  { key: "metric_archive_retention_days", label: "archive", fallback: 30, min: 1, max: 3650, unit: "days" },
  { key: "metric_hot_budget_mib", label: "budget", fallback: 1024, min: 64, max: 65536, unit: "mib" },
] as const;

export function DownsamplingCard() {
  const { t } = useTranslation();
  const { settings, loading, error, updateMultipleSettings } = useSettings();
  const [draft, setDraft] = React.useState<Record<string, number>>({});
  const [saving, setSaving] = React.useState(false);
  const value = (field: typeof fields[number]) => draft[field.key] ?? Number(settings[field.key] ?? field.fallback);
  const save = async () => {
    const changes: Record<string, number> = {};
    for (const field of fields) {
      const next = value(field);
      if (!Number.isSafeInteger(next) || next < field.min || next > field.max) {
        toast.error(t("settings.telemetry.invalid")); return;
      }
      changes[field.key] = next;
    }
    setSaving(true);
    try {
      await updateMultipleSettings(changes); setDraft({});
      toast.success(t("settings.settings_saved"));
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause));
    } finally { setSaving(false); }
  };
  return (
    <SettingCard title={t("settings.telemetry.title")} description={t("settings.telemetry.description")} direction="column">
      <Flex direction="column" gap="3" className="w-full pt-3">
        {error && <Text color="red">{error}</Text>}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {fields.map((field) => (
            <Flex key={field.key} direction="column" gap="1">
              <Text as="label" htmlFor={field.key} size="2" weight="medium">{t(`settings.telemetry.${field.label}`)}</Text>
              <TextField.Root id={field.key} type="number" min={field.min} max={field.max} step="1" value={String(value(field))}
                disabled={loading || saving} onChange={(event) => setDraft((current) => ({ ...current, [field.key]: Number(event.target.value) }))}>
                <TextField.Slot side="right">{t(`settings.telemetry.${field.unit}`)}</TextField.Slot>
              </TextField.Root>
            </Flex>
          ))}
        </div>
        <Text size="1" color="gray">{t("settings.telemetry.precision")}</Text>
        <Text size="1" color="gray">{t("settings.telemetry.retention_notice")}</Text>
        <Flex justify="end"><Button disabled={loading || saving} onClick={() => void save()}><Save size={16} />{t("common.save")}</Button></Flex>
      </Flex>
    </SettingCard>
  );
}
