import React, { lazy } from "react";
import type { RouteObject } from "react-router-dom";

const Index = lazy(() => import("./pages/Index"));
const NotFound = lazy(() => import("./pages/404"));
const BindPage = lazy(() => import("./pages/bind"));
const BindLoginPage = lazy(() => import("./pages/bind-login"));
const LoginPage = lazy(() => import("./pages/login"));

export const publicRoutes: RouteObject[] = [
  {
    path: "/",
    element: React.createElement(lazy(() => import("./pages/_layout"))),
    children: [
      { index: true, element: React.createElement(Index) },
      {
        path: "instance/:uuid",
        element: React.createElement(lazy(() => import("./pages/instance"))),
      },
    ],
  },
  {
    path: "/bind",
    element: React.createElement(BindPage),
  },
  {
    path: "/enroll",
    element: React.createElement(BindPage),
  },
  {
    path: "/bind-login",
    element: React.createElement(BindLoginPage),
  },
  {
    path: "/login",
    element: React.createElement(LoginPage),
  },
  { path: "*", element: React.createElement(NotFound) },
];
