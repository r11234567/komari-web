// routes.js
import { lazy } from "react";
import { Navigate, type RouteObject } from "react-router-dom";
import React from "react";

const importAdminLayout = () => import("./pages/admin/_layout");
const importAdminDashboard = () => import("./pages/admin/dashboard");
let adminLayoutModule: ReturnType<typeof importAdminLayout> | undefined;
let adminDashboardModule: ReturnType<typeof importAdminDashboard> | undefined;
const loadAdminLayout = () => (adminLayoutModule ??= importAdminLayout());
const loadAdminDashboard = () =>
  (adminDashboardModule ??= importAdminDashboard());

export const preloadAdminEntry = () => {
  void loadAdminLayout();
  void loadAdminDashboard();
};

const adminRoutePreloaders: Record<string, () => Promise<unknown>> = {
  "/admin": loadAdminDashboard,
  "/admin/servers": () => import("./pages/admin"),
  "/admin/ping": () => import("./pages/admin/pingTask"),
  "/admin/return-route": () => import("./pages/admin/returnRoute"),
  "/admin/logs": () => import("./pages/admin/log"),
  "/admin/exec": () => import("./pages/admin/exec"),
  "/admin/terminal": () => import("./pages/admin/terminal"),
  "/admin/theme_managed": () => import("./pages/admin/theme_managed.tsx"),
  "/admin/theme_raw": () => import("./pages/admin/theme_raw.tsx"),
  "/admin/market/themes": () => import("./pages/admin/market/themes"),
  "/admin/settings/site": () => import("./pages/admin/settings/site"),
  "/admin/settings/dashboard": () => import("./pages/admin/settings/dashboard"),
  "/admin/settings/theme": () => import("./pages/admin/settings/theme"),
  "/admin/settings/custom": () => import("./pages/admin/settings/custom"),
  "/admin/settings/notification": () => import("./pages/admin/settings/notification"),
  "/admin/settings/general": () => import("./pages/admin/settings/general"),
  "/admin/settings/xtermjs": () => import("./pages/admin/settings/xtermjs"),
  "/admin/settings/reverse-proxy": () => import("./pages/admin/settings/reverse-proxy"),
  "/admin/settings/metrics": () => import("./pages/admin/settings/metrics"),
  "/admin/settings/account-security": () => import("./pages/admin/settings/account-security"),
  "/admin/notification/offline": () => import("./pages/admin/notification/offline"),
  "/admin/notification/load": () => import("./pages/admin/notification/load"),
  "/admin/notification/general": () => import("./pages/admin/notification/general"),
  "/admin/notification/traffic-report": () => import("./pages/admin/notification/traffic_report"),
  "/admin/notification/ping-loss": () => import("./pages/admin/notification/ping_loss"),
};

