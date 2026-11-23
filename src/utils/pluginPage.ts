const SAFE_PLUGIN_SHORT_RE = /^[a-zA-Z0-9._-]+$/;

function hasUnsafePathChars(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
    const ch = value[i];
    if (ch === "\\" || ch === "?" || ch === "#") {
      return true;
    }
  }
  return false;
}

export function buildPluginPageSrc(
  prefix: "/api/admin/plugin" | "/api/plugin",
  short: string | null | undefined,
  file: string | null | undefined,
): string | null {
  if (!short || !file) {
    return null;
  }
  const normalizedShort = short.trim();
  if (
    !normalizedShort ||
    normalizedShort === "." ||
    normalizedShort === ".." ||
    !SAFE_PLUGIN_SHORT_RE.test(normalizedShort)
  ) {
    return null;
  }
  if (hasUnsafePathChars(file)) {
    return null;
  }
  const trimmedFile = file.replace(/^\/+/, "");
  if (!trimmedFile) {
    return null;
  }
  const segments = trimmedFile.split("/").filter((segment) => segment.length > 0);
  if (segments.length === 0 || segments.some((segment) => segment === "." || segment === "..")) {
    return null;
  }
  const encodedPath = segments.map((segment) => encodeURIComponent(segment)).join("/");
  return `${prefix}/${encodeURIComponent(normalizedShort)}/${encodedPath}`;
}
