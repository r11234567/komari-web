import { createRoot } from "react-dom/client";
import { Theme } from "@radix-ui/themes";
import "@radix-ui/themes/styles.css";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import Account from "../../../src/pages/admin/account";

await i18next.use(initReactI18next).init({
  lng: "en", fallbackLng: "en", initImmediate: false,
  resources: { en: { translation: { common: { confirm: "Confirm", cancel: "Cancel" } } } },
});
createRoot(document.getElementById("root")!).render(<Theme><Account /></Theme>);
