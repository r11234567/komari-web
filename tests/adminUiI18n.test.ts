import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { alertKinds } from "../src/utils/notificationRouting.ts";

type Catalog = { [key: string]: string | Catalog };

const locales = ["en", "id_ID", "ja_JP", "zh_CN", "zh_TW"];
const catalog = (locale: string): Catalog =>
  JSON.parse(readFileSync(new URL("../src/i18n/locales/" + locale + ".json", import.meta.url), "utf8"));
const readKey = (messages: Catalog, key: string) => {
  let value: Catalog | string | undefined = messages;
  for (const part of key.split(".")) {
    value = typeof value === "object" ? value[part] : undefined;
  }
  return value;
};

const pages = [
  "components/admin/AgentCredentialLifecycle.tsx",
  "components/admin/PerformanceDiagnostics.tsx",
  "components/admin/RescueConsole.tsx",
  "pages/admin/billing.tsx",
  "pages/admin/rescue.tsx",
  "pages/admin/returnRoute.tsx",
  "pages/admin/settings/notification.tsx",
  "api/credentialLifecycle.ts",
];

test("the localized admin pages have their own translations in all supported languages", () => {
  const used = new Set([
    ...alertKinds.map((kind) => "settings.notification.alert_" + kind),
    "admin_dashboard.cost_year",
    "admin_dashboard.remaining_value",
    "common.region_flag_alt",
  ]);
  for (const page of pages) {
    const source = readFileSync(new URL("../src/" + page, import.meta.url), "utf8");
    for (const [key] of source.matchAll(/"(?:agent_credentials|billing|common|rescue|return_route|settings\.notification)\.[\w.]+(?<!_)(?=")/g)) {
      used.add(key.slice(1));
    }
  }

  const source = catalog("zh_CN");
  // These groups also contain labels selected at runtime by status or action.
  for (const group of ["agent_credentials", "billing", "rescue", "return_route"]) {
    for (const key of Object.keys(source[group])) used.add(group + "." + key);
  }
  const placeholders = (value: string) =>
    [...value.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((match) => match[1]).sort();

  for (const locale of locales) {
    const messages = catalog(locale);
    for (const key of used) {
      const value = readKey(messages, key);
      const original = readKey(source, key);
      assert.ok(typeof value === "string" && value.trim(), locale + ": " + key);
      assert.equal(typeof original, "string", "zh_CN: " + key);
      assert.deepEqual(placeholders(value), placeholders(original as string), locale + ": " + key);
    }
  }
});
