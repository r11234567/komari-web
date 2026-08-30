import React from "react";
import { Badge, Button, Callout, Dialog, Select, Skeleton, Tabs } from "@radix-ui/themes";
import { Activity, AlertCircle, CircleDollarSign, Plus, RefreshCw, Server, WalletCards } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";

import AdminPageTitle from "@/components/admin/AdminPageTitle";
import { ChartContainer } from "@/components/ui/chart";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  BILLING_CURRENCY_STORAGE_KEY,
  billingCurrencies,
  billingDate,
  billingDateTime,
  billingQuery,
  billingRequest,
  billingTypeLabel,
  formatBillingMoney,
  getBillingSnapshot,
  readStoredBillingCurrency,
  requestBillingCached,
  resetBillingCache,
  type BillingCurrency,
  type BillingEntry,
  type BillingEntryPage,
  type BillingOverview,
  type BillingPeriodPage,
  type BillingServer,
  type BillingServerPage,
} from "@/utils/billing";
import { formatBytes } from "@/utils/unitHelper";

type BillingData = {
  overview: BillingOverview;
  servers: BillingServerPage;
  monthly: BillingPeriodPage;
  yearly: BillingPeriodPage;
  entries: BillingEntryPage;
};

function billingURLs(currency: BillingCurrency) {
  const currentYear = new Intl.DateTimeFormat("en", { timeZone: "Asia/Shanghai", year: "numeric" }).format(new Date());
  const currentYearMonths = Array.from({ length: 12 }, (_, index) => `${currentYear}-${String(index + 1).padStart(2, "0")}`);
  return {
    overview: billingQuery("/api/admin/billing/overview", { currency }),
    servers: billingQuery("/api/admin/billing/servers", { currency, page: 1, page_size: 100 }),
    monthly: billingQuery("/api/admin/billing/periods/monthly", { currency, months: currentYearMonths, page: 1, page_size: 100 }),
    yearly: billingQuery("/api/admin/billing/periods/yearly", { currency, years: currentYear, page: 1, page_size: 30 }),
    entries: billingQuery("/api/admin/billing/entries", { currency, page: 1, page_size: 100 }),
  };
}

function cachedBillingData(currency: BillingCurrency): Partial<BillingData> {
  const urls = billingURLs(currency);
  return {
    overview: getBillingSnapshot<BillingOverview>(urls.overview) ?? undefined,
    servers: getBillingSnapshot<BillingServerPage>(urls.servers) ?? undefined,
    monthly: getBillingSnapshot<BillingPeriodPage>(urls.monthly) ?? undefined,
    yearly: getBillingSnapshot<BillingPeriodPage>(urls.yearly) ?? undefined,
    entries: getBillingSnapshot<BillingEntryPage>(urls.entries) ?? undefined,
  };
}

function MoneyCard({ label, value, detail, icon }: { label: string; value: string; detail: string; icon: React.ReactNode }) {
  return (
    <section className="min-h-[112px] rounded-md border bg-[var(--color-panel-solid)] p-3">
      <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
        <span>{label}</span><span className="text-[var(--accent-11)]">{icon}</span>
      </div>
      <div className="mt-2 text-2xl font-bold tabular-nums text-foreground">{value}</div>
      <p className="mt-2 text-xs text-muted-foreground">{detail}</p>
    </section>
  );
}

function statusBadge(server: BillingServer, value: string) {
  return <Badge color={server.billing_status === "recurring" ? "green" : server.billing_status === "unconfigured" ? "gray" : "orange"}>{value}</Badge>;
}

