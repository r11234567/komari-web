import { quotePowerShellArg, quoteShellArg } from "./shellQuote.ts";

export type InstallPlatform = "linux" | "macos" | "windows";

const installerRevision = "84604a6271d2f35620ebf542b5fa59ce9c1600b5";
const unixInstallerSHA256 = "4378e1221200eddd6722775957e71a7eb4c34be9eaca8155f9802eb868d7e2a0";
const windowsInstallerSHA256 = "e4e6426209d264929c36723adc12aeb5cfb57592e2392047ade1f93dcb5ec808";

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
      `& ([scriptblock]::Create((Get-Content -LiteralPath $installer.FullName -Raw))) -e ${quotePowerShellArg(endpoint)}`,
    ].join("; ");
    return `$installer = New-TemporaryFile; try { ${install} } finally { Remove-Item -LiteralPath $installer.FullName -Force }`;
  }
  const checksumCommand = platform === "macos" ? "shasum -a 256" : "sha256sum";
  return [
    "( installer=$(mktemp) && trap 'rm -f -- \"$installer\"' EXIT",
    `curl -fsSL '${base}/install.sh' -o "$installer"`,
    `printf '%s  %s\\n' '${unixInstallerSHA256}' "$installer" | ${checksumCommand} -c -`,
    `sudo bash "$installer" -e ${quoteShellArg(endpoint)} )`,
  ].join(" && ");
}
