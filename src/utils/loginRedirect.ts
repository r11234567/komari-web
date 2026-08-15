const DEFAULT_ADMIN_RETURN_TO = "/admin/dashboard";

export function safeLoginReturnTo(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return DEFAULT_ADMIN_RETURN_TO;
  }

  return value === "/admin" || value.startsWith("/admin/")
    ? value
    : DEFAULT_ADMIN_RETURN_TO;
}

export function adminLoginPath(pathname: string, search = "", hash = ""): string {
  const returnTo = `${pathname}${search}${hash}`;
  return `/login?returnTo=${encodeURIComponent(returnTo)}`;
}
