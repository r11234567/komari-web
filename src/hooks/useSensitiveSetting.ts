import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { SensitiveAction } from "@/components/SensitiveActionDialog";
import { type SettingsResponse, updateSettingsWithToast } from "@/lib/api";

export function useSensitiveSetting() {
  const { t } = useTranslation();
  const [request, setRequest] = useState<SensitiveAction | null>(null);
  const save = (key: keyof SettingsResponse & string, value: string | boolean, title: string) => {
    const type = typeof value === "boolean" ? "bool" : "string";
    setRequest({
      action: "settings:edit",
      targets: [key, `${type}:${value}`],
      title,
      execute: (token, signal) => updateSettingsWithToast({ [key]: value }, t, { token, signal }),
    });
  };
  return { request, save, close: () => setRequest(null) };
}
