import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// Exercise the real TerminalSession component against an isolated synthetic
// transport. This harness never connects to a real panel or managed machine.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: "@/api/connect/remote", replacement: fileURLToPath(new URL("./fixtures/remote.ts", import.meta.url)) },
      { find: "@", replacement: fileURLToPath(new URL("../../src", import.meta.url)) },
    ],
  },
});
