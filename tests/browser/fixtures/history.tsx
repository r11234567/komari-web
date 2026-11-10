import { createRoot } from "react-dom/client";
import { Theme } from "@radix-ui/themes";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import MiniPingChart from "../../../src/components/MiniPingChart";

// Render the production chart, public API adapter, transport and read queue.
// Only fetch responses and the visibility transition are synthetic.
const state = { queries: 0, summaries: 0, aborted: 0 };
window.fetch = async (input, init) => {
  const path = String(input);
  if (path.endsWith("/QueryMetrics")) {
    state.queries++;
    if (state.queries === 1) {
      await new Promise<void>((_, reject) => {
        const abort = () => { state.aborted++; reject(init?.signal?.reason); };
        if (init?.signal?.aborted) abort();
        else init?.signal?.addEventListener("abort", abort, { once: true });
      });
    }
  } else if (path.endsWith("/GetPingStats")) {
    state.summaries++;
  } else if (!path.endsWith("/ListPingTasks")) {
    throw new Error(`Unexpected fixture request ${path}`);
  }
  return new Response(new Uint8Array(), { headers: { "Content-Type": "application/proto" } });
};
Object.assign(window, { historyAudit: {
  state,
  visible(value: boolean) {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: value ? "visible" : "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  },
} });
await i18n.use(initReactI18next).init({ lng: "en", resources: { en: { translation: {} } } });
createRoot(document.getElementById("root")!).render(<Theme><MiniPingChart uuid="synthetic-history-node" /></Theme>);