export default function BillingCenter() {
  const { t } = useTranslation();
  const [currency, setCurrency] = React.useState<BillingCurrency>(readStoredBillingCurrency);
  const [data, setData] = React.useState<Partial<BillingData>>(() => cachedBillingData(currency));
  const [loading, setLoading] = React.useState(() => !cachedBillingData(currency).overview);
  const [error, setError] = React.useState<string | null>(null);
  const [feeServer, setFeeServer] = React.useState<BillingServer | null>(null);
  const [trafficServer, setTrafficServer] = React.useState<BillingServer | null>(null);
  const [voidEntry, setVoidEntry] = React.useState<BillingEntry | null>(null);
  const [saving, setSaving] = React.useState(false);

  const load = React.useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    const urls = billingURLs(currency);
    try {
      const [overview, servers, monthly, yearly, entries] = await Promise.all([
        requestBillingCached<BillingOverview>(urls.overview),
        requestBillingCached<BillingServerPage>(urls.servers),
        requestBillingCached<BillingPeriodPage>(urls.monthly),
        requestBillingCached<BillingPeriodPage>(urls.yearly),
        requestBillingCached<BillingEntryPage>(urls.entries),
      ]);
      setData({ overview, servers, monthly, yearly, entries });
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, [currency]);

  React.useEffect(() => {
    const cached = cachedBillingData(currency);
    if (cached.overview) setData(cached);
    setLoading(!cached.overview);
    void load(Boolean(cached.overview));
  }, [currency, load]);

  const refresh = React.useCallback(async () => {
    resetBillingCache();
    await load(true);
  }, [load]);

  const overview = data.overview;
  const displayCurrency = overview?.currency ?? currency;
  const trend = (overview?.monthly_trend ?? []).map((item) => ({
    period: item.period,
    base: Number(item.base),
    extra: Number(item.extra) + Number(item.other || 0) + Number(item.one_time || 0),
  }));

  const setDisplayCurrency = (value: string) => {
    const next = value as BillingCurrency;
    localStorage.setItem(BILLING_CURRENCY_STORAGE_KEY, next);
    setCurrency(next);
  };

  return (
    <div className="flex flex-col gap-4 p-1 md:p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <AdminPageTitle description={t("billing.subtitle", "查看费用、到期时间、剩余价值和不可变费用明细")}>{t("billing.title", "成本中心")}</AdminPageTitle>
        <div className="flex items-center gap-2">
          <Select.Root value={currency} onValueChange={setDisplayCurrency}>
            <Select.Trigger aria-label={t("billing.currency", "显示币种")} />
            <Select.Content>{billingCurrencies.map((item) => <Select.Item key={item} value={item}>{item}</Select.Item>)}</Select.Content>
          </Select.Root>
          <Button variant="soft" onClick={() => void refresh()} disabled={loading}><RefreshCw size={16} />{t("common.refresh", "刷新")}</Button>
        </div>
      </div>

      {error ? <Callout.Root color="red"><Callout.Icon><AlertCircle size={16} /></Callout.Icon><Callout.Text>{error}</Callout.Text></Callout.Root> : null}
      {loading && !overview ? <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">{[0, 1, 2, 3].map((item) => <Skeleton key={item} height="112px" />)}</div> : null}
      {overview ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MoneyCard label={t("billing.month", "本月费用")} value={formatBillingMoney(overview.summary.month.total, displayCurrency)} detail={t("billing.month_detail", "按已入账费用汇总")} icon={<WalletCards size={18} />} />
          <MoneyCard label={t("billing.year", "本年费用")} value={formatBillingMoney(overview.summary.year.total, displayCurrency)} detail={t("billing.year_detail", "包含基础费用与附加费用")} icon={<CircleDollarSign size={18} />} />
          <MoneyCard label={t("billing.remaining", "服务器剩余价值")} value={formatBillingMoney(overview.summary.remaining_value, displayCurrency)} detail={t("billing.remaining_detail", "仅按基础费用估算")} icon={<Server size={18} />} />
          <MoneyCard label={t("billing.expiring", "30 天内到期")} value={String(overview.summary.expiring_within_30_days)} detail={t("billing.expiring_detail", "已配置到期时间的服务器")} icon={<Server size={18} />} />
        </div>
      ) : null}

      <Tabs.Root defaultValue="overview">
        <Tabs.List>
          <Tabs.Trigger value="overview">{t("billing.overview", "概览")}</Tabs.Trigger>
          <Tabs.Trigger value="monthly">{t("billing.monthly", "月度")}</Tabs.Trigger>
          <Tabs.Trigger value="yearly">{t("billing.yearly", "年度")}</Tabs.Trigger>
          <Tabs.Trigger value="entries">{t("billing.entries", "费用明细")}</Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="overview" className="mt-3 space-y-3">
          {trend.length > 0 ? (
            <section className="h-[280px] rounded-md border bg-[var(--color-panel-solid)] p-3">
              <h2 className="mb-2 text-sm font-semibold">{t("billing.trend", "最近月度费用")}</h2>
              <ChartContainer config={{ base: { label: t("billing.base", "基础费用"), color: "var(--accent-9)" }, extra: { label: t("billing.extra", "附加费用"), color: "var(--orange-9)" } }} className="h-[230px] w-full">
                <BarChart data={trend}><CartesianGrid vertical={false} /><XAxis dataKey="period" tickLine={false} axisLine={false} /><YAxis width={56} tickLine={false} axisLine={false} /><Tooltip /><Bar dataKey="base" stackId="cost" fill="var(--accent-9)" /><Bar dataKey="extra" stackId="cost" fill="var(--orange-9)" /></BarChart>
              </ChartContainer>
            </section>
          ) : null}
          <ServerTable servers={data.servers?.items ?? []} currency={displayCurrency} onAddFee={setFeeServer} onTraffic={setTrafficServer} />
        </Tabs.Content>
        <Tabs.Content value="monthly" className="mt-3"><PeriodTable data={data.monthly} currency={displayCurrency} averageLabel={t("billing.monthly_average", "已完成月份月均费用")} average={data.monthly?.monthly_average} /></Tabs.Content>
        <Tabs.Content value="yearly" className="mt-3"><PeriodTable data={data.yearly} currency={displayCurrency} averageLabel={t("billing.yearly_average", "已完成年份年均费用")} average={data.yearly?.yearly_average} /></Tabs.Content>
        <Tabs.Content value="entries" className="mt-3"><EntryTable data={data.entries} currency={displayCurrency} onVoid={setVoidEntry} /></Tabs.Content>
      </Tabs.Root>

      <FeeDialog server={feeServer} onOpenChange={(open) => !open && setFeeServer(null)} onSaved={async () => { setFeeServer(null); await refresh(); }} saving={saving} setSaving={setSaving} />
      <TrafficDialog server={trafficServer} onOpenChange={(open) => !open && setTrafficServer(null)} />
      <VoidDialog entry={voidEntry} onOpenChange={(open) => !open && setVoidEntry(null)} onSaved={async () => { setVoidEntry(null); await refresh(); }} saving={saving} setSaving={setSaving} />
    </div>
  );
}

