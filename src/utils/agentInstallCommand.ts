import { quotePowerShellArg, quoteShellArg } from "./shellQuote.ts";

export type InstallPlatform = "linux" | "macos" | "windows";

export function agentInstallEndpoint(configured: string, currentOrigin: string): string | null {
  const value = configured.trim() || currentOrigin;
  if (!value || /[\s\\@?#]/u.test(value) || value.includes("\u0000")) return null;

  const endpoint = value.includes("://") ? value : "https://" + value;
  if (!/^https:\/\/[^/]+\/?$/i.test(endpoint)) return null;
  try {
    return new URL(endpoint).origin;
  } catch {
    return null;
  }
}

export function agentInstallCommand(platform: InstallPlatform, endpoint: string): string {
  const base = "https://raw.githubusercontent.com/r11234567/komari-agent/main/";
  if (platform === "windows") {
    return "$script = irm '" + base + "install.ps1'; & ([scriptblock]::Create($script)) -e " + quotePowerShellArg(endpoint);
  }
  return "curl -fsSL '" + base + "install.sh' | sudo bash -s -- -e " + quoteShellArg(endpoint);
}
