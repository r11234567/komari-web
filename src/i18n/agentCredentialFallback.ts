import i18next from "i18next";
import zhCN from "./locales/zh_CN.json" with { type: "json" };

export const agentCredentialFallback = i18next.createInstance();

// Preserve readable labels and errors when this feature is used before app i18n starts.
void agentCredentialFallback.init({
  lng: "zh-CN",
  fallbackLng: false,
  resources: { "zh-CN": { translation: { agent_credentials: zhCN.agent_credentials, common: zhCN.common } } },
  interpolation: { escapeValue: false },
  initAsync: false,
});
