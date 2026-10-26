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
  try { await updateSettings({notification_digest_enabled:digestEnabled, notification_digest_seconds:digestSecondsInput(digestSeconds)}); toast.success(t("common.success")); }
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
   <h3 className="font-semibold">告警渠道</h3>
   <p className="text-sm text-muted-foreground">每类通知可以同时发送到多个渠道；全部不勾选就不发送。原来的单渠道设置会自动迁移。先在下面配置渠道连接。</p>
   {listError ? <Callout.Root color="red"><Callout.Text>{listError}</Callout.Text></Callout.Root> : null}
   <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr><th className="p-2 text-left">告警类型</th>{routeChannels.map((channel) => <th className="p-2" key={channel}>{channel}{!messageList.includes(channel) ? "（未加载）" : ""}</th>)}</tr></thead>
    <tbody>{alertKinds.map(([kind,label]) => <tr className="border-t" key={kind}><td className="p-2 whitespace-nowrap">{label}</td>{routeChannels.map((channel) => <td className="p-2 text-center" key={channel}><input type="checkbox" aria-label={`${label} → ${channel}`} disabled={saving || (!messageList.includes(channel) && !routes[kind]?.includes(channel))} checked={routes[kind]?.includes(channel) || false} onChange={(event) => setRoutes((previous) => toggleRoute(previous,kind,channel,event.target.checked))} /></td>)}</tr>)}</tbody>
   </table></div>
   <Button disabled={saving} onClick={() => void saveRoutes()}>{t("common.save", "保存")}告警渠道</Button>
  </section>
  <section className="my-3 rounded-md border p-4 space-y-3">
   <h3 className="font-semibold">告警汇总推送</h3>
   <label className="flex items-center gap-2"><Switch checked={digestEnabled} onCheckedChange={setDigestEnabled} disabled={saving} />启用汇总（默认关闭）</label>
   <p className="text-sm text-muted-foreground">相同内容在固定时间窗口内合并，并列出涉及的服务器。登录通知和流量日报、周报、月报仍单独发送。</p>
   <label className="flex items-center gap-2">汇总时间（秒）<input className="rounded border p-1 w-28" type="number" min="1" max="3600" step="1" value={digestSeconds} onChange={(event) => setDigestSeconds(event.target.value)} disabled={saving} /></label>
   <Button disabled={saving} onClick={() => void saveDigest()}>{t("common.save", "保存")}汇总设置</Button>
  </section>
  <SettingCardSelect title="配置渠道连接" description="选择要编辑或测试的渠道；实际发送由上面的告警渠道设置决定。" options={messageList.map((sender) => ({value:sender,label:sender}))} value={currentMessageSender} OnSave={async (value:string) => setCurrentMessageSender(value)} />
  {messageError ? <Callout.Root color="red"><Callout.Text>{messageError}</Callout.Text></Callout.Root> : null}
  {messageLoading ? <Loading /> : !messageError && renderProviderInputs({currentProvider:currentMessageSender, providerDefs:messageDefs, providerValues:messageValues, translationPrefix:`settings.notification.${currentMessageSender}`, title:t("settings.notification.provider_fields"), description:t("settings.notification.provider_fields_description"), setProviderValues:setMessageValues, handleSave:handleMessageSave, t})}
  <SettingCardButton title="测试当前渠道" description="保存连接设置后，向当前选择的渠道发送测试；测试不受总开关和告警勾选影响。" onClick={async () => {
   if (!currentMessageSender || messageLoading || messageError) { toast.error("请先加载并保存渠道配置"); return; }
   try { await notificationRequest("/api/admin/test/sendMessage", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({provider:currentMessageSender})}); toast.success(t("common.success")); }
   catch (reason) { toast.error(reason instanceof Error ? reason.message : String(reason)); }
  }}>GO</SettingCardButton>
  <label className="text-muted-foreground text-sm flex flex-row items-center gap-1">{t("settings.notification.moved")}<Link to="/admin/notification/general"><SquareArrowOutUpRight size={16} /></Link></label>
 </>;
};
export default NotificationSettings;
