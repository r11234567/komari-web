import { useEffect, useId, useRef, useState } from "react";
import { Button, Dialog, Flex, IconButton, Select, Text, TextField } from "@radix-ui/themes";
import { Gauge } from "lucide-react";
import { toast } from "sonner";
import { billableUsage, bytesToGB, calibrationTargets, calibrationTotalTarget, countingTypeLabels, localMinute, trafficCutoff, trafficRequest, trafficResetPayload } from "@/utils/trafficCalibration";
import type { CalibrationResponse, CalibrationSnapshot, TrafficPolicy } from "@/utils/trafficCalibration";
import { TRAFFIC_ACCOUNTING_CHANGED } from "@/utils/trafficDisplay";

const utcOffsets = [...Array.from({ length: 27 }, (_, i) => {
  const hour = i - 12;
  return hour === 0 ? "UTC" : `UTC${hour < 0 ? "-" : "+"}${String(Math.abs(hour)).padStart(2, "0")}:00`;
}), "UTC-09:30", "UTC-03:30", "UTC+03:30", "UTC+04:30", "UTC+05:30", "UTC+05:45", "UTC+06:30", "UTC+08:45", "UTC+09:30", "UTC+10:30", "UTC+12:45", "Asia/Shanghai"];

export function TrafficSettingsDialog({ uuid, name }: { uuid: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [day, setDay] = useState("0");
  const [clock, setClock] = useState("00:00:00");
  const [timezone, setTimezone] = useState("Asia/Shanghai");
  const [policy, setPolicy] = useState<TrafficPolicy | null>(null);
  const [calibration, setCalibration] = useState<CalibrationResponse | null>(null);
  const [up, setUp] = useState("");
  const [down, setDown] = useState("");
  const [total, setTotal] = useState("");
  const [entryMode, setEntryMode] = useState("total");
  const [reason, setReason] = useState("");
  const [cutoff, setCutoff] = useState("");
  const controller = useRef<AbortController | null>(null);
  const listId = useId();
  const path = `/api/admin/client/${encodeURIComponent(uuid)}`;

  function acceptCalibration(value: CalibrationResponse) {
    setCalibration(value);
    if (value.snapshot) {
      setUp(value.cutoff_enabled ? "" : bytesToGB(value.snapshot.effective.up));
      setDown(value.cutoff_enabled ? "" : bytesToGB(value.snapshot.effective.down));
      setTotal(value.cutoff_enabled ? "" : bytesToGB(billableUsage(value.snapshot.effective, value.counting_type || "max")));
      setEntryMode(value.snapshot.history[0]?.mode?.startsWith("total:") || !value.snapshot.history.length ? "total" : "directions");
    }
  }

  function acceptPolicy(value: TrafficPolicy) {
    setPolicy(value);
    setDay(String(value.pending?.day ?? value.traffic_reset_day ?? 0));
    setClock(value.pending?.time ?? value.traffic_reset_time);
    setTimezone(value.pending?.timezone ?? value.traffic_reset_timezone);
  }

  useEffect(() => {
    if (!open) return;
    const abort = new AbortController();
    controller.current = abort;
    setLoading(true);
    setError("");
    setCalibration(null);
    setPolicy(null);
    setReason("");
    setCutoff(localMinute(new Date()));
    void Promise.all([
      trafficRequest<TrafficPolicy>(`${path}/traffic-policy`, abort.signal),
      trafficRequest<CalibrationResponse>(`${path}/traffic-calibration`, abort.signal),
    ]).then(([policy, snapshot]) => {
      if (abort.signal.aborted) return;
      acceptPolicy(policy);
      acceptCalibration(snapshot);
    }).catch((err: unknown) => {
      if (!abort.signal.aborted) setError(err instanceof Error ? err.message : String(err));
    }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => { abort.abort(); controller.current = null; };
  }, [open, path]);

  async function savePolicy() {
    const abort = controller.current;
    if (!abort) return;
    setSaving(true);
    setError("");
    try {
      const policyPath = policy?.versioned_policy ? "traffic-policy" : "edit";
      await trafficRequest(`${path}/${policyPath}`, abort.signal, trafficResetPayload(day, clock, timezone));
      const [savedPolicy, snapshot] = await Promise.all([
        trafficRequest<TrafficPolicy>(`${path}/traffic-policy`, abort.signal),
        trafficRequest<CalibrationResponse>(`${path}/traffic-calibration`, abort.signal),
      ]);
      if (abort.signal.aborted) return;
      acceptPolicy(savedPolicy);
      acceptCalibration(snapshot);
      toast.success("流量重置设置已保存");
      window.dispatchEvent(new Event(TRAFFIC_ACCOUNTING_CHANGED));
    } catch (err: unknown) {
      if (!abort.signal.aborted) setError(err instanceof Error ? err.message : String(err));
    } finally { if (!abort.signal.aborted) setSaving(false); }
  }

  async function saveCalibration() {
    const abort = controller.current;
    const snapshot = calibration?.snapshot;
    if (!abort || !snapshot) return;
    setSaving(true);
    setError("");
    try {
      const values = entryMode === "total"
        ? calibrationTotalTarget(snapshot, calibration?.counting_type || "max", total)
        : calibrationTargets(snapshot, up, down);
      const result = await trafficRequest<CalibrationResponse>(`${path}/traffic-calibration`, abort.signal, {
        ...values,
        note: reason.trim(),
        cycle: snapshot.cycle,
        ...(calibration?.cutoff_enabled && { cutoff: trafficCutoff(cutoff) }),
      });
      if (abort.signal.aborted) return;
      acceptCalibration(result);
      toast.success("已按提供商本期已用流量校准");
      window.dispatchEvent(new Event(TRAFFIC_ACCOUNTING_CHANGED));
    } catch (err: unknown) {
      if (!abort.signal.aborted) setError(err instanceof Error ? err.message : String(err));
    } finally { if (!abort.signal.aborted) setSaving(false); }
  }

  const snapshot = calibration?.snapshot;
  const countingType = calibration?.counting_type || "max";
  const allocatedDirections = snapshot?.history[0]?.mode?.startsWith("total:") && !snapshot.calibration_warning;
  return <Dialog.Root open={open} onOpenChange={setOpen}>
    <Dialog.Trigger><IconButton variant="ghost" title="流量重置与校准" aria-label="流量重置与校准"><Gauge size="18" /></IconButton></Dialog.Trigger>
    <Dialog.Content maxWidth="760px">
      <Dialog.Title>{name} · 流量重置与校准</Dialog.Title>
      <Dialog.Description>按提供商账单设置月度周期，校准值与探针原始记录分别保留。</Dialog.Description>
      {loading && <Text as="p" size="2" role="status" mt="3">正在读取流量设置…</Text>}
      {error && <Text as="p" color="red" role="alert" mt="3">{error}</Text>}
      <fieldset disabled={loading || saving || !!error && !calibration} className="mt-4 space-y-4">
        <legend className="font-semibold">每月流量重置</legend>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="text-sm">每月哪一天
            <Select.Root value={day} disabled={loading || saving || !!error && !calibration} onValueChange={setDay}>
              <Select.Trigger aria-label="每月重置日" mt="1" style={{ width: "100%" }} />
              <Select.Content position="popper">
                <Select.Item value="0">不设置月度重置</Select.Item>
                <Select.Separator />
                {Array.from({ length: 31 }, (_, i) => <Select.Item key={i + 1} value={String(i + 1)}>{i + 1} 日</Select.Item>)}
              </Select.Content>
            </Select.Root>
          </label>
          <label className="text-sm">重置时分<TextField.Root aria-label="重置时分" className="mt-1" type="time" step={60} value={clock} onChange={(e) => setClock(e.target.value)} /></label>
          <label className="text-sm">UTC 偏移 / 时区<TextField.Root aria-label="UTC 偏移或时区" className="mt-1" list={listId} value={timezone} onChange={(e) => setTimezone(e.target.value)} /><datalist id={listId}>{utcOffsets.map((zone) => <option key={zone} value={zone} />)}</datalist></label>
        </div>
        <Text as="p" size="2" color="gray">不足指定日期的月份按月末重置。UTC 偏移不随夏令时变化；原配置默认为 UTC+8 的 00:00。</Text>
        {policy?.next_reset && <Text as="p" size="2">下次重置 {displayTime(policy.next_reset)}</Text>}
        {policy?.pending && <Text as="p" size="2">新设置于 {displayTime(policy.pending.effective_at)} 生效</Text>}
        <Button onClick={() => void savePolicy()}>保存重置设置</Button>
      </fieldset>
      {policy?.versioned_policy && <div className="mt-4 space-y-1">
        <Text as="p" size="2">采样接收至 {displayTime(policy.received_through)} · 入账至 {displayTime(policy.accounted_through)}</Text>
        {!!policy.gaps?.length && <details>
          <summary className="cursor-pointer text-sm">最近估算与缺口</summary>
          <ul className="space-y-1 pt-2 text-sm">
            {policy.gaps.map((gap) => <li key={gap.end}>
              {displayTime(gap.start)} 至 {displayTime(gap.end)} · {gap.kind === "unallocated"
                ? `待归属，上传 ${bytesToGB(gap.up_bytes)} GB、下载 ${bytesToGB(gap.down_bytes)} GB`
                : gap.kind === "estimated" ? "跨账期按时间估算" : gap.kind === "long_interval" ? "长采样间隔" : "采样缺口"}
            </li>)}
          </ul>
        </details>}
      </div>}
      <hr className="my-5" />
      <fieldset disabled={loading || saving || !snapshot} className="space-y-3">
        <legend className="font-semibold">本期流量校准（GB）</legend>
        <Text as="p" size="2" color="gray">输入提供商控制面板的真实本期已用流量。1 GB = 1,000,000,000 字节，最多两位小数；支持正负补偿，下期自动失效。</Text>
        {calibration && !calibration.available && <Text as="p" size="2">{calibration.reason || "请先保存月度重置设置"}</Text>}
        {snapshot && <>
          <Text as="p" size="2">当前周期：{snapshot.cycle_start} 至 {snapshot.cycle_end}</Text>
          {snapshot.history_complete === false && <Text as="p" color="orange" size="2">本期部分历史已超过保留期，无法完整还原。请按提供商真实数值校准，建立本期基准。</Text>}
          {snapshot.calibration_warning && <Text as="p" color="orange" size="2">{snapshot.calibration_warning}</Text>}
          <Text as="p" size="2">节点计费口径：{countingTypeLabels[countingType]}</Text>
          {calibration?.cutoff_enabled && <label className="block text-sm">供应商用量截至（本地时间）
            <TextField.Root type="datetime-local" step={60} value={cutoff} max={localMinute(new Date())} onChange={(event) => setCutoff(event.target.value)} />
            <Text as="span" color="gray" size="2">可选本账期内最近 24 小时的时刻。</Text>
          </label>}
          <table className="w-full text-right text-sm"><thead><tr><th className="text-left">GB</th><th>上传</th><th>下载</th><th>计费用量</th></tr></thead><tbody>
            <UsageRow title="探针可用原始本期" value={snapshot.raw} billable={billableUsage(snapshot.raw, countingType)} />
            <UsageRow title="补偿值" value={snapshot.adjustment} billable={billableUsage(snapshot.effective, countingType) - billableUsage(snapshot.raw, countingType)} />
            <UsageRow title="校准后本期" value={snapshot.effective} billable={billableUsage(snapshot.effective, countingType)} />
          </tbody></table>
          {allocatedDirections && <Text as="p" size="2" color="gray">当前按提供商总量校准，上下行校准值是记账分配，不能视为提供商分别测得的上下行流量。</Text>}
          <label className="block text-sm">校准方式
            <Select.Root value={entryMode} disabled={loading || saving || !snapshot} onValueChange={setEntryMode}>
              <Select.Trigger aria-label="流量校准方式" mt="1" style={{ width: "100%" }} />
              <Select.Content position="popper">
                <Select.Item value="total">输入提供商本期已用总量</Select.Item>
                <Select.Item value="directions">上传、下载分别校准</Select.Item>
              </Select.Content>
            </Select.Root>
          </label>
          {entryMode === "total" ? <>
            <label className="block text-sm">提供商本期计费已用总量（GB）<TextField.Root aria-label="提供商本期总量 GB" value={total} inputMode="decimal" onChange={(e) => setTotal(e.target.value)} /></label>
            <Text as="p" size="2" color="gray">按“{countingTypeLabels[countingType]}”计算截点后的净增长，加到供应商用量上。</Text>
          </> : <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="text-sm">提供商本期上传（GB）<TextField.Root aria-label="提供商本期上传 GB" value={up} inputMode="decimal" onChange={(e) => setUp(e.target.value)} /></label>
            <label className="text-sm">提供商本期下载（GB）<TextField.Root aria-label="提供商本期下载 GB" value={down} inputMode="decimal" onChange={(e) => setDown(e.target.value)} /></label>
          </div>}
          <label className="block text-sm">校准说明（可选）<TextField.Root value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} /></label>
          <Button onClick={() => void saveCalibration()}>按提供商用量校准</Button>
          {!!snapshot.history?.length && <details><summary className="cursor-pointer text-sm">最近校准记录</summary><ul className="space-y-2 pt-2 text-sm">{snapshot.history.map((item) => <li key={item.calibration_id}>{displayTime(item.created_at)}{item.cutoff && ` · 截至 ${displayTime(item.cutoff)}`} · {item.target_total != null ? `总量 ${bytesToGB(item.target_total)} GB（${item.mode?.slice(6)}）` : `上传 ${bytesToGB(item.target.up)} GB / 下载 ${bytesToGB(item.target.down)} GB`} · 操作人 {item.operator || "管理员"}{item.note && ` · ${item.note}`}</li>)}</ul></details>}
        </>}
      </fieldset>
      <Flex justify="end" mt="4"><Dialog.Close><Button variant="soft">关闭</Button></Dialog.Close></Flex>
    </Dialog.Content>
  </Dialog.Root>;
}

function displayTime(value?: string) {
  return value ? new Date(value).toLocaleString() : "暂无";
}

function UsageRow({ title, value, billable }: { title: string; value: CalibrationSnapshot["raw"]; billable: number }) {
  return <tr><td className="py-1 text-left">{title}</td><td>{bytesToGB(value.up)}</td><td>{bytesToGB(value.down)}</td><td>{bytesToGB(billable)}</td></tr>;
}
