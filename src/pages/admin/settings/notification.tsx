import React from "react";
import { useTranslation } from "react-i18next";
import { Text, Button, Callout, Switch } from "@radix-ui/themes";
import { updateSettings, updateSettingsWithToast, useSettings } from "@/lib/api";
import { SettingCardButton, SettingCardLabel, SettingCardLongTextInput, SettingCardSelect, SettingCardSwitch } from "@/components/admin/SettingCard";
import { toast } from "sonner";
import Loading from "@/components/loading";
import { renderProviderInputs } from "@/utils/renderProviders";
import { SquareArrowOutUpRight } from "lucide-react";
import { Link } from "react-router-dom";
import { alertKinds, digestSecondsInput, normalizeRouteDraft, notificationRequest, toggleRoute, type NotificationRoutes } from "@/utils/notificationRouting";

const NotificationSettings = () => {
 const { t } = useTranslation();
 const { settings, loading, error } = useSettings();
 const [messageDefs, setMessageDefs] = React.useState<Record<string, any[]>>({});
 const [messageList, setMessageList] = React.useState<string[]>([]);
 const [currentMessageSender, setCurrentMessageSender] = React.useState("");
 const [messageValues, setMessageValues] = React.useState<any>({});
 const [messageLoading, setMessageLoading] = React.useState(false);
 const [messageError, setMessageError] = React.useState("");
 const [listError, setListError] = React.useState("");
 const [routes, setRoutes] = React.useState<NotificationRoutes>({});
 const [digestEnabled, setDigestEnabled] = React.useState(false);
 const [digestSeconds, setDigestSeconds] = React.useState("5");
 const [saving, setSaving] = React.useState(false);

 React.useEffect(() => { if (!loading) setRoutes(normalizeRouteDraft(settings.notification_routes)); }, [loading, settings.notification_routes]);
 React.useEffect(() => { if (!loading) { setDigestEnabled(Boolean(settings.notification_digest_enabled)); setDigestSeconds(String(settings.notification_digest_seconds ?? 5)); } }, [loading, settings.notification_digest_enabled, settings.notification_digest_seconds]);

 React.useEffect(() => {
  if (loading) return;
  const controller = new AbortController();
  setListError("");
  void notificationRequest<Record<string, any[]>>("/api/admin/settings/message-sender", {signal:controller.signal}).then((defs) => {
   if (controller.signal.aborted) return;
   const names = Object.keys(defs).filter((name) => name !== "none" && name !== "empty").sort();
   setMessageDefs(defs); setMessageList(names);
   setCurrentMessageSender((previous) => names.includes(previous) ? previous : names.includes(settings.notification_method) ? settings.notification_method : names[0] || "");
  }).catch((reason) => { if (!controller.signal.aborted) setListError(String(reason)); });
  return () => controller.abort();
 }, [loading, settings.notification_method]);

 React.useEffect(() => {
  if (!currentMessageSender) return;
  const controller = new AbortController();
  setMessageLoading(true); setMessageError(""); setMessageValues({});
  void notificationRequest<{addition?:string}>(`/api/admin/settings/message-sender?provider=${encodeURIComponent(currentMessageSender)}`, {signal:controller.signal}).then((value) => {
   if (!controller.signal.aborted) setMessageValues(JSON.parse(value.addition || "{}"));
  }).catch((reason) => { if (!controller.signal.aborted) setMessageError(String(reason)); }).finally(() => { if (!controller.signal.aborted) setMessageLoading(false); });
  return () => controller.abort();
 }, [currentMessageSender]);

 const handleMessageSave = async (values:any) => {
  setMessageLoading(true);
  try {
   await notificationRequest("/api/admin/settings/message-sender", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({name:currentMessageSender, addition:JSON.stringify(values)})});
   setMessageValues(values); setMessageError(""); toast.success(t("common.success"));
  } catch (reason) { toast.error(reason instanceof Error ? reason.message : String(reason)); }
  finally { setMessageLoading(false); }
 };
 const saveRoutes = async () => {
  setSaving(true);
  try { await updateSettings({notification_routes:normalizeRouteDraft(routes)}); toast.success(t("common.success")); }
  catch (reason) { toast.error(String(reason)); }
  finally { setSaving(false); }
 };
 const saveDigest = async () => {
  setSaving(true);
  try { await updateSettings({notification_digest_enabled:digestEnabled, notification_digest_seconds:digestSecondsInput(digestSeconds, t("settings.notification.digest_invalid"))}); toast.success(t("common.success")); }
  catch (reason) { toast.error(String(reason)); }
  finally { setSaving(false); }
 };
 const routeChannels = Array.from(new Set([...messageList, ...Object.values(routes).flat()])).sort();
 if (loading) return <Loading />;
 if (error) return <Text color="red">{error}</Text>;
 return <>
  <SettingCardLabel>{t("settings.notification.title")}</SettingCardLabel>
  <SettingCardSwitch title={t("settings.notification.enable")} description={t("settings.notification.enable_description")} defaultChecked={settings.notification_enabled} onChange={async (checked) => { await updateSettingsWithToast({notification_enabled:checked}, t); }} className="km-page-admin-settings-notification km-setting-card" />
  <SettingCardLongTextInput title={t("settings.notification.template")} description={t("settings.notification.template_description")} defaultValue={settings.notification_template} OnSave={async (value) => { await updateSettingsWithToast({notification_template:value}, t); }} />

  <section className="my-3 rounded-md border p-4 space-y-3">
   <h3 className="font-semibold">{t("settings.notification.routing")}</h3>
   <p className="text-sm text-muted-foreground">{t("settings.notification.routing_description")}</p>
   {listError ? <Callout.Root color="red"><Callout.Text>{listError}</Callout.Text></Callout.Root> : null}
   <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr><th className="p-2 text-left">{t("settings.notification.alert_type")}</th>{routeChannels.map((channel) => <th className="p-2" key={channel}>{messageList.includes(channel) ? channel : t("settings.notification.channel_unloaded", { channel })}</th>)}</tr></thead>
    <tbody>{alertKinds.map((kind) => {
     const label = t("settings.notification.alert_" + kind);
     return <tr className="border-t" key={kind}><td className="p-2 whitespace-nowrap">{label}</td>{routeChannels.map((channel) => <td className="p-2 text-center" key={channel}><input type="checkbox" aria-label={`${label} → ${channel}`} disabled={saving || (!messageList.includes(channel) && !routes[kind]?.includes(channel))} checked={routes[kind]?.includes(channel) || false} onChange={(event) => setRoutes((previous) => toggleRoute(previous,kind,channel,event.target.checked))} /></td>)}</tr>;
    })}</tbody>
   </table></div>
   <Button disabled={saving} onClick={() => void saveRoutes()}>{t("settings.notification.save_routing")}</Button>
  </section>
  <section className="my-3 rounded-md border p-4 space-y-3">
   <h3 className="font-semibold">{t("settings.notification.digest")}</h3>
   <label className="flex items-center gap-2"><Switch checked={digestEnabled} onCheckedChange={setDigestEnabled} disabled={saving} />{t("settings.notification.digest_enable")}</label>
   <p className="text-sm text-muted-foreground">{t("settings.notification.digest_description")}</p>
   <label className="flex items-center gap-2">{t("settings.notification.digest_seconds")}<input className="rounded border p-1 w-28" type="number" min="1" max="3600" step="1" value={digestSeconds} onChange={(event) => setDigestSeconds(event.target.value)} disabled={saving} /></label>
   <Button disabled={saving} onClick={() => void saveDigest()}>{t("settings.notification.save_digest")}</Button>
  </section>
  <SettingCardSelect title={t("settings.notification.channel_setup")} description={t("settings.notification.channel_setup_description")} options={messageList.map((sender) => ({value:sender,label:sender}))} value={currentMessageSender} OnSave={async (value:string) => setCurrentMessageSender(value)} />
  {messageError ? <Callout.Root color="red"><Callout.Text>{messageError}</Callout.Text></Callout.Root> : null}
  {messageLoading ? <Loading /> : !messageError && renderProviderInputs({currentProvider:currentMessageSender, providerDefs:messageDefs, providerValues:messageValues, translationPrefix:`settings.notification.${currentMessageSender}`, title:t("settings.notification.provider_fields"), description:t("settings.notification.provider_fields_description"), setProviderValues:setMessageValues, handleSave:handleMessageSave, t})}
  <SettingCardButton title={t("settings.notification.test_channel")} description={t("settings.notification.test_channel_description")} onClick={async () => {
   if (!currentMessageSender || messageLoading || messageError) { toast.error(t("settings.notification.channel_setup_required")); return; }
   try { await notificationRequest("/api/admin/test/sendMessage", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({provider:currentMessageSender})}); toast.success(t("common.success")); }
   catch (reason) { toast.error(reason instanceof Error ? reason.message : String(reason)); }
  }}>{t("settings.notification.test_channel_action")}</SettingCardButton>
  <label className="text-muted-foreground text-sm flex flex-row items-center gap-1">{t("settings.notification.moved")}<Link to="/admin/notification/general"><SquareArrowOutUpRight size={16} /></Link></label>
 </>;
};
export default NotificationSettings;