function ServerTable({ servers, currency, onAddFee, onTraffic }: { servers: BillingServer[]; currency: BillingCurrency; onAddFee: (server: BillingServer) => void; onTraffic: (server: BillingServer) => void }) {
  const { t } = useTranslation();
  return <section className="overflow-x-auto rounded-md border bg-[var(--color-panel-solid)]"><Table><TableHeader><TableRow><TableHead>{t("common.server", "服务器")}</TableHead><TableHead>{t("billing.price", "资费")}</TableHead><TableHead>{t("billing.month", "本月")}</TableHead><TableHead>{t("billing.expiry", "到期")}</TableHead><TableHead>{t("billing.remaining", "剩余价值")}</TableHead><TableHead className="w-[96px]" /></TableRow></TableHeader><TableBody>{servers.map((server) => <TableRow key={server.client}><TableCell><div className="font-medium">{server.name || server.client}</div><div className="text-xs text-muted-foreground">{server.region || server.group || server.client}</div></TableCell><TableCell>{statusBadge(server, t(`billing.status_${server.billing_status}`, server.billing_status === "recurring" ? "周期付费" : server.billing_status === "one_time" ? "一次性购买" : server.billing_status === "free" ? "免费" : "未配置"))}<div className="mt-1 text-xs">{formatBillingMoney(server.original_amount, server.original_currency)}</div></TableCell><TableCell>{formatBillingMoney(server.month_total, currency)}</TableCell><TableCell>{billingDate(server.expired_at)}<div className="text-xs text-muted-foreground">{server.remaining_days == null ? "-" : `${server.remaining_days} d`}</div></TableCell><TableCell>{formatBillingMoney(server.remaining_value, currency)}</TableCell><TableCell><div className="flex items-center gap-1"><Button variant="ghost" title={t("billing.traffic_30d", "最近 30 天流量")} onClick={() => onTraffic(server)}><Activity size={16} /></Button><Button variant="ghost" title={t("billing.add_fee", "记录一次性费用")} onClick={() => onAddFee(server)}><Plus size={16} /></Button></div></TableCell></TableRow>)}</TableBody></Table></section>;
}

type DailyTrafficResponse = { client: string; name: string; timezone: string; days: Array<{ day: string; up: number; down: number; billable: number }> };

