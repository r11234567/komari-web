import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// Exercise the real TerminalSession component against an isolated synthetic
// transport. This harness never connects to a real panel or managed machine.
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    // Scan the harness, not the product's virtual @komari-entry. Late
    // optimization reloads the page and destroys in-flight test contexts.
    entries: ["tests/browser/fixtures/terminal.html", "tests/browser/fixtures/account.html"],
    noDiscovery: true,
    include: [
      "react", "react-dom", "react-dom/client", "@radix-ui/themes",
      "@xterm/addon-fit", "@xterm/addon-search", "@xterm/addon-web-links",
      "@xterm/xterm", "i18next", "react-i18next", "sonner", "lucide-react",
    ],
    holdUntilCrawlEnd: true,
  },
  resolve: {
    alias: [
      { find: "@/api/connect/remote", replacement: fileURLToPath(new URL("./fixtures/remote.ts", import.meta.url)) },
      { find: "@", replacement: fileURLToPath(new URL("../../src", import.meta.url)) },
    ],
  },
});
