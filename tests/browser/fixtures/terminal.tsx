import { createRoot } from "react-dom/client";
import { Theme } from "@radix-ui/themes";
import "@radix-ui/themes/styles.css";
import "@xterm/xterm/css/xterm.css";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import TerminalSession from "../../../src/pages/terminal/TerminalSession";
import { state } from "./state";

await i18next.use(initReactI18next).init({
  lng: "en", fallbackLng: "en", initImmediate: false,
  resources: { en: { translation: {
    common: { confirm: "Confirm", cancel: "Cancel" },
    terminal: { "2fa_title": "Two-factor verification" },
  } } },
});
createRoot(document.getElementById("root")!).render(
  <Theme>
    <div style={{ width: "900px", height: "500px" }}>
      <TerminalSession
        uuid="synthetic-agent"
        active
        twoFaEnabled={new URLSearchParams(location.search).get("twofa") === "1"}
        disconnectMessage="Synthetic session closed"
        onApiChange={(api) => {
          state.api = api;
          if (api) api.terminal.write("Clipboard sample\r\n", () => { state.ready = true; });
        }}
      />
    </div>
  </Theme>,
);
