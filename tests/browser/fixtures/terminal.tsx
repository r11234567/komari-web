import { createRoot } from "react-dom/client";
import { Theme } from "@radix-ui/themes";
import "@radix-ui/themes/styles.css";
import "@xterm/xterm/css/xterm.css";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import TerminalSession from "../../../src/pages/terminal/TerminalSession";
import { state } from "./state";
import WorkspaceBoundary from "../../../src/pages/terminal/WorkspaceBoundary";
import { installFixtureGrant } from "./workspace";
import en from "../../../src/i18n/locales/en.json";

await i18next.use(initReactI18next).init({
  lng: "en", fallbackLng: "en", initImmediate: false,
  resources: { en: { translation: en } },
});
if (new URLSearchParams(location.search).get("twofa") !== "1") installFixtureGrant("synthetic-agent");
createRoot(document.getElementById("root")!).render(
  <Theme>
    <WorkspaceBoundary><div style={{ width: "900px", height: "500px" }}>
      <TerminalSession
        uuid="synthetic-agent"
        active
        twoFaEnabled={new URLSearchParams(location.search).get("twofa") === "1"}
        disconnectMessage="Synthetic session closed"
        onApiChange={(api) => {
          state.api = api;
        }}
      />
    </div></WorkspaceBoundary>
  </Theme>,
);
