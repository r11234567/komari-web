import { HistoryExportCard } from "@/components/admin/HistoryExportCard";
import { SettingCard, SettingCardLabel } from "@/components/admin/SettingCard";
import { formatBytes } from "@/utils/unitHelper";
import {
  Button,
  Callout,
  Dialog,
  Flex,
  SegmentedControl,
  Text,
} from "@radix-ui/themes";
import {
  AlertTriangle,
  Download,
  Eye,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";

const profileNameSchema = z.enum([
  "cpu",
  "trace",
  "allocs",
  "block",
  "goroutine",
  "heap",
  "mutex",
  "threadcreate",
]);
const endpointSchema = z
  .string()
  .refine((value) => value.startsWith("/api/admin/pprof/"));
const profileSchema = z.object({
  name: profileNameSchema,
  endpoint: endpointSchema,
  samples: z.number().int().nonnegative().optional(),
  timed: z.boolean().optional(),
  preview: endpointSchema.optional(),
});
const summarySchema = z.object({
  status: z.literal("success"),
  data: z.object({
    profiles: z.array(profileSchema),
    runtime: z.object({
      goroutines: z.number().int().nonnegative(),
      memory: z.object({
        heap_alloc: z.number().nonnegative(),
        heap_inuse: z.number().nonnegative(),
        heap_objects: z.number().int().nonnegative(),
        sys: z.number().nonnegative(),
      }),
    }),
    duration: z.object({
      default_seconds: z.number().int().min(1).max(30),
      min_seconds: z.number().int().min(1).max(30),
      max_seconds: z.number().int().min(1).max(30),
    }),
  }),
});

type Profile = z.infer<typeof profileSchema>;
type Summary = z.infer<typeof summarySchema>["data"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function responseError(response: Response, fallback: string) {
  try {
    const payload: unknown = await response.json();
    if (isRecord(payload) && typeof payload.message === "string") {
      return payload.message;
    }
  } catch {
    // Successful responses are binary and error responses may be plain text.
  }
  return `${fallback} (${response.status})`;
}

function downloadURL(profile: Profile, seconds: number) {
  if (!profile.timed) return profile.endpoint;
  const url = new URL(profile.endpoint, window.location.origin);
  url.searchParams.set("seconds", String(seconds));
  return url.pathname + url.search;
}

function OverviewMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 border-b border-[var(--gray-a5)] py-3 last:border-b-0">
      <Text as="div" size="1" color="gray">
        {label}
      </Text>
      <Text as="div" size="3" weight="medium" className="break-words">
        {value}
      </Text>
    </div>
  );
}

