import React from "react";
import { toast } from "sonner";

/**
 * API utility functions for settings management
 */

export interface SettingsResponse {
  sitename: string;
  description: string;
  cors_origin_check_enabled: boolean;
  rate_limit_enabled?: boolean;
  geo_ip_enabled: boolean;
  geo_ip_provider: string;
  o_auth_provider: string;
  o_auth_enabled: boolean;
  custom_head: string;
  metric_rollup_minute_retention_minutes?: number;
  metric_rollup_five_minute_retention_minutes?: number;
  metric_rollup_hour_retention_hours?: number;
  CreatedAt: string;
  UpdatedAt: string;
  [key: string]: any;
}

type SettingsRestart = {
  guidePath: string;
};

const migrationGuideStatusPath = "/api/admin/database-migration/auth";
const migrationGuidePollInterval = 500;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function settingsRestartFrom(responseData: unknown): SettingsRestart | undefined {
  if (!isRecord(responseData) || !isRecord(responseData.data)) {
    return undefined;
  }

  const { restart_required: restartRequired, guide_path: guidePath } =
    responseData.data;
  if (
    restartRequired !== true ||
    typeof guidePath !== "string" ||
    !guidePath.startsWith("/") ||
    guidePath.startsWith("//")
  ) {
    return undefined;
  }
  return { guidePath };
}

function waitForMigrationGuide(guidePath: string) {
  let attempts = 0;
  const maxAttempts = 40;
  let delay = migrationGuidePollInterval;

  const check = async () => {
    attempts++;
    try {
      const response = await fetch(migrationGuideStatusPath, {
        cache: "no-store",
      });
      if (response.ok) {
        const payload: unknown = await response.json();
        if (isRecord(payload) && payload.status === "success") {
          window.location.replace(guidePath);
          return;
        }
      }
    } catch {
      // The previous process may still be stopping or the replacement may not be ready.
    }

    if (attempts >= maxAttempts) {
      window.location.replace(guidePath);
      return;
    }

    delay = Math.min(2_000, Math.round(delay * 1.2));
    window.setTimeout(check, delay);
  };

  window.setTimeout(check, delay);
}

/**
 * Fetch settings from the API
 * @returns Promise containing the settings data
 */
export async function getSettings(): Promise<SettingsResponse> {
  try {
    const response = await fetch("/api/admin/settings");

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    const settingsPayload = data["data"];

    if (
      typeof settingsPayload !== "object" ||
      settingsPayload === null ||
      Array.isArray(settingsPayload)
    ) {
      throw new Error("Invalid settings response payload");
    }

    // Remove database metadata fields that are not needed for UI
    const settings = Object.fromEntries(
      Object.entries(settingsPayload).filter(
        ([key]) => !["CreatedAt", "UpdatedAt", "id"].includes(key),
      ),
    );

    return settings as SettingsResponse;
  } catch (error) {
    console.error("Failed to fetch settings:", error);
    throw error;
  }
}

/**
 * Update settings via the API
 * @param settings - The settings object to update
 * @returns Promise containing the response
 */
export async function updateSettings(
  settings: Partial<SettingsResponse>
): Promise<SettingsRestart | undefined> {
  const response = await fetch("/api/admin/settings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(settings),
  });

  if (!response.ok) {
    let message = `HTTP error! status: ${response.status}`;

    try {
      const errorData = await response.json();
      if (errorData?.message) {
        message = String(errorData.message);
      }
    } catch {
      // Keep the fallback HTTP status message.
    }

    console.error("Failed to update settings:", message);
    throw new Error(message);
  }

  let responseData: unknown;
  try {
    responseData = await response.json();
  } catch {
    return undefined;
  }

  const restart = settingsRestartFrom(responseData);
  if (restart) {
    waitForMigrationGuide(restart.guidePath);
  } else {
    cachedSettings = { ...cachedSettings, ...settings };
    notifySettingsListeners();
  }
  return restart;
}
export async function updateSettingsWithToast(
  settings: Partial<SettingsResponse>,
  t: (key: string) => string
): Promise<void> {
  try {
    const restart = await updateSettings(settings);
    if (!restart) {
      toast.success(t("settings.settings_saved"));
    }
  } catch (error) {
    toast.error(t("settings.settings_save_failed") + ": " + error);
    throw error;
  }
}

/**
 * Update a single setting field
 * @param key - The setting key to update
 * @param value - The new value for the setting
 * @param currentSettings - The current settings object (to merge with)
 * @returns Promise containing the response
 */
export async function updateSingleSetting<K extends keyof SettingsResponse>(
  key: K,
  value: SettingsResponse[K]
): Promise<SettingsRestart | undefined> {
  return updateSettings({ [key]: value });
}

const defaultSettings: SettingsResponse = {
  sitename: "",
  description: "",
  cors_origin_check_enabled: true,
  geo_ip_enabled: false,
  geo_ip_provider: "",
  o_auth_provider: "",
  o_auth_enabled: false,
  custom_head: "",
  CreatedAt: "",
  UpdatedAt: "",
};

let cachedSettings: SettingsResponse = { ...defaultSettings };
let isSettingsLoading = true;
let settingsError: string | null = null;
let settingsPromise: Promise<SettingsResponse> | null = null;
const settingsListeners = new Set<() => void>();

function notifySettingsListeners() {
  for (const listener of settingsListeners) {
    listener();
  }
}

export async function reloadGlobalSettings(force = false): Promise<SettingsResponse> {
  if (settingsPromise && !force) {
    return settingsPromise;
  }
  isSettingsLoading = true;
  settingsError = null;
  notifySettingsListeners();

  settingsPromise = getSettings()
    .then((data) => {
      cachedSettings = data;
      isSettingsLoading = false;
      settingsError = null;
      notifySettingsListeners();
      return data;
    })
    .catch((err) => {
      settingsError = err instanceof Error ? err.message : "Failed to fetch settings";
      isSettingsLoading = false;
      notifySettingsListeners();
      throw err;
    })
    .finally(() => {
      settingsPromise = null;
    });

  return settingsPromise;
}

/**
 * Hook for managing settings state and API calls with singleton shared state
 */
export function useSettings() {
  const [, setTick] = React.useState(0);

  React.useEffect(() => {
    const listener = () => setTick((t) => t + 1);
    settingsListeners.add(listener);

    if (isSettingsLoading && !settingsPromise) {
      void reloadGlobalSettings();
    }

    return () => {
      settingsListeners.delete(listener);
    };
  }, []);

  const updateSetting = async <K extends keyof SettingsResponse>(
    key: K,
    value: SettingsResponse[K]
  ) => {
    try {
      const restart = await updateSingleSetting(key, value);
      return restart;
    } catch (err) {
      settingsError =
        err instanceof Error ? err.message : `Failed to update ${String(key)}`;
      notifySettingsListeners();
      throw err;
    }
  };

  const updateMultipleSettings = async (
    newSettings: Partial<SettingsResponse>
  ) => {
    try {
      const restart = await updateSettings(newSettings);
      return restart;
    } catch (err) {
      settingsError =
        err instanceof Error ? err.message : "Failed to update settings";
      notifySettingsListeners();
      throw err;
    }
  };

  return {
    settings: cachedSettings,
    loading: isSettingsLoading,
    error: settingsError,
    updateSetting,
    updateMultipleSettings,
    refetch: () => reloadGlobalSettings(true),
  };
}