export const preloadAdminRoute = async (target: string): Promise<void> => {
  const pathname = target.split(/[?#]/, 1)[0].replace(/\/$/, "") || "/admin";
  const preload = adminRoutePreloaders[pathname];
  if (preload) await preload();
};

export const preloadAdminRoutes = async (): Promise<void> => {
  await Promise.allSettled(
    Array.from(new Set(Object.values(adminRoutePreloaders))).map((preload) => preload()),
  );
};

const AdminLayout = lazy(loadAdminLayout);
const AdminDashboard = lazy(loadAdminDashboard);
const NotFound = lazy(() => import("./pages/404"));

export const routes: RouteObject[] = [
  {
    path: "/admin/update/1.2.7",
    element: React.createElement(
      lazy(() => import("./pages/admin/update_1_2_7"))
    ),
  },
  {
    path: "/admin/update/storage-v4",
    element: React.createElement(
      lazy(() => import("./pages/admin/update_storage_v4"))
    ),
  },
  {
    path: "/install",
    element: React.createElement(lazy(() => import("./pages/install"))),
  },
  {
    path: "/admin",
    element: React.createElement(AdminLayout),
    children: [
      { index: true, element: React.createElement(AdminDashboard) },
      {
        path: "servers",
        element: React.createElement(lazy(() => import("./pages/admin"))),
      },
      {
        path: "theme_managed",
        element: React.createElement(
          lazy(() => import("./pages/admin/theme_managed.tsx"))
        ),
      },
      {
        path: "theme_raw",
        element: React.createElement(
          lazy(() => import("./pages/admin/theme_raw.tsx"))
        ),
      },
      {
        path: "market/themes",
        element: React.createElement(
          lazy(() => import("./pages/admin/market/themes"))
        ),
      },
      {
        path: "sessions",
        element: React.createElement(Navigate, {
          replace: true,
          to: "/admin/settings/account-security?tab=sessions",
        }),
      },
      {
        path: "account",
        element: React.createElement(Navigate, {
          replace: true,
          to: "/admin/settings/account-security?tab=account",
        }),
      },
      {
        path: "settings",
        element: React.createElement(
          lazy(() => import("./pages/admin/settings/_layout"))
        ),
        children: [
          {
            path: "site",
            element: React.createElement(
              lazy(() => import("./pages/admin/settings/site"))
            ),
          },
          {
            path: "dashboard",
            element: React.createElement(
              lazy(() => import("./pages/admin/settings/dashboard"))
            ),
          },
          {
            path: "theme",
            element: React.createElement(
              lazy(() => import("./pages/admin/settings/theme"))
            ),
          },
          {
            path: "custom",
            element: React.createElement(
              lazy(() => import("./pages/admin/settings/custom"))
            ),
          },
          {
            path: "sign-on",
            element: React.createElement(Navigate, {
              replace: true,
              to: "/admin/settings/account-security?tab=sign-on",
            }),
          },
          {
            path: "notification",
            element: React.createElement(
              lazy(() => import("./pages/admin/settings/notification"))
            ),
          },
          {
            path: "general",
            element: React.createElement(
              lazy(() => import("./pages/admin/settings/general"))
            ),
          },
          {
            path: "xtermjs",
            element: React.createElement(
              lazy(() => import("./pages/admin/settings/xtermjs"))
            ),
          },
          {
            path: "reverse-proxy",
            element: React.createElement(
              lazy(() => import("./pages/admin/settings/reverse-proxy"))
            ),
          },
          {
            path: "metrics",
            element: React.createElement(
              lazy(() => import("./pages/admin/settings/metrics"))
            ),
          },
          {
            path: "account-security",
            element: React.createElement(
              lazy(() => import("./pages/admin/settings/account-security"))
            ),
          },
        ],
      },
      {
        path: "notification",
        children: [
          {
            path: "offline",
            element: React.createElement(
              lazy(() => import("./pages/admin/notification/offline"))
            ),
          },
          {
            path: "load",
            element: React.createElement(
              lazy(() => import("./pages/admin/notification/load"))
            ),
          },
          {
            path: "general",
            element: React.createElement(
              lazy(() => import("./pages/admin/notification/general"))
            ),
          },
          {
            path: "traffic-report",
            element: React.createElement(
              lazy(() => import("./pages/admin/notification/traffic_report"))
            ),
          },
          {
            path: "ping-loss",
            element: React.createElement(
              lazy(() => import("./pages/admin/notification/ping_loss"))
            ),
          },
        ],
      },
      {
        path: "ping",
        element: React.createElement(
          lazy(() => import("./pages/admin/pingTask"))
        ),
      },
      {
        path: "return-route",
        element: React.createElement(
          lazy(() => import("./pages/admin/returnRoute"))
        ),
      },
      {
        path: "logs",
        element: React.createElement(lazy(() => import("./pages/admin/log"))),
      },
      {
        path: "pprof",
        element: React.createElement(lazy(() => import("./pages/admin/pprof"))),
      },
      {
        path: "exec",
        element: React.createElement(lazy(() => import("./pages/admin/exec"))),
      },
      {
        path: "terminal",
        element: React.createElement(
          lazy(() => import("./pages/admin/terminal")),
        ),
      }
    ],
  },
  {
    path: "/terminal",
    element: React.createElement(lazy(() => import("./pages/terminal"))),
  },
  {
    path: "/manage/*",
    element: React.createElement(lazy(() => import("./pages/manage"))),
  },
  // Catch-all 404 route
  { path: "*", element: React.createElement(NotFound) },
];
