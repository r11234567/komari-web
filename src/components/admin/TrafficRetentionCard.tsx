import { useCallback, useEffect, useState } from "react";
import { Button, Callout, Dialog, TextField } from "@radix-ui/themes";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { useTranslation } from "react-i18next";
import { connectUnary } from "@/api/connect/client";
import { useConnect } from "@/contexts/ConnectContext";
import { evidenceByteLabel } from "@/utils/trafficEvidence";

type Policy = { hourDays: number; incidentHours: number };

export function TrafficRetentionCard() {
  const { t, i18n } = useTranslation();
  const { maintenance } = useConnect();
  const locale = i18n.resolvedLanguage ?? "en";
  const [view, setView] = useState<Awaited<ReturnType<typeof maintenance.getDatabaseStatus>>>();
  const [draft, setDraft] = useState({ days: "", hours: "" });
  const [preview, setPreview] = useState<{ retention: Policy; expected: Policy; hours: bigint; incidents: bigint }>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);

  const load = useCallback(async (signal: AbortSignal) => {
    const result = await connectUnary({ signal }, (signal, timeoutMs) => maintenance.getDatabaseStatus({}, { signal, timeoutMs }));
    if (signal.aborted) return;
    setView(result);
    const current = result.trafficMonitoringRetention;
    if (current) setDraft({ days: String(current.hourDays), hours: String(current.incidentHours) });
  }, [maintenance]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [load]);

  const current = view?.trafficMonitoringRetention;
  const storage = view?.trafficMonitoringStorage;
  const desired = { hourDays: Number(draft.days), incidentHours: Number(draft.hours) };
  const valid = Number.isInteger(desired.hourDays) && desired.hourDays >= 1 && desired.hourDays <= 30 &&
    Number.isInteger(desired.incidentHours) && desired.incidentHours >= 1 && desired.incidentHours <= 720;
  const changed = !!current && (desired.hourDays !== current.hourDays || desired.incidentHours !== current.incidentHours);

  async function update(retention: Policy, expected: Policy, dryRun: boolean) {
    setBusy(true);
    setError(false);
    setMessage("");
    const signal = new AbortController().signal;
    try {
      const res = await connectUnary({ signal }, (signal, timeoutMs) =>
        maintenance.updateTrafficMonitoringRetention({ retention, expected, preview: dryRun }, { signal, timeoutMs }),
      );
      if (dryRun) {
        setPreview({ retention, expected, hours: res.hoursToDelete, incidents: res.incidentsToDelete });
      } else {
        setPreview(undefined);
        await load(signal);
        setMessage(t("settings.settings_saved"));
      }
    } catch {
      setPreview(undefined);
      setError(true);
      await load(signal).catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  return <section className="space-y-3 rounded-lg border p-4" id="traffic-monitoring-storage">
    <h3 className="font-semibold">{t("trafficEvidence.storage.title")}</h3>
    <p className="text-sm text-muted-foreground">{t("trafficEvidence.storage.description")}</p>
    {error && <Callout.Root color="red"><Callout.Text>{t("trafficEvidence.storage.failed")}</Callout.Text></Callout.Root>}
    {message && <p role="status">{message}</p>}
    {!view && !error && <p role="status">{t("trafficEvidence.loading")}</p>}
    {view && !current && <p>{t("trafficEvidence.storage.unavailable")}</p>}
    {current && <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); if (valid && changed && !busy) void update(desired, current, true); }}>
      <div className="grid max-w-lg gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm">{t("trafficEvidence.storage.hourDays")}
          <TextField.Root type="number" required min="1" max="30" step="1" value={draft.days} disabled={busy}
            onChange={(event) => setDraft((state) => ({ ...state, days: event.target.value }))} />
        </label>
        <label className="grid gap-1 text-sm">{t("trafficEvidence.storage.incidentHours")}
          <TextField.Root type="number" required min="1" max="720" step="1" value={draft.hours} disabled={busy}
            onChange={(event) => setDraft((state) => ({ ...state, hours: event.target.value }))} />
        </label>
      </div>
      {storage && <div className="space-y-1 text-sm">
        <p><code>{storage.path}</code> · {evidenceByteLabel(storage.bytes, locale)}</p>
        {storage.oldestHour && <p>{t("trafficEvidence.storage.oldest", { value: timestampDate(storage.oldestHour).toLocaleString(locale) })}</p>}
        {storage.lastCleanupAt && <p>{t("trafficEvidence.storage.cleaned", { value: timestampDate(storage.lastCleanupAt).toLocaleString(locale) })}</p>}
        {storage.cleanupFailed && <p role="alert" className="text-[var(--red-11)]">{t("trafficEvidence.storage.cleanupFailed")}</p>}
      </div>}
      <Button type="submit" disabled={!valid || !changed || busy}>{t("trafficEvidence.storage.review")}</Button>
    </form>}
    <Dialog.Root open={!!preview} onOpenChange={(open) => { if (!open && !busy) setPreview(undefined); }}>
      {preview && <Dialog.Content maxWidth="32rem">
        <Dialog.Title>{t("trafficEvidence.storage.review")}</Dialog.Title>
        <Dialog.Description>
          {t("trafficEvidence.storage.impact", {
            days: preview.retention.hourDays, hours: preview.retention.incidentHours,
            hourRows: preview.hours.toLocaleString(locale), events: preview.incidents.toLocaleString(locale),
          })}
        </Dialog.Description>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="soft" color="gray" disabled={busy} onClick={() => setPreview(undefined)}>{t("trafficEvidence.close")}</Button>
          <Button disabled={busy} onClick={() => void update(preview.retention, preview.expected, false)}>{t("trafficEvidence.storage.apply")}</Button>
        </div>
      </Dialog.Content>}
    </Dialog.Root>
  </section>;
}
