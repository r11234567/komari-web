import React from "react";
import defaultTheme from "../../komari-theme.json";
import { connectUnary } from "../api/connect/client";
import { useConnect } from "./ConnectContext";

type ThemeField = {
  key?: string;
  default?: unknown;
};

const defaultThemeSettings = Object.fromEntries(
  (
    (defaultTheme.configuration?.data ?? []) as ThemeField[]
  )
    .filter(
      (field) =>
        typeof field.key === "string" &&
        Object.prototype.hasOwnProperty.call(field, "default"),
    )
    .map((field) => [field.key, field.default]),
);

const withThemeDefaults = (publicInfo: PublicInfo): PublicInfo => {
  if (publicInfo.theme !== "default") {
    return publicInfo;
  }

  return {
    ...publicInfo,
    theme_settings: {
      ...defaultThemeSettings,
      ...(publicInfo.theme_settings ?? {}),
    },
  };
};

export interface PublicInfo {
  cors_origin_check_enabled: boolean;
  custom_body: string;
  custom_head: string;
  description: string;
  disable_password_login: boolean;
  oauth_provider: string;
  oauth_enable: boolean;
  metric_retention_days: number;
  sitename: string;
  private_site: boolean;
  theme: string;
  theme_settings: any;
  [property: string]: any;
}

interface PublicInfoContextType {
  publicInfo: PublicInfo | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const PublicInfoContext = React.createContext<PublicInfoContextType | undefined>(
  undefined
);

export const PublicInfoProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [publicInfo, setPublicInfo] = React.useState<PublicInfo | null>(null);
  const [isLoading, setIsLoading] = React.useState<boolean>(false);
  const [error, setError] = React.useState<string | null>(null);
  const { browser } = useConnect();
  const activeRequest = React.useRef<AbortController | null>(null);

  const refresh = React.useCallback(async () => {
    activeRequest.current?.abort(new DOMException("Superseded", "AbortError"));
    const controller = new AbortController();
    activeRequest.current = controller;
    setError(null);
    setIsLoading(true);
    try {
      const response = await connectUnary(
        { signal: controller.signal },
        (signal, timeoutMs) => browser.getPublicInfo({}, { signal, timeoutMs }),
      );
      const info: PublicInfo = {
          cors_origin_check_enabled: response.corsOriginCheckEnabled,
          custom_body: response.customBody,
          custom_head: response.customHead,
          description: response.siteDescription,
          disable_password_login: response.disablePasswordLogin,
          oauth_provider: response.oauthProvider,
          oauth_enable: response.oauthEnabled,
          metric_retention_days: response.metricRetentionDays,
          sitename: response.siteName,
          private_site: response.privateSite,
          theme: response.defaultTheme,
          theme_settings: response.themeSettings ?? {},
          visitor_audit_enabled: response.visitorAuditEnabled,
          version: response.version,
      };
      if (!controller.signal.aborted) setPublicInfo(withThemeDefaults(info));
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (activeRequest.current === controller) {
        activeRequest.current = null;
        setIsLoading(false);
      }
    }
  }, [browser]);

  React.useEffect(() => {
    void refresh();
    return () => activeRequest.current?.abort(new DOMException("Provider unmounted", "AbortError"));
  }, [refresh]);

  return (
    <PublicInfoContext.Provider value={{ publicInfo, isLoading, error, refresh }}>
      {children}
    </PublicInfoContext.Provider>
  );
};

export const usePublicInfo = () => {
  const context = React.useContext(PublicInfoContext);
  if (!context) {
    throw new Error("usePublicInfo must be used within a PublicInfoProvider");
  }
  return context;
};
