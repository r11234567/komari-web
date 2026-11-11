import { createRoot } from "react-dom/client";
import { Theme } from "@radix-ui/themes";
import "@radix-ui/themes/styles.css";
import { create } from "@bufbuild/protobuf";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import en from "../../../src/i18n/locales/en.json";
import zh from "../../../src/i18n/locales/zh_CN.json";
import { connectClients } from "../../../src/api/connect/client";
import { ListPluginPackagesResponseSchema, PluginPackageSchema } from "@komari/proto/komari/plugin/v1/plugin_pb";
import { ListApiTokensResponseSchema } from "@komari/proto/komari/admin/v1/api_token_pb";
import { ListAgentsResponseSchema } from "@komari/proto/komari/browser/v1/browser_pb";
import PluginPackageManager from "../../../src/components/admin/PluginPackageManager";
import ApiTokenManager from "../../../src/components/admin/ApiTokenManager";

// This harness never connects to a real panel. All identities/data are synthetic.
const params = new URLSearchParams(location.search);
const state = { calls: [] as { action: string; proof: boolean }[], tokenRevoked: false, legacy: true };
Object.assign(window, { managementAudit: state });
const packages = ["example-otp", "example-passkey"].map((shortName, i) => create(PluginPackageSchema, {
  plugin: { shortName, version: "1.0.0", permissions: { allowRoutes: true } },
  digest: String(i + 1).repeat(64), currentDigest: String(i + 1).repeat(64),
  source: i ? "https://catalog.example/v1.json\nhttps://download.example/package.zip" : "Existing installation snapshot",
  status: "approved", approvedAtUnix: 1793680000n, createdAtUnix: 1793679900n, approvedBy: "synthetic-operator",
}));
connectClients.plugin.listPluginPackages = async () => create(ListPluginPackagesResponseSchema, { packages });
connectClients.plugin.decidePluginPackage = async request => {
  state.calls.push({ action: request.action ?? "", proof: !!request.twoFactor });
  const row = packages.find(item => item.digest === request.digest)!;
  row.revoked = true; row.status = "revoked";
  return {} as Awaited<ReturnType<typeof connectClients.plugin.decidePluginPackage>>;
};
connectClients.apiToken.listApiTokens = async () => create(ListApiTokensResponseSchema, {
  total: 1, page: 1, legacyApiKeyEnabled: state.legacy,
  tokens: [{ id: "synthetic-token", name: "Fixture reader", scopes: ["nodes:read"], allAgents: true,
    expiresAt: { seconds: 2000000000n }, revokedAt: state.tokenRevoked ? { seconds: 1793680000n } : undefined }],
});
connectClients.browser.listAgents = async () => create(ListAgentsResponseSchema, { agents: [{ agentId: "synthetic-node", name: "Fixture node" }] });
connectClients.apiToken.revokeApiToken = async request => {
  state.calls.push({ action: "revoke-token", proof: !!request.twoFactor }); state.tokenRevoked = true;
  return {} as Awaited<ReturnType<typeof connectClients.apiToken.revokeApiToken>>;
};
connectClients.apiToken.disableLegacyApiKey = async request => {
  state.calls.push({ action: "disable-legacy", proof: !!request.twoFactor }); state.legacy = false;
  return {} as Awaited<ReturnType<typeof connectClients.apiToken.disableLegacyApiKey>>;
};
await i18next.use(initReactI18next).init({ lng: params.get("lng") || "zh-CN", fallbackLng: "en", resources: { en: { translation: en }, "zh-CN": { translation: zh } } });
createRoot(document.getElementById("root")!).render(<Theme><div style={{ maxWidth: 1000, margin: "32px auto" }}>
  {params.get("screen") === "tokens" ? <ApiTokenManager /> : <PluginPackageManager compact onChanged={() => {}} />}
</div></Theme>);
if (params.has("open")) setTimeout(() => document.querySelector<HTMLButtonElement>("button")?.click(), 500);
