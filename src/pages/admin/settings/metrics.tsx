import { Selector } from "@/components/Selector";
import { DatabaseMaintenanceCard } from "@/components/admin/DatabaseMaintenanceCard";
import { DownsamplingCard } from "@/components/admin/DownsamplingCard";
import {
  SettingCard,
  SettingCardLabel,
  SettingCardSwitch,
} from "@/components/admin/SettingCard";
import Loading from "@/components/loading";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useRPC2Call } from "@/contexts/RPC2Context";
import { updateSettingsWithToast, useSettings } from "@/lib/api";
import { resolveI18nText, type I18nText } from "@/utils/i18nText";
import {
  Badge,
  Button,
  Callout,
  Dialog,
  Flex,
  Text,
  TextField,
} from "@radix-ui/themes";
import { AlertTriangle, ListChecks, RefreshCw, Save } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

interface MetricDefinition {
  name: string;
  description?: I18nText | null;
  type: string;
  unit?: string;
  retention_days: number;
  metadata?: Record<string, string>;
}

type MetricRetentionChange = {
  name: string;
  retention_days: number;
};

type MetricTextField = "name" | "description";
type TranslationFunction = ReturnType<typeof useTranslation>["t"];

const DEFAULT_RETENTION_DAYS = 1;

function toNumber(value: unknown, fallback: number): number {
  const parsed =
    typeof value === "number" ? value : parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isI18nTextDict(value: unknown): value is Record<string, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((item) => typeof item === "string")
  );
}

function parseI18nText(value: unknown): I18nText | undefined {
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return undefined;
    try {
      const parsed = JSON.parse(text);
      if (isI18nTextDict(parsed)) return parsed;
    } catch {
      // Plain strings are valid metric descriptions.
    }
    return value;
  }
  if (isI18nTextDict(value)) return value;
  return undefined;
}

function metadataText(
  metadata: Record<string, string> | undefined,
  keys: string[],
): I18nText | undefined {
  if (!metadata) return undefined;
  for (const key of keys) {
    const value = parseI18nText(metadata[key]);
    if (value) return value;
  }
  return undefined;
}

function systemMetricText(
  t: TranslationFunction,
  metricName: string,
  field: MetricTextField,
): string | undefined {
  const key = `settings.metrics.system.${metricName}.${field}`;
  const text = t(key, { defaultValue: "" });
  return typeof text === "string" && text ? text : undefined;
}

function metricDisplayName(
  metric: MetricDefinition,
  language: string,
  t: TranslationFunction,
): string {
  const system = systemMetricText(t, metric.name, "name");
  const custom = metadataText(metric.metadata, ["display_name", "name", "title"]);
  return system ?? resolveI18nText(custom, language) ?? metric.name;
}

function metricDescription(
  metric: MetricDefinition,
  language: string,
  t: TranslationFunction,
): string {
  const system = systemMetricText(t, metric.name, "description");
  const custom =
    parseI18nText(metric.description) ??
    metadataText(metric.metadata, ["description", "desc", "help"]);
  return system ?? resolveI18nText(custom, language) ?? "";
}

export default function LTSDatabaseSettings() {
  const { t } = useTranslation();
  const { settings, loading, error } = useSettings();

  if (loading) return <Loading />;
  if (error) return <Text color="red">{error}</Text>;

  return (
    <Flex direction="column" gap="3">
      <SettingCardLabel>{t("settings.database.title")}</SettingCardLabel>
      <SettingCardSwitch
        title={t("settings.lts_database.record_enabled")}
        description={t("settings.lts_database.record_enabled_description")}
        defaultChecked={settings.record_enabled !== false}
        onChange={async (checked) => {
          await updateSettingsWithToast({ record_enabled: checked }, t);
        }}
      />
      <MetricRetentionTable defaultRetentionDays={DEFAULT_RETENTION_DAYS} />
      <DownsamplingCard />
      <DatabaseMaintenanceCard />
    </Flex>
  );
}