function TrafficDialog({ server, onOpenChange }: { server: BillingServer | null; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const [data, setData] = React.useState<DailyTrafficResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!server) return;
    let active = true;
    setData(null);
    setError(null);
    void billingRequest<DailyTrafficResponse>(`/api/admin/client/${server.client}/traffic/daily?days=30`).then((result) => {
      if (active) setData(result);
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => { active = false; };
  }, [server]);
  return <Dialog.Root open={Boolean(server)} onOpenChange={onOpenChange}><Dialog.Content maxWidth="860px"><Dialog.Title>{server?.name || server?.client}</Dialog.Title><Dialog.Description>{t("billing.traffic_30d", "最近 30 天每日上行、下行和计费流量")}</Dialog.Description>{error ? <Callout.Root className="mt-4" color="red"><Callout.Text>{error}</Callout.Text></Callout.Root> : null}{!data && !error ? <Skeleton className="mt-4" height="280px" /> : null}{data ? <div className="mt-4 h-[300px]"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={data.days}><CartesianGrid vertical={false} /><XAxis dataKey="day" tickFormatter={(value) => String(value).slice(5)} interval="preserveStartEnd" /><YAxis width={72} tickFormatter={(value) => formatBytes(Number(value))} /><Tooltip formatter={(value) => formatBytes(Number(value))} /><Legend /><Bar dataKey="up" name={t("admin_dashboard.upload", "上传")} stackId="traffic" fill="var(--accent-9)" /><Bar dataKey="down" name={t("admin_dashboard.download", "下载")} stackId="traffic" fill="var(--orange-9)" /><Line dataKey="billable" name={t("billing.billable", "计费流量")} type="monotone" stroke="var(--red-9)" strokeWidth={2} dot={false} /></ComposedChart></ResponsiveContainer></div> : null}<div className="mt-4 flex justify-end"><Dialog.Close><Button variant="soft">{t("common.close", "关闭")}</Button></Dialog.Close></div></Dialog.Content></Dialog.Root>;
}

function PeriodTable({ data, currency, averageLabel, average }: { data?: BillingPeriodPage; currency: BillingCurrency; averageLabel: string; average?: string }) {
  const { t } = useTranslation();
  return <section className="rounded-md border bg-[var(--color-panel-solid)]"><div className="flex flex-wrap items-baseline justify-between gap-2 border-b px-3 py-2"><span className="text-sm text-muted-foreground">{averageLabel}</span><span className="font-semibold tabular-nums">{formatBillingMoney(average, currency)}</span></div><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>{t("billing.period", "周期")}</TableHead><TableHead>{t("billing.base", "基础费用")}</TableHead><TableHead>{t("billing.extra", "附加费用")}</TableHead><TableHead>{t("billing.one_time", "一次性费用")}</TableHead><TableHead>{t("billing.total", "合计")}</TableHead></TableRow></TableHeader><TableBody>{(data?.items ?? []).map((item) => <TableRow key={item.period}><TableCell className="font-medium">{item.period}</TableCell><TableCell>{formatBillingMoney(item.base, currency)}</TableCell><TableCell>{formatBillingMoney(String(Number(item.extra) + Number(item.other)), currency)}</TableCell><TableCell>{formatBillingMoney(item.one_time, currency)}</TableCell><TableCell className="font-semibold">{formatBillingMoney(item.total, currency)}</TableCell></TableRow>)}</TableBody></Table></div></section>;
}

function EntryTable({ data, currency, onVoid }: { data?: BillingEntryPage; currency: BillingCurrency; onVoid: (entry: BillingEntry) => void }) {
  const { t } = useTranslation();
  return <section className="overflow-x-auto rounded-md border bg-[var(--color-panel-solid)]"><Table><TableHeader><TableRow><TableHead>{t("billing.type", "类型")}</TableHead><TableHead>{t("common.server", "服务器")}</TableHead><TableHead>{t("billing.amount", "金额")}</TableHead><TableHead>{t("billing.time", "入账时间")}</TableHead><TableHead>{t("billing.note", "备注")}</TableHead><TableHead className="w-[72px]" /></TableRow></TableHeader><TableBody>{(data?.items ?? []).map((entry) => <TableRow key={entry.id}><TableCell><Badge color={entry.voided || entry.type === "reversal" ? "red" : entry.type === "adjustment" ? "orange" : "gray"}>{entry.voided ? t("billing.voided", "已作废") : t(`billing.type_${entry.type}`, billingTypeLabel(entry.type))}</Badge></TableCell><TableCell>{entry.client_name || entry.client}</TableCell><TableCell><div>{formatBillingMoney(entry.original_amount, entry.original_currency)}</div>{entry.converted_amount ? <div className="text-xs text-muted-foreground">{formatBillingMoney(entry.converted_amount, currency)}</div> : null}</TableCell><TableCell>{billingDateTime(entry.occurred_at)}</TableCell><TableCell className="max-w-[260px] truncate" title={entry.note}>{entry.note || "-"}</TableCell><TableCell>{entry.voidable ? <Button color="red" variant="ghost" onClick={() => onVoid(entry)}>{t("billing.void", "作废")}</Button> : null}</TableCell></TableRow>)}</TableBody></Table></section>;
}

