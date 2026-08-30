const routePreloaders: Record<string, () => Promise<unknown>> = {
  "/admin/dashboard": () => import("@/pages/admin/dashboard"),
  "/admin/servers": () => import("@/pages/admin"),
  "/admin/billing": () => import("@/pages/admin/billing"),
  "/admin/ping": () => import("@/pages/admin/pingTask"),
  "/admin/return-route": () => import("@/pages/admin/returnRoute"),
  "/admin/settings/site": () => import("@/pages/admin/settings/site"),
  "/admin/settings/dashboard": () => import("@/pages/admin/settings/dashboard"),
  "/admin/settings/metrics": () => import("@/pages/admin/settings/metrics"),
};

function pathname(target: string) {
  return target.split(/[?#]/, 1)[0].replace(/\/$/, "") || "/";
}

export async function preloadAdminRoute(target: string): Promise<void> {
  const path = pathname(target);
  if (path === "/admin/billing") {
    void import("@/utils/billing").then((module) => module.prefetchBillingCenter()).catch(() => undefined);
  }
  await (routePreloaders[path]?.() ?? Promise.resolve());
}

export function scheduleAdminWarmup(currentPath: string): () => void {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (connection?.saveData || connection?.effectiveType === "2g" || connection?.effectiveType === "slow-2g") return () => undefined;
  const targets = ["/admin/servers", "/admin/billing", "/admin/ping", "/admin/return-route"].filter((item) => item !== currentPath);
  let stopped = false;
  const timer = window.setTimeout(() => {
    const warm = async () => {
      for (const target of targets) {
        if (stopped) return;
        await preloadAdminRoute(target).catch(() => undefined);
      }
    };
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
    };
    if (idleWindow.requestIdleCallback) {
      idleWindow.requestIdleCallback(() => void warm(), { timeout: 4000 });
    } else {
      void warm();
    }
  }, 4000);
  return () => { stopped = true; window.clearTimeout(timer); };
}
