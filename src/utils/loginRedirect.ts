const DEFAULT_ADMIN_RETURN_TO = "/admin/dashboard";
const DEFAULT_BIND_RETURN_TO = "/bind";

export function safeLoginReturnTo(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return DEFAULT_ADMIN_RETURN_TO;
  }

  if (
    value === "/bind" ||
    value.startsWith("/bind?") ||
    value.startsWith("/bind/") ||
    value === "/bind-login" ||
    value.startsWith("/bind-login?") ||
    value === "/enroll" ||
    value.startsWith("/enroll?")
  ) {
    return value;
  }

  return value === "/admin" || value.startsWith("/admin/")
    ? value
    : DEFAULT_ADMIN_RETURN_TO;
}

export function safeBindReturnTo(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return DEFAULT_BIND_RETURN_TO;
  }

  if (
    value === "/bind" ||
    value.startsWith("/bind?") ||
    value.startsWith("/bind/") ||
    value === "/enroll" ||
    value.startsWith("/enroll?") ||
    value === "/admin/enroll" ||
    value.startsWith("/admin/enroll?")
  ) {
    return value;
  }

  return DEFAULT_BIND_RETURN_TO;
}

export function adminLoginPath(pathname: string, search = "", hash = ""): string {
  const returnTo = `${pathname}${search}${hash}`;
  return `/login?returnTo=${encodeURIComponent(returnTo)}`;
}

export function bindLoginPath(pathname: string, search = "", hash = ""): string {
  const returnTo = `${pathname}${search}${hash}`;
  return `/bind-login?returnTo=${encodeURIComponent(returnTo)}`;
}
