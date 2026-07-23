import { CloudflaredCard } from "@/components/admin/CloudflaredCard";
import { HistoryExportCard } from "@/components/admin/HistoryExportCard";
import {
  SettingCardLabel,
  SettingCardShortTextInput,
  SettingCardSwitch,
} from "@/components/admin/SettingCard";
import Loading from "@/components/loading";
import { updateSettingsWithToast, useSettings } from "@/lib/api";
import { Flex, Text } from "@radix-ui/themes";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

function parseRetentionHours(value: string): number | null {
  const hours = Number(value);
  if (!Number.isInteger(hours) || hours < 1) return null;
  return hours;
}

export default function LTSDatabaseSettings() {
  const { t } = useTranslation();
  const { settings, loading, error } = useSettings();

  if (loading) return <Loading />;
  if (error) return <Text color="red">{error}</Text>;

  const saveHours = async (
    key: "record_preserve_time" | "ping_record_preserve_time",
    value: string,
  ) => {
    const hours = parseRetentionHours(value);
    if (hours === null) {
      toast.error(t("settings.lts_database.retention_invalid"));
      return;
    }
    await updateSettingsWithToast({ [key]: hours }, t);
  };

  return (
    <Flex direction="column" gap="3">
      <SettingCardLabel>{t("settings.lts_database.title")}</SettingCardLabel>

      <SettingCardSwitch
        title={t("settings.lts_database.record_enabled")}
        description={t("settings.lts_database.record_enabled_description")}
        defaultChecked={settings.record_enabled !== false}
        onChange={async (checked) => {
          await updateSettingsWithToast({ record_enabled: checked }, t);
        }}
      />
      <SettingCardShortTextInput
        title={t("settings.lts_database.resource_retention")}
        description={t("settings.lts_database.resource_retention_description")}
        type="number"
        min="1"
        step="1"
        defaultValue={String(settings.record_preserve_time ?? 720)}
        OnSave={(value) => saveHours("record_preserve_time", value)}
      />
      <SettingCardShortTextInput
        title={t("settings.lts_database.ping_retention")}
        description={t("settings.lts_database.ping_retention_description")}
        type="number"
        min="1"
        step="1"
        defaultValue={String(settings.ping_record_preserve_time ?? 24)}
        OnSave={(value) => saveHours("ping_record_preserve_time", value)}
      />

      <CloudflaredCard settings={settings} />
      <HistoryExportCard />
    </Flex>
  );
}
