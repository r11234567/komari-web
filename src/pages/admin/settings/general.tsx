import { useTranslation } from "react-i18next";
import { Button, Code, Flex, Text, TextField } from "@radix-ui/themes";
import {
  updateSettingsWithToast,
  useSettings,
  type SettingsResponse,
} from "@/lib/api";
import {
  SettingCardButton,
  SettingCardCollapse,
  SettingCardLabel,
  SettingCardSelect,
  SettingCardShortTextInput,
  SettingCardSwitch,
} from "@/components/admin/SettingCard";
import React from "react";
import { toast } from "sonner";
import Loading from "@/components/loading";
import GeneralConnectivitySettings from "./reverse-proxy";

export default function GeneralSettings() {
  const { t } = useTranslation();
  const { settings, loading, error, refetch } = useSettings();
  const [geoip_testResult, setGeoipTestResult] = React.useState<string | null>(
    null
  );
  if (loading) {
    return <Loading text="creeper?" />;
  }

  if (error) {
    return <Text color="red">{error}</Text>;
  }

  return (
    <>
      <SettingCardLabel>
        {t("settings.general.auto_discovery")}
      </SettingCardLabel>
      <ApiCard settings={settings} />
      <SettingCardLabel>
        {t("settings.general.integrations", "Agent 兼容")}
      </SettingCardLabel>
      <SettingCardSwitch
        title={t("settings.general.nezha_compat_title", "哪吒 Agent 兼容")}
        description={t(
          "settings.general.nezha_compat_description",
          "允许哪吒 Agent 使用客户端 UUID 和密钥接入 Komari。",
        )}
        defaultChecked={settings.nezha_compat_enabled === true}
        onChange={async (checked) => {
          await updateSettingsWithToast({ nezha_compat_enabled: checked }, t);
          await refetch();
        }}
      />
      <SettingCardShortTextInput
        title={t(
          "settings.general.nezha_compat_listen",
          "哪吒兼容服务监听地址",
        )}
        description={t(
          "settings.general.nezha_compat_listen_description",
          "修改已启用服务的地址会立即重启兼容服务。",
        )}
        defaultValue={settings.nezha_compat_listen || "0.0.0.0:5555"}
        placeholder="0.0.0.0:5555"
        OnSave={async (value) => {
          const listen = value.trim();
          if (!listen || !listen.includes(":")) {
            toast.error(
              t(
                "settings.general.nezha_compat_listen_invalid",
                "请输入有效的监听地址。",
              ),
            );
            throw new Error("Invalid Nezha compatibility listen address");
          }
          await updateSettingsWithToast({ nezha_compat_listen: listen }, t);
          await refetch();
        }}
      />
      <SettingCardLabel>{t("settings.geoip.title")}</SettingCardLabel>
      <SettingCardSwitch
        title={t("settings.geoip.enable_title")}
        description={t("settings.geoip.enable_description")}
        defaultChecked={settings.geo_ip_enabled}
        onChange={async (checked) => {
          await updateSettingsWithToast({ geo_ip_enabled: checked }, t);
        }}
        className="km-page-admin-settings-general km-setting-card"
      />
      <SettingCardSelect
        title={t("settings.geoip.provider_title")}
        description={t("settings.geoip.provider_description")}
        defaultValue={settings.geo_ip_provider}
        options={[
          { value: "empty", label: t("common.none") },
          { value: "mmdb", label: "MaxMind" },
          { value: "ip-api", label: "ip-api.com" },
          { value: "geojs", label: "geojs.io" },
          { value: "ipinfo", label: "ipinfo.io" },
        ]}
        OnSave={async (value) => {
          await updateSettingsWithToast({ geo_ip_provider: value }, t);
        }}
      />
      <SettingCardButton
        title={t("settings.geoip.update_title")}
        onClick={async () => {
          const result = await fetch("/api/admin/update/mmdb", {
            method: "POST",
          });
          const data = await result.json();
          if (data.status === "success") {
            toast.success(t("settings.geoip.update_success"));
          } else {
            toast.error(
              data.message || t("settings.geoip.update_error")
            );
          }
        }}
        className="km-setting-card"
      >
        {t("common.update")}
      </SettingCardButton>
      <SettingCardCollapse
        title={t("settings.geoip.test_title")}
        description={t("settings.geoip.test_description")}
      >
        <Flex className="w-full gap-2" direction="column">
          <TextField.Root placeholder="1.1.1.1 or 2606:4700:4700::1111"></TextField.Root>
          <div>
            <Button
              variant="solid"
              onClick={async () => {
                const ip = (
                  document.querySelector(
                    "input[placeholder]"
                  ) as HTMLInputElement
                ).value;
                const result = await fetch(`/api/admin/test/geoip?ip=${ip}`);
                const data = await result.json();
                setGeoipTestResult(
                  JSON.stringify(data.data, null, 2) || t("common.no_results")
                );
              }}
            >
              {t("settings.geoip.test_button")}
            </Button>
          </div>{" "}
          <Flex className="w-full">
            {geoip_testResult && (
              <Code
                className="w-full whitespace-pre-wrap text-sm p-3 rounded-md overflow-auto max-h-96"
                style={{ display: "block" }}
              >
                {geoip_testResult}
              </Code>
            )}
          </Flex>
        </Flex>
      </SettingCardCollapse>
      <GeneralConnectivitySettings />
    </>
  );
}

const ApiCard = ({ settings }: { settings: SettingsResponse }) => {

  //const { settings } = useSettings();
  const { t } = useTranslation();
  const [apiValues, setApiValues] = React.useState<string>(
    settings?.auto_discovery_key || ""
  );

  // 生成32位随机字符串
  const generateRandomString = () => {
    const chars =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let result = "";
    for (let i = 0; i < 24; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  };

  // 处理生成按钮点击
  const handleGenerateApiKey = () => {
    const newApiKey = generateRandomString();
    setApiValues(newApiKey);
  };

  // 初始化API值
  React.useEffect(() => {
    if (settings?.auto_discovery_key) {
      setApiValues(settings.auto_discovery_key);
    }
  }, [settings?.auto_discovery_key]);

  return (
    <SettingCardShortTextInput
      title={t("settings.general.auto_discovery_key")}
      description={t("settings.general.auto_discovery_key_description")}
      value={apiValues}
      onChange={(e) => setApiValues(e.target.value)}
      OnSave={async (values) => {
        if (!values) {
          await updateSettingsWithToast({ auto_discovery_key: "" }, t);
          return;
        }
        if (values.length < 12) {
          toast.error(t("settings.api.key_length_error"));
          return;
        }
        await updateSettingsWithToast({ auto_discovery_key: values }, t);
      }}
    >
      <div className="flex flex-row gap-2 justify-start items-center">
        <Button variant="soft" color="green" onClick={handleGenerateApiKey}>
          {t("common.generate")}
        </Button>
        <Button
          variant="soft"
          color="mint"
          onClick={() => {
            window.open(
              "https://komari-document.pages.dev/install/agent-ad.html",
              "_blank"
            );
          }}
        >
          {t("common.help")}
        </Button>
      </div>
    </SettingCardShortTextInput>
  );
};