function FeeDialog({ server, onOpenChange, onSaved, saving, setSaving }: { server: BillingServer | null; onOpenChange: (open: boolean) => void; onSaved: () => Promise<void>; saving: boolean; setSaving: (value: boolean) => void }) {
  const { t } = useTranslation();
  const [amount, setAmount] = React.useState("");
  const [currency, setCurrency] = React.useState("USD");
  const [note, setNote] = React.useState("");
  React.useEffect(() => { if (server) { setAmount(""); setCurrency(server.original_currency || "USD"); setNote(""); } }, [server]);
  const submit = async () => { if (!server || !amount.trim()) return; setSaving(true); try { await billingRequest(`/api/admin/client/${server.client}/billing/one-time`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ amount: amount.trim(), currency, note: note.trim(), idempotency_key: crypto.randomUUID() }) }); resetBillingCache(); await onSaved(); toast.success(t("billing.saved", "费用已记录")); } catch (reason) { toast.error(reason instanceof Error ? reason.message : String(reason)); } finally { setSaving(false); } };
  return <Dialog.Root open={Boolean(server)} onOpenChange={onOpenChange}><Dialog.Content maxWidth="440px"><Dialog.Title>{t("billing.add_fee", "记录一次性费用")}</Dialog.Title><Dialog.Description>{server?.name || server?.client}</Dialog.Description><div className="mt-4 grid grid-cols-[1fr_110px] gap-3"><Input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" placeholder="0.00" /><Input value={currency} onChange={(event) => setCurrency(event.target.value.toUpperCase())} maxLength={3} /></div><Textarea className="mt-3" value={note} onChange={(event) => setNote(event.target.value)} placeholder={t("billing.note", "备注")} /><div className="mt-4 flex justify-end gap-2"><Dialog.Close><Button variant="soft">{t("common.cancel", "取消")}</Button></Dialog.Close><Button onClick={() => void submit()} disabled={saving || !amount.trim()}>{t("common.confirm", "确认")}</Button></div></Dialog.Content></Dialog.Root>;
}

function VoidDialog({ entry, onOpenChange, onSaved, saving, setSaving }: { entry: BillingEntry | null; onOpenChange: (open: boolean) => void; onSaved: () => Promise<void>; saving: boolean; setSaving: (value: boolean) => void }) {
  const { t } = useTranslation();
  const [reason, setReason] = React.useState("");
  React.useEffect(() => { if (entry) setReason(""); }, [entry]);
  const submit = async () => { if (!entry || !reason.trim()) return; setSaving(true); try { await billingRequest(`/api/admin/billing/entries/${entry.id}/void`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: reason.trim() }) }); resetBillingCache(); await onSaved(); toast.success(t("billing.voided", "费用已作废并生成等额冲销记录")); } catch (reason) { toast.error(reason instanceof Error ? reason.message : String(reason)); } finally { setSaving(false); } };
  return <Dialog.Root open={Boolean(entry)} onOpenChange={onOpenChange}><Dialog.Content maxWidth="420px"><Dialog.Title>{t("billing.void", "作废费用")}</Dialog.Title><Dialog.Description>{t("billing.void_description", "系统会写入一条等额冲销记录，原记录保持不变。")}</Dialog.Description><Textarea className="mt-4" value={reason} onChange={(event) => setReason(event.target.value)} placeholder={t("billing.void_reason", "作废原因")} /><div className="mt-4 flex justify-end gap-2"><Dialog.Close><Button variant="soft">{t("common.cancel", "取消")}</Button></Dialog.Close><Button color="red" onClick={() => void submit()} disabled={saving || !reason.trim()}>{t("billing.void", "确认作废")}</Button></div></Dialog.Content></Dialog.Root>;
}
