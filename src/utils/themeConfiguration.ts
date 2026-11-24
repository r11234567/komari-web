export const THEME_CONFIGURATION_MANAGED = "managed";
export const THEME_CONFIGURATION_RAW = "raw";
export const THEME_CONFIGURATION_REDIRECT = "redirect";
export const THEME_MANIFEST_SCHEMA_VERSION = 1;

export interface ThemeManifest {
  schemaVersion: number;
  name?: unknown;
  short?: string;
  description?: unknown;
  version?: string;
  author?: unknown;
  url?: string;
  preview?: string;
  configuration?: ThemeConfiguration;
  [key: string]: unknown;
}

export interface ThemeConfiguration {
  type?: string;
  icon?: string;
  name?: unknown;
  data?: unknown;
}

// Manifests created before schemaVersion existed are the v1 contract. Keeping
// this normalization at the API edge prevents themes from depending on an RPC
// transport or on frontend-internal response objects.
export const normalizeThemeManifest = (value: unknown): ThemeManifest | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  let candidate = value as Record<string, unknown>;
  if (
    candidate.status === "success" &&
    candidate.data &&
    typeof candidate.data === "object" &&
    !Array.isArray(candidate.data)
  ) {
    candidate = candidate.data as Record<string, unknown>;
  }

  const declared = candidate.schemaVersion;
  const schemaVersion =
    typeof declared === "number" && Number.isInteger(declared) && declared > 0
      ? declared
      : THEME_MANIFEST_SCHEMA_VERSION;

  return { ...candidate, schemaVersion } as ThemeManifest;
};

export const adminThemeManifestPath = (themeShort: string): string =>
  `/api/admin/theme/${encodeURIComponent(themeShort.trim())}/manifest`;

export const adminThemePreviewPath = (themeShort: string): string =>
  `/api/admin/theme/${encodeURIComponent(themeShort.trim())}/preview`;

export const isSplitPanelMode = (
  settings?: {
    panel_isolation_mode?: unknown;
    panel_listen_enabled?: unknown;
    [key: string]: unknown;
  } | null,
): boolean =>
  settings?.panel_isolation_mode === "split" ||
  settings?.panel_listen_enabled === true;

export const resolvePublicSiteOrigin = (
  settings?: {
    public_origin?: unknown;
    [key: string]: unknown;
  } | null,
  fallbackOrigin?: string,
): string => {
  const raw =
    typeof settings?.public_origin === "string"
      ? settings.public_origin.trim()
      : "";
  if (raw) {
    try {
      const parsed = new URL(raw);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        return parsed.origin;
      }
    } catch {
      // Ignore malformed origin and use fallback.
    }
  }
  return fallbackOrigin ?? "";
};

export const resolvePublicSiteHref = (
  settings?: {
    public_origin?: unknown;
    [key: string]: unknown;
  } | null,
  subPath = "/",
): string => {
  const normalizedPath = subPath.startsWith("/") ? subPath : `/${subPath}`;
  const origin = resolvePublicSiteOrigin(settings);
  return origin ? `${origin}${normalizedPath}` : normalizedPath;
};

export const getThemeConfigurationType = (
  configuration?: ThemeConfiguration,
) => (configuration?.type || THEME_CONFIGURATION_MANAGED).trim().toLowerCase();

export const getRawThemeHtml = (configuration?: ThemeConfiguration) =>
  getThemeConfigurationType(configuration) === THEME_CONFIGURATION_RAW &&
  typeof configuration?.data === "string"
    ? configuration.data
    : "";

const normalizeSiteRoot = (siteRoot: string) => {
  const fallback = "/";
  const root = siteRoot.trim() || fallback;

  try {
    const parsed = new URL(root, window.location.origin);
    if (parsed.origin !== window.location.origin) return fallback;

    const pathname = parsed.pathname || fallback;
    if (pathname === "/") return fallback;
    return `/${pathname.replace(/^\/+|\/+$/g, "")}/`;
  } catch {
    return fallback;
  }
};

export const normalizeThemeRedirectTarget = (
  data: unknown,
  siteRoot = import.meta.env?.BASE_URL || "/",
) => {
  if (typeof data !== "string") return null;

  const target = data.trim();
  if (
    !target ||
    target.startsWith("//") ||
    target.includes("\\") ||
    /^[a-z][a-z\d+\-.]*:/i.test(target)
  ) {
    return null;
  }

  let url: URL;
  try {
    const root = normalizeSiteRoot(siteRoot);
    const base = `${window.location.origin}${root}`;
    const rootRelativeTarget = target.startsWith("/")
      ? target.replace(/^\/+/, "")
      : target.replace(/^(\.\.\/)+/, "");
    const rootRelativePath = rootRelativeTarget.split(/[?#]/, 1)[0];

    if (rootRelativePath.split("/").includes("..")) return null;

    url = new URL(rootRelativeTarget, base);

    if (
      root !== "/" &&
      url.pathname !== root.slice(0, -1) &&
      !url.pathname.startsWith(root)
    ) {
      return null;
    }
  } catch {
    return null;
  }

  if (url.origin !== window.location.origin) return null;
  if (url.pathname.split("/").includes("..")) return null;

  return `${url.pathname}${url.search}${url.hash}`;
};
