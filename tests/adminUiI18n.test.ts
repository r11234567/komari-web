import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { alertKinds } from "../src/utils/notificationRouting.ts";
import { rescueSpecDigest } from "../src/utils/credentialAction.ts";
import { temporarySSHHelpURL } from "../src/utils/temporarySSHHelp.ts";

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

test("temporary SSH help follows the UI language and opens the matching diagnosis", () => {
  const root = "https://github.com/r11234567/komari/blob/main/docs/";
  for (const locale of ["zh_CN", "zh-TW"]) {
    assert.equal(temporarySSHHelpURL(locale, "SSH_CONFIG_MISSING"), `${root}temporary-ssh.zh-CN.md#ssh_config_missing`);
  }
  for (const locale of ["en", "id_ID", "ja_JP"]) {
    assert.equal(temporarySSHHelpURL(locale, "SSH_NFT_RULES_INVALID"), `${root}temporary-ssh.md#ssh_nft_rules_invalid`);
  }
  assert.equal(temporarySSHHelpURL("zh_CN"), `${root}temporary-ssh.zh-CN.md#申请并验证`);
  assert.equal(temporarySSHHelpURL("en", "UNKNOWN_CODE"), `${root}temporary-ssh.md#request-and-confirm-access`);
});

test("temporary SSH binds the fixed port, IPv6 source, prior grant and enrollment to its 2FA proof", async () => {
  const base = { timeoutSeconds: 300, maxOutputBytes: 262144 };
  const sshWindow = { sourceIp: "2001:db8::5", previousGrantId: "A".repeat(32), enrollmentKeyId: "enrollment-one" };
  const spec = { ...base, sshPort: 8658, sshWindow };
  const proof = await rescueSpecDigest(spec);
  assert.equal(proof, "spec:66a43c7f3021d669ee7c2269649a7f92990151ced25a2611c663c7eb008bf794");
  assert.notEqual(await rescueSpecDigest({ ...spec, sshPort: 22 }), proof);
  for (const change of [{ sourceIp: "2001:db8::6" }, { previousGrantId: "" }, { enrollmentKeyId: "enrollment-two" }]) {
    assert.notEqual(await rescueSpecDigest({ ...spec, sshWindow: { ...sshWindow, ...change } }), proof);
  }
  assert.equal(await rescueSpecDigest(base), "spec:b2e20441b364b97ae585eedfb992f562bebb76bb0ef268c97020bf7a645b74e4");
});

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