function MetricRetentionTable({
  defaultRetentionDays,
}: {
  defaultRetentionDays: number;
}) {
  const { t, i18n } = useTranslation();
  const { call } = useRPC2Call();
  const [metrics, setMetrics] = React.useState<MetricDefinition[]>([]);
  const [drafts, setDrafts] = React.useState<Record<string, string>>({});
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [batchDialogOpen, setBatchDialogOpen] = React.useState(false);
  const [batchMetricNames, setBatchMetricNames] = React.useState<string[]>([]);
  const [batchRetentionDays, setBatchRetentionDays] = React.useState(
    String(defaultRetentionDays),
  );
  const language = i18n.resolvedLanguage || i18n.language;

  const fetchMetrics = React.useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const data = await call<unknown, MetricDefinition[]>(
          "admin:listMetricDefinitions",
          {},
        );
        const list = Array.isArray(data) ? data : [];
        setMetrics(list);
        setDrafts(
          Object.fromEntries(
            list.map((metric) => [
              metric.name,
              String(toNumber(metric.retention_days, defaultRetentionDays)),
            ]),
          ),
        );
        setLoadError(null);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setLoadError(message);
        if (!silent) {
          toast.error(t("settings.metrics.fetch_metrics_failed") + ": " + message);
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [call, defaultRetentionDays, t],
  );

  React.useEffect(() => {
    void fetchMetrics();
  }, [fetchMetrics]);

  const saveRetentionChanges = React.useCallback(
    async (changes: MetricRetentionChange[]) => {
      if (changes.length === 0) return true;
      setSaving(true);
      try {
        const results = await Promise.allSettled(
          changes.map((change) =>
            call<MetricRetentionChange, MetricDefinition>(
              "admin:updateMetricDefinition",
              change,
            ),
          ),
        );
        const successful = new Map<string, MetricDefinition>();
        const errors: string[] = [];
        results.forEach((result, index) => {
          const change = changes[index];
          if (result.status === "fulfilled") {
            successful.set(change.name, {
              ...result.value,
              retention_days: toNumber(
                result.value.retention_days,
                change.retention_days,
              ),
            });
          } else {
            errors.push(
              result.reason instanceof Error
                ? result.reason.message
                : String(result.reason),
            );
          }
        });

        if (successful.size > 0) {
          setMetrics((previous) =>
            previous.map((metric) => {
              const updated = successful.get(metric.name);
              return updated ? { ...metric, ...updated } : metric;
            }),
          );
          setDrafts((previous) => {
            const next = { ...previous };
            for (const [name, metric] of successful) {
              next[name] = String(metric.retention_days);
            }
            return next;
          });
        }

        if (errors.length > 0) {
          toast.error(
            `${t("settings.metrics.retention_save_failed")}: ${errors[0]}`,
          );
          return false;
        }
        toast.success(t("settings.metrics.retention_saved"));
        return true;
      } finally {
        setSaving(false);
      }
    },
    [call, t],
  );

  const handleSaveAll = async () => {
    const changes: MetricRetentionChange[] = [];
    const canonicalDrafts: Record<string, string> = {};
    for (const metric of metrics) {
      const value = drafts[metric.name] ?? String(metric.retention_days);
      const days = parseInt(value, 10);
      if (isNaN(days) || days < 0) {
        toast.error(t("settings.metrics.retention_invalid"));
        return;
      }
      canonicalDrafts[metric.name] = String(days);
      if (days !== metric.retention_days) {
        changes.push({ name: metric.name, retention_days: days });
      }
    }
    setDrafts(canonicalDrafts);
    await saveRetentionChanges(changes);
  };

  const handleBatchSave = async () => {
    if (batchMetricNames.length === 0) {
      toast.error(t("settings.metrics.batch_select_required"));
      return;
    }
    const days = parseInt(batchRetentionDays, 10);
    if (isNaN(days) || days < 0) {
      toast.error(t("settings.metrics.retention_invalid"));
      return;
    }
    setDrafts((previous) => ({
      ...previous,
      ...Object.fromEntries(batchMetricNames.map((name) => [name, String(days)])),
    }));
    const saved = await saveRetentionChanges(
      batchMetricNames.map((name) => ({ name, retention_days: days })),
    );
    if (saved) setBatchDialogOpen(false);
  };

  const hasDraftChanges = metrics.some(
    (metric) =>
      (drafts[metric.name] ?? String(metric.retention_days)) !==
      String(metric.retention_days),
  );

  return (
    <SettingCard
      title={t("settings.metrics.retention_title")}
      description={t("settings.metrics.retention_table_description", {
        days: defaultRetentionDays,
      })}
      direction="column"
    >
      <Flex direction="column" gap="3" className="w-full pt-3">
        <Flex justify="between" align="center" gap="2" wrap="wrap">
          <Dialog.Root open={batchDialogOpen} onOpenChange={setBatchDialogOpen}>
            <Dialog.Trigger>
              <Button
                variant="soft"
                size="1"
                disabled={loading || saving || metrics.length === 0}
                onClick={() => {
                  setBatchMetricNames([]);
                  setBatchRetentionDays(String(defaultRetentionDays));
                }}
              >
                <ListChecks size={14} />
                {t("settings.metrics.batch_edit")}
              </Button>
            </Dialog.Trigger>
            <Dialog.Content maxWidth="640px">
              <Dialog.Title>{t("settings.metrics.batch_title")}</Dialog.Title>
              <Dialog.Description>
                {t("settings.metrics.batch_description")}
              </Dialog.Description>
              <Flex direction="column" gap="3" mt="3">
                <div className="max-h-[50vh] overflow-y-auto pr-1">
                  <Selector
                    value={batchMetricNames}
                    onChange={setBatchMetricNames}
                    items={metrics}
                    getId={(metric) => metric.name}
                    getLabel={(metric) => (
                      <Flex direction="column" gap="1">
                        <Text size="2" weight="medium">
                          {metricDisplayName(metric, language, t)}
                        </Text>
                        <Text size="1" color="gray">
                          {metric.name}
                        </Text>
                      </Flex>
                    )}
                    filterItem={(metric, keyword) => {
                      const normalized = keyword.trim().toLowerCase();
                      return (
                        metric.name.toLowerCase().includes(normalized) ||
                        metricDisplayName(metric, language, t)
                          .toLowerCase()
                          .includes(normalized)
                      );
                    }}
                    sortItems={(left, right) => left.name.localeCompare(right.name)}
                    headerLabel={t("settings.metrics.metric_name")}
                    searchPlaceholder={t(
                      "settings.metrics.batch_search_placeholder",
                    )}
                  />
                </div>
                <label>
                  <Text as="div" size="2" weight="medium" mb="1">
                    {t("settings.metrics.retention_days")}
                  </Text>
                  <TextField.Root
                    type="number"
                    min="0"
                    value={batchRetentionDays}
                    onChange={(event) => setBatchRetentionDays(event.target.value)}
                  />
                </label>
                <Flex justify="end" gap="2">
                  <Button
                    variant="soft"
                    color="gray"
                    disabled={saving}
                    onClick={() => setBatchDialogOpen(false)}
                  >
                    {t("cancel")}
                  </Button>
                  <Button
                    disabled={saving || batchMetricNames.length === 0}
                    onClick={() => void handleBatchSave()}
                  >
                    <Save size={14} />
                    {t("save")}
                  </Button>
                </Flex>
              </Flex>
            </Dialog.Content>
          </Dialog.Root>
          <Button
            variant="ghost"
            size="1"
            disabled={loading || saving}
            onClick={() => void fetchMetrics()}
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            {t("common.refresh")}
          </Button>
        </Flex>

        {loadError && (
          <Callout.Root color="red" variant="surface">
            <Callout.Icon>
              <AlertTriangle size={16} />
            </Callout.Icon>
            <Callout.Text>{loadError}</Callout.Text>
          </Callout.Root>
        )}

        <div className="overflow-x-auto rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-44">
                  {t("settings.metrics.metric_name")}
                </TableHead>
                <TableHead className="min-w-40">
                  {t("settings.metrics.metric_key")}
                </TableHead>
                <TableHead className="min-w-64">
                  {t("settings.metrics.metric_description")}
                </TableHead>
                <TableHead>{t("settings.metrics.metric_type")}</TableHead>
                <TableHead>{t("settings.metrics.metric_unit")}</TableHead>
                <TableHead>{t("settings.metrics.retention_days")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {metrics.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    {loading
                      ? t("settings.metrics.loading_metrics")
                      : t("settings.metrics.no_metrics")}
                  </TableCell>
                </TableRow>
              ) : (
                metrics.map((metric) => {
                  const description = metricDescription(metric, language, t);
                  return (
                    <TableRow key={metric.name}>
                      <TableCell className="min-w-44 whitespace-normal font-medium">
                        {metricDisplayName(metric, language, t)}
                      </TableCell>
                      <TableCell className="min-w-40">
                        <Text size="1" color="gray">
                          {metric.name}
                        </Text>
                      </TableCell>
                      <TableCell className="min-w-64 max-w-96 whitespace-normal">
                        <Text size="2" color="gray">
                          {description || t("common.none")}
                        </Text>
                      </TableCell>
                      <TableCell>
                        <Badge variant="soft">{metric.type}</Badge>
                      </TableCell>
                      <TableCell>{metric.unit || t("common.none")}</TableCell>
                      <TableCell>
                        <TextField.Root
                          type="number"
                          min="0"
                          value={drafts[metric.name] ?? ""}
                          disabled={saving}
                          onChange={(event) =>
                            setDrafts((previous) => ({
                              ...previous,
                              [metric.name]: event.target.value,
                            }))
                          }
                          style={{ width: "7rem" }}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
        <Flex justify="end">
          <Button
            disabled={loading || saving || !hasDraftChanges}
            onClick={() => void handleSaveAll()}
          >
            <Save size={14} />
            {t("settings.metrics.save_changes")}
          </Button>
        </Flex>
      </Flex>
    </SettingCard>
  );
}
