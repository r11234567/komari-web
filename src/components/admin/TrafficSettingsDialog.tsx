import { useEffect, useId, useRef, useState } from "react";
import { Button, Dialog, Flex, IconButton, Text, TextField } from "@radix-ui/themes";
import { Gauge } from "lucide-react";
import { toast } from "sonner";
import { billableUsage, bytesToGB, calibrationTargets, calibrationTotalTarget, countingTypeLabels, trafficRequest, trafficResetPayload } from "@/utils/trafficCalibration";
import type { CalibrationResponse, CalibrationSnapshot, TrafficPolicy } from "@/utils/trafficCalibration";

const utcOffsets = [...Array.from({ length: 27 }, (_, i) => {
  const hour = i - 12;
  return hour === 0 ? "UTC" : `UTC${hour < 0 ? "-" : "+"}${String(Math.abs(hour)).padStart(2, "0")}:00`;
}), "UTC-09:30", "UTC-03:30", "UTC+03:30", "UTC+04:30", "UTC+05:30", "UTC+05:45", "UTC+06:30", "UTC+08:45", "UTC+09:30", "UTC+10:30", "UTC+12:45", "Asia/Shanghai"];

export function TrafficSettingsDialog({ uuid, name }: { uuid: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [day, setDay] = useState("follow");
  const [clock, setClock] = useState("00:00:00");
  const [timezone, setTimezone] = useState("Asia/Shanghai");
  const [nextReset, setNextReset] = useState("");
  const [calibration, setCalibration] = useState<CalibrationResponse | null>(null);
  const [up, setUp] = useState("");
  const [down, setDown] = useState("");
  const [total, setTotal] = useState("");
  const [entryMode, setEntryMode] = useState("total");
  const [reason, setReason] = useState("");
  const controller = useRef<AbortController | null>(null);
  const listId = useId();
  const path = `/api/admin/client/${encodeURIComponent(uuid)}`;

  function acceptCalibration(value: CalibrationResponse) {
    setCalibration(value);
    if (value.snapshot) {
      setUp(bytesToGB(value.snapshot.effective.up));
      setDown(bytesToGB(value.snapshot.effective.down));
      setTotal(bytesToGB(billableUsage(value.snapshot.effective, value.counting_type || "max")));
      setEntryMode(value.snapshot.history[0]?.mode?.startsWith("total:") || !value.snapshot.history.length ? "total" : "directions");
    }
  }

  useEffect(() => {
    if (!open) return;
    const abort = new AbortController();
    controller.current = abort;
    setLoading(true);
    setError("");
    setCalibration(null);
    setReason("");
    void Promise.all([
      trafficRequest<TrafficPolicy>(`${path}/traffic-policy`, abort.signal),
      trafficRequest<CalibrationResponse>(`${path}/traffic-calibration`, abort.signal),
    ]).then(([policy, snapshot]) => {
      if (abort.signal.aborted) return;
      setDay(policy.traffic_reset_day == null ? "follow" : String(policy.traffic_reset_day));
      setClock(policy.traffic_reset_time);
      setTimezone(policy.traffic_reset_timezone);
      setNextReset(policy.next_reset);
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
      await trafficRequest(`${path}/edit`, abort.signal, trafficResetPayload(day, clock, timezone));
      const [policy, snapshot] = await Promise.all([
        trafficRequest<TrafficPolicy>(`${path}/traffic-policy`, abort.signal),
        trafficRequest<CalibrationResponse>(`${path}/traffic-calibration`, abort.signal),
      ]);
      if (abort.signal.aborted) return;
      setNextReset(policy.next_reset);
      acceptCalibration(snapshot);
      toast.success("流量重置设置已保存");
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
      const result = await trafficRequest<CalibrationResponse>(`${path}/traffic-calibration`, abort.signal, { ...values, note: reason.trim(), cycle: snapshot.cycle });
      if (abort.signal.aborted) return;
      acceptCalibration(result);
      toast.success("已按提供商本期已用流量校准");
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
            <select aria-label="每月重置日" className="mt-1 block w-full rounded border bg-transparent p-2" value={day} onChange={(e) => setDay(e.target.value)}>
              <option value="follow">跟随原有 Agent 设置</option><option value="0">不设置月度重置</option>
              {Array.from({ length: 31 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1} 日</option>)}
            </select>
          </label>
          <label className="text-sm">重置时分<TextField.Root aria-label="重置时分" className="mt-1" type="time" step={60} value={clock} onChange={(e) => setClock(e.target.value)} /></label>
          <label className="text-sm">UTC 偏移 / 时区<TextField.Root aria-label="UTC 偏移或时区" className="mt-1" list={listId} value={timezone} onChange={(e) => setTimezone(e.target.value)} /><datalist id={listId}>{utcOffsets.map((zone) => <option key={zone} value={zone} />)}</datalist></label>
        </div>
        <Text as="p" size="2" color="gray">不足指定日期的月份按月末重置。UTC 偏移不随夏令时变化；原配置默认为 UTC+8 的 00:00。</Text>
        {nextReset && <Text as="p" size="2">下次重置：{nextReset}</Text>}
        <Button onClick={() => void savePolicy()}>保存重置设置</Button>
      </fieldset>
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
          <table className="w-full text-right text-sm"><thead><tr><th className="text-left">GB</th><th>上传</th><th>下载</th><th>计费用量</th></tr></thead><tbody>
            <UsageRow title="探针可用原始本期" value={snapshot.raw} billable={billableUsage(snapshot.raw, countingType)} />
            <UsageRow title="补偿值" value={snapshot.adjustment} billable={billableUsage(snapshot.effective, countingType) - billableUsage(snapshot.raw, countingType)} />
            <UsageRow title="校准后本期" value={snapshot.effective} billable={billableUsage(snapshot.effective, countingType)} />
          </tbody></table>
          {allocatedDirections && <Text as="p" size="2" color="gray">当前按提供商总量校准，上下行校准值是记账分配，不能视为提供商分别测得的上下行流量。</Text>}
          <label className="block text-sm">校准方式
            <select aria-label="流量校准方式" className="mt-1 block w-full rounded border bg-transparent p-2" value={entryMode} onChange={(e) => setEntryMode(e.target.value)}>
              <option value="total">输入提供商本期已用总量</option><option value="directions">上传、下载分别校准</option>
            </select>
          </label>
          {entryMode === "total" ? <>
            <label className="block text-sm">提供商本期计费已用总量（GB）<TextField.Root aria-label="提供商本期总量 GB" value={total} inputMode="decimal" onChange={(e) => setTotal(e.target.value)} /></label>
            <Text as="p" size="2" color="gray">按“{countingTypeLabels[countingType]}”固定本期总量补偿，后续真实流量继续累计。合计按当前上下行比例分配；其他口径优先保留非计费方向，必要时调整以匹配总量。</Text>
          </> : <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="text-sm">提供商本期上传（GB）<TextField.Root aria-label="提供商本期上传 GB" value={up} inputMode="decimal" onChange={(e) => setUp(e.target.value)} /></label>
            <label className="text-sm">提供商本期下载（GB）<TextField.Root aria-label="提供商本期下载 GB" value={down} inputMode="decimal" onChange={(e) => setDown(e.target.value)} /></label>
          </div>}
          <label className="block text-sm">校准说明（可选）<TextField.Root value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} /></label>
          <Button onClick={() => void saveCalibration()}>按提供商用量校准</Button>
          {!!snapshot.history?.length && <details><summary className="cursor-pointer text-sm">最近校准记录</summary><ul className="space-y-2 pt-2 text-sm">{snapshot.history.map((item) => <li key={item.calibration_id}>{item.created_at} · {item.target_total != null ? `总量 ${bytesToGB(item.target_total)} GB（${item.mode?.slice(6)}），总量补偿 ${bytesToGB(item.billable_offset || 0)} GB` : `上传 ${bytesToGB(item.target.up)} GB / 下载 ${bytesToGB(item.target.down)} GB`} · 操作人 {item.operator || "管理员"}</li>)}</ul></details>}
        </>}
      </fieldset>
      <Flex justify="end" mt="4"><Dialog.Close><Button variant="soft">关闭</Button></Dialog.Close></Flex>
    </Dialog.Content>
  </Dialog.Root>;
}

function UsageRow({ title, value, billable }: { title: string; value: CalibrationSnapshot["raw"]; billable: number }) {
  return <tr><td className="py-1 text-left">{title}</td><td>{bytesToGB(value.up)}</td><td>{bytesToGB(value.down)}</td><td>{bytesToGB(billable)}</td></tr>;
}
