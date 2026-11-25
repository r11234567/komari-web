import { quotePowerShellArg, quoteShellArg } from "./shellQuote.ts";

export type InstallPlatform = "linux" | "macos" | "windows";

const installerRevision = "ee35277e63560af22e08a6b0b4254dc3e6c8302a";
const unixInstallerSHA256 = "538e9caf04d7276666cc2811e82e670e04ffa7d70ca94f84fe67c55d982209f6";
const windowsInstallerSHA256 = "9df1e67e5613064046d9fdbe898c74fa87b66aafdb238e9512b205d04fa7dcb4";
const agentVersion = "Snapshot-2611250731";

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
  const base = `https://raw.githubusercontent.com/r11234567/komari-agent/${installerRevision}`;
  if (platform === "windows") {
    const install = [
      `Invoke-WebRequest -UseBasicParsing -ErrorAction Stop -Uri '${base}/install.ps1' -OutFile $installer.FullName`,
      `if ((Get-FileHash -LiteralPath $installer.FullName -Algorithm SHA256).Hash -ne '${windowsInstallerSHA256}') { throw 'Installer SHA-256 mismatch' }`,
      `& ([scriptblock]::Create((Get-Content -LiteralPath $installer.FullName -Raw))) --install-version '${agentVersion}' -e ${quotePowerShellArg(endpoint)}`,
    ].join("; ");
    return `$installer = New-TemporaryFile; try { ${install} } finally { Remove-Item -LiteralPath $installer.FullName -Force }`;
  }
  const checksumCommand = platform === "macos" ? "shasum -a 256" : "sha256sum";
  return [
    "( installer=$(mktemp) && trap 'rm -f -- \"$installer\"' EXIT",
    `curl -fsSL '${base}/install.sh' -o "$installer"`,
    `printf '%s  %s\\n' '${unixInstallerSHA256}' "$installer" | ${checksumCommand} -c -`,
    `sudo bash "$installer" --install-version '${agentVersion}' -e ${quoteShellArg(endpoint)} )`,
  ].join(" && ");
}
