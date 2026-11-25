import { useTranslation } from "react-i18next";
import { Text } from "@radix-ui/themes";
import { useSettings } from "@/lib/api";
import SensitiveActionDialog from "@/components/SensitiveActionDialog";
import { useSensitiveSetting } from "@/hooks/useSensitiveSetting";
import { SettingCardLongTextInput } from "@/components/admin/SettingCard";
import Loading from "@/components/loading";

export default function CustomSettings() {
  const { t } = useTranslation();
  const { settings, loading, error } = useSettings();
  const sensitiveSetting = useSensitiveSetting();

  if (loading) {
    return <Loading />;
  }

  if (error) {
    return <Text color="red">{error}</Text>;
  }

  return (
    <div className="km-page-admin-settings-custom">
      <SettingCardLongTextInput
        title={t("settings.custom.header")}
        description={t("settings.custom.header_description")}
        defaultValue={settings.custom_head || ""}
        OnSave={(data) => sensitiveSetting.save("custom_head", data, t("settings.custom.header"))}
      />
      <SensitiveActionDialog request={sensitiveSetting.request} onClose={sensitiveSetting.close} />
    </div>
  );
}
