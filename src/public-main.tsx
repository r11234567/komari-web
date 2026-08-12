import React, { StrictMode, Suspense, useMemo } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, useRoutes } from "react-router-dom";
import { Theme } from "@radix-ui/themes";
import "@radix-ui/themes/styles.css";
import "./global.css";
import "./i18n/config";
import ErrorBoundary from "./components/ErrorBoundary";
import Loading from "./components/loading";
import { OfflineIndicator } from "./components/OfflineIndicator";
import { PWAInstallPrompt } from "./components/PWAInstallPrompt";
import { PWAUpdatePrompt } from "./components/PWAUpdatePrompt";
import { Toaster } from "./components/ui/sonner";
import { ConnectProvider } from "./contexts/ConnectContext";
import { NodeListProvider } from "./contexts/NodeListContext";
import { PublicInfoProvider } from "./contexts/PublicInfoContext";
import {
  ThemeContext,
  THEME_DEFAULTS,
  type Appearance,
  type Colors,
} from "./contexts/ThemeContext";
import { useLocalStorage } from "./hooks/useLocalStorage";
import { useSystemTheme } from "./hooks/useSystemTheme";
import { publicRoutes } from "./public-routes";

const PublicApp = () => {
  const [appearance, setAppearance] = useLocalStorage<Appearance>(
    "appearance",
    THEME_DEFAULTS.appearance,
  );
  const [color, setColor] = useLocalStorage<Colors>(
    "color",
    THEME_DEFAULTS.color,
  );
  const resolvedAppearance = useSystemTheme(appearance);
  React.useEffect(() => {
    document.documentElement.classList.toggle("dark", resolvedAppearance === "dark");
  }, [resolvedAppearance]);
  const themeContextValue = useMemo(
    () => ({ appearance, setAppearance, color, setColor }),
    [appearance, setAppearance, color, setColor],
  );
  const routing = useRoutes(publicRoutes);

  return (
    <Suspense fallback={<Loading />}>
      <ThemeContext.Provider value={themeContextValue}>
        <Theme
          appearance={resolvedAppearance}
          accentColor={color}
          scaling="110%"
          className="theme-root"
          style={{ backgroundColor: "transparent", minHeight: "100vh" }}
        >
          <ConnectProvider>
            <PublicInfoProvider>
              <NodeListProvider>
                <Toaster />
                <OfflineIndicator />
                {routing}
                <PWAInstallPrompt />
                <PWAUpdatePrompt />
              </NodeListProvider>
            </PublicInfoProvider>
          </ConnectProvider>
        </Theme>
      </ThemeContext.Provider>
    </Suspense>
  );
};

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <StrictMode>
      <BrowserRouter>
        <PublicApp />
      </BrowserRouter>
    </StrictMode>
  </ErrorBoundary>,
);
