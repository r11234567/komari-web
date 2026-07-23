import { requestAdminData } from "@/lib/adminApi";
import { formatBytes } from "@/utils/unitHelper";
import { Button, Dialog, Flex, Text } from "@radix-ui/themes";
import { DatabaseZap, RefreshCw } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { SettingCard } from "./SettingCard";

type DatabaseOverview = {
  type: string;
  size: number;
};

type MaintenanceResult = {
  before: number;
  after: number;
  size: number;
};

function isDatabaseOverview(value: unknown): value is DatabaseOverview {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<DatabaseOverview>;
  return typeof candidate.type === "string" && typeof candidate.size === "number";
}
export function DatabaseMaintenanceCard() {
  const { t } = useTranslation();
  const [overview, setOverview] = React.useState<DatabaseOverview | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [maintaining, setMaintaining] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  const fetchOverview = React.useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await requestAdminData<unknown>(
        "/api/admin/database/size",
        t("settings.database.load_error"),
      );
      if (!isDatabaseOverview(data)) {
        throw new Error(t("settings.database.invalid_response"));
      }
      setOverview(data);
    } catch (error) {
      setOverview(null);
      setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, [t]);

  React.useEffect(() => {
    void fetchOverview();
  }, [fetchOverview]);

  const handleMaintenance = async () => {
    if (!overview || overview.type.toLowerCase() !== "sqlite" || maintaining) return;
    setConfirmOpen(false);
    setMaintaining(true);
    try {
      const result = await requestAdminData<MaintenanceResult>(
        "/api/admin/database/vacuum",
        t("settings.database.maintenance_error"),
        { method: "POST" },
      );
      toast.success(t("settings.database.maintenance_success"), {
        description: `${formatBytes(result.before)} -> ${formatBytes(result.after)}`,
      });
    } catch (error) {
      toast.error(t("settings.database.maintenance_error"), {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setMaintaining(false);
      await fetchOverview();
    }
  };

  const isSQLite = overview?.type.toLowerCase() === "sqlite";

  return (
    <SettingCard
      title={t("settings.database.maintenance_title")}
      description={t("settings.database.maintenance_description")}
    >
      <Flex direction="column" className="w-full pt-2" gap="3">
        {overview ? (
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-[var(--gray-a5)] py-3">
            <div className="min-w-0">
              <Text as="div" size="2" weight="medium">
                {t("settings.database.main")}
              </Text>
              <Text as="div" size="1" color="gray">
                {overview.type.toUpperCase()}
              </Text>
            </div>
            <Text size="2" weight="bold" className="whitespace-nowrap">
              {formatBytes(overview.size)}
            </Text>
          </div>
        ) : loading ? (
          <Text size="2" color="gray">{t("loading")}</Text>
        ) : null}

        {loadError ? <Text size="2" color="red">{loadError}</Text> : null}
        {overview && !isSQLite ? (
          <Text size="2" color="gray">
            {t("settings.lts_database.vacuum_sqlite_only")}
          </Text>
        ) : null}

        <Flex justify="end">
          {!overview && loadError ? (
            <Button variant="soft" disabled={loading} onClick={() => void fetchOverview()}>
              <RefreshCw size={16} className={loading ? "animate-spin" : undefined} />
              {t("common.retry")}
            </Button>
          ) : isSQLite ? (
            <Dialog.Root open={confirmOpen} onOpenChange={setConfirmOpen}>
              <Dialog.Trigger>
                <Button variant="solid" color="orange" disabled={loading || maintaining}>
                  <DatabaseZap size={16} />
                  {maintaining
                    ? t("settings.database.maintaining")
                    : t("settings.database.maintenance_button")}
                </Button>
              </Dialog.Trigger>
              <Dialog.Content maxWidth="520px">
                <Dialog.Title>{t("settings.database.confirm_title")}</Dialog.Title>
                <Dialog.Description size="2">
                  {t("settings.database.confirm_description")}
                </Dialog.Description>
                <Flex gap="3" mt="4" justify="end">
                  <Dialog.Close>
                    <Button variant="soft" color="gray">{t("common.cancel")}</Button>
                  </Dialog.Close>
                  <Button color="orange" onClick={() => void handleMaintenance()}>
                    <DatabaseZap size={16} />
                    {t("settings.database.maintenance_button")}
                  </Button>
                </Flex>
              </Dialog.Content>
            </Dialog.Root>
          ) : null}
        </Flex>
      </Flex>
    </SettingCard>
  );
}