export default function PerformanceAnalysisPage() {
  const { t } = useTranslation();
  const [summary, setSummary] = React.useState<Summary | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [captureSeconds, setCaptureSeconds] = React.useState(10);
  const [activeAction, setActiveAction] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState<{
    profile: Profile;
    text: string;
  } | null>(null);

  const loadSummary = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/pprof/summary", {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!response.ok) {
        throw new Error(
          await responseError(response, t("pprof.summary_load_failed")),
        );
      }
      const parsed = summarySchema.safeParse(await response.json());
      if (!parsed.success) throw new Error(t("pprof.invalid_summary"));
      setSummary(parsed.data.data);
      setCaptureSeconds(parsed.data.data.duration.default_seconds);
    } catch (cause) {
      setSummary(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [t]);

  React.useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  const downloadProfile = async (profile: Profile) => {
    setActiveAction(`${profile.name}:download`);
    setError(null);
    try {
      const response = await fetch(downloadURL(profile, captureSeconds), {
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/octet-stream" },
      });
      if (!response.ok) {
        throw new Error(await responseError(response, t("pprof.request_failed")));
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = profile.name === "trace" ? "trace.out" : `${profile.name}.pprof`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setActiveAction(null);
    }
  };

  const previewProfile = async (profile: Profile) => {
    if (!profile.preview) return;
    setActiveAction(`${profile.name}:preview`);
    setError(null);
    try {
      const response = await fetch(profile.preview, {
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "text/plain" },
      });
      if (!response.ok) {
        throw new Error(await responseError(response, t("pprof.request_failed")));
      }
      setPreview({ profile, text: await response.text() });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setActiveAction(null);
    }
  };

  const durationOptions = summary
    ? Array.from(
        new Set([
          summary.duration.min_seconds,
          summary.duration.default_seconds,
          summary.duration.max_seconds,
        ]),
      ).sort((left, right) => left - right)
    : [];
  const busy = activeAction !== null;

  return (
    <Flex direction="column" gap="3" className="km-page-admin-pprof">
      <Flex justify="between" align="center" gap="2" wrap="wrap">
        <SettingCardLabel>{t("pprof.title")}</SettingCardLabel>
        <Button variant="soft" disabled={loading} onClick={() => void loadSummary()}>
          <RefreshCw size={16} className={loading ? "animate-spin" : undefined} />
          {t("common.refresh")}
        </Button>
      </Flex>

      <SettingCardLabel>{t("pprof.local_analysis")}</SettingCardLabel>
      <Callout.Root color="orange" variant="surface">
        <Callout.Icon>
          <AlertTriangle size={16} />
        </Callout.Icon>
        <Callout.Text>{t("pprof.warning")}</Callout.Text>
      </Callout.Root>
      {error ? (
        <Callout.Root color="red" variant="surface">
          <Callout.Icon>
            <AlertTriangle size={16} />
          </Callout.Icon>
          <Callout.Text>{error}</Callout.Text>
        </Callout.Root>
      ) : null}

      <SettingCard
        title={t("pprof.runtime_overview_title")}
        description={t("pprof.runtime_overview_description")}
      >
        {summary ? (
          <div className="grid w-full grid-cols-1 gap-x-6 sm:grid-cols-2 lg:grid-cols-5">
            <OverviewMetric
              label={t("pprof.goroutines")}
              value={summary.runtime.goroutines.toLocaleString()}
            />
            <OverviewMetric
              label={t("pprof.heap_alloc")}
              value={formatBytes(summary.runtime.memory.heap_alloc)}
            />
            <OverviewMetric
              label={t("pprof.heap_inuse")}
              value={formatBytes(summary.runtime.memory.heap_inuse)}
            />
            <OverviewMetric
              label={t("pprof.heap_objects")}
              value={summary.runtime.memory.heap_objects.toLocaleString()}
            />
            <OverviewMetric
              label={t("pprof.runtime_sys")}
              value={formatBytes(summary.runtime.memory.sys)}
            />
          </div>
        ) : (
          <Text size="2" color="gray" className="w-full py-3">
            {loading ? t("loading") : t("pprof.summary_unavailable")}
          </Text>
        )}
      </SettingCard>

      {summary ? (
        <SettingCard
          title={t("pprof.profiles_title")}
          description={t("pprof.profiles_description")}
        >
          <Flex direction="column" gap="3" className="w-full pt-3">
            <SegmentedControl.Root
              value={String(captureSeconds)}
              onValueChange={(value) => setCaptureSeconds(Number(value))}
              size="1"
            >
              {durationOptions.map((seconds) => (
                <SegmentedControl.Item key={seconds} value={String(seconds)}>
                  {t("pprof.duration_option", { seconds })}
                </SegmentedControl.Item>
              ))}
            </SegmentedControl.Root>
            {summary.profiles.map((profile) => {
              const previewing = activeAction === `${profile.name}:preview`;
              const downloading = activeAction === `${profile.name}:download`;
              return (
                <div
                  key={profile.name}
                  className="grid grid-cols-1 gap-3 border-b border-[var(--gray-a5)] py-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                >
                  <div className="min-w-0">
                    <Text as="div" size="2" weight="medium">
                      {t(`pprof.profiles.${profile.name}.title`)}
                    </Text>
                    <Text as="div" size="1" color="gray">
                      {t(`pprof.profiles.${profile.name}.description`)}
                    </Text>
                  </div>
                  <Flex gap="2" wrap="wrap">
                    {profile.preview ? (
                      <Button
                        variant="soft"
                        disabled={busy}
                        onClick={() => void previewProfile(profile)}
                      >
                        {previewing ? (
                          <LoaderCircle size={16} className="animate-spin" />
                        ) : (
                          <Eye size={16} />
                        )}
                        {t("pprof.view")}
                      </Button>
                    ) : null}
                    <Button
                      variant="soft"
                      disabled={busy}
                      onClick={() => void downloadProfile(profile)}
                    >
                      {downloading ? (
                        <LoaderCircle size={16} className="animate-spin" />
                      ) : (
                        <Download size={16} />
                      )}
                      {t("pprof.download")}
                    </Button>
                  </Flex>
                </div>
              );
            })}
          </Flex>
        </SettingCard>
      ) : null}

      <SettingCardLabel>{t("pprof.monitoring_download")}</SettingCardLabel>
      <HistoryExportCard />

      <Dialog.Root
        open={preview !== null}
        onOpenChange={(open) => !open && setPreview(null)}
      >
        <Dialog.Content maxWidth="960px">
          <Dialog.Title>
            {preview
              ? t("pprof.preview_title", {
                  profile: t(`pprof.profiles.${preview.profile.name}.title`),
                })
              : t("pprof.title")}
          </Dialog.Title>
          <Dialog.Description size="2">
            {t("pprof.preview_description")}
          </Dialog.Description>
          <pre className="mt-3 max-h-[65vh] overflow-auto rounded-md border border-[var(--gray-a5)] p-3 text-xs">
            {preview?.text}
          </pre>
          <Flex justify="end" mt="3">
            <Dialog.Close>
              <Button variant="soft" color="gray">
                {t("common.close")}
              </Button>
            </Dialog.Close>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>
    </Flex>
  );
}
