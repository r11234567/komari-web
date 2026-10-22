import type { RuntimeConfig } from "@komari/proto/komari/config/v1/config_pb";
import type { InstallationObservation } from "@komari/proto/komari/report/v1/report_pb";
import type { ConfigDelivery } from "@komari/proto/komari/deployment/v1/deployment_pb";

const unknown = "未上报";
const privilegeLabels: Record<number, string> = {
  0: "权限级别未上报", 1: "Linux root", 2: "Linux 非特权账号",
  3: "Windows 管理员", 4: "Windows 普通账号", 5: "其他系统身份",
};

export function installationView(observation?: InstallationObservation) {
  const account = observation?.processUser;
  const mode = privilegeLabels[observation?.privilegeMode ?? 0] ?? unknown;
  return {
    operatingSystem: observation?.operatingSystem || unknown,
    identity: account ? `${account}（${mode}）` : observation ? mode : unknown,
    executable: observation?.executable || unknown,
    serviceName: observation?.serviceName || unknown,
    initSystem: observation?.initSystem || unknown,
    manifest: observation?.serviceManifest || unknown,
    configFile: observation?.configFile || unknown,
    runtimeFile: observation?.runtimeStateFile || unknown,
    privilegedFile: observation?.privilegedStateFile || unknown,
    updates: observation?.daemonSelfUpdateSupported === false
      ? "守护进程不支持自更新；需在本机更新"
      : observation?.disableAutoUpdate === undefined ? unknown
        : observation.disableAutoUpdate ? "本地已禁用自动更新" : "本地未禁用自动更新（执行能力未确认）",
    tls: observation?.ignoreUnsafeCertificate === undefined ? unknown
      : observation.ignoreUnsafeCertificate ? "本地已配置跳过证书校验" : "本地已配置证书校验",
    remoteControl: observation?.disableRemoteControl === undefined ? unknown
      : observation.disableRemoteControl ? "本机强制关闭" : "未强制关闭，仍需授权",
    transport: observation?.transport || unknown,
  };
}

// OS comes from a daemon/browser report, never the deployment template.
export function unsupportedHostPlatform(os?: string) {
  if (/windows|^win(?:32|64)?$/i.test(os ?? "")) return "Windows";
  if (/darwin|macos|mac os/i.test(os ?? "")) return "macOS";
  if (/freebsd|openbsd|netbsd/i.test(os ?? "")) return "BSD";
  return undefined;
}

export function configQueryCommand(observation?: InstallationObservation) {
  if (!observation?.executable || !observation.operatingSystem) return undefined;
  // Reject control characters, then quote every path for its actual shell.
  const paths = [observation.executable, observation.serviceManifest];
  if (paths.some((path) => /[\x00-\x1f\x7f]/.test(path))) return undefined;
  const windows = unsupportedHostPlatform(observation.operatingSystem) === "Windows";
  const quote = (value: string) => windows
    ? `'${value.replace(/'/g, "''")}'`
    : `'${value.replace(/'/g, "'\"'\"'")}'`;
  const manifest = observation.serviceManifest ? ` --service-manifest ${quote(observation.serviceManifest)}` : "";
  return `${windows ? "& " : "sudo "}${quote(observation.executable)}${manifest} config show`;
}

// Whitelist only the ordinary runtime contract. Install settings and privilege
// grants must never be echoed back by the monitoring configuration form.
export function runtimeDraft(previous?: RuntimeConfig, changes: Partial<RuntimeConfig> = {}) {
  return {
    memoryIncludeCache: changes.memoryIncludeCache ?? previous?.memoryIncludeCache,
    detailedGpu: changes.detailedGpu ?? previous?.detailedGpu,
    getIpAddrFromNic: changes.getIpAddrFromNic ?? previous?.getIpAddrFromNic,
    includeNics: changes.includeNics ?? previous?.includeNics ?? [],
    excludeNics: changes.excludeNics ?? previous?.excludeNics ?? [],
    includeMountpoints: changes.includeMountpoints ?? previous?.includeMountpoints ?? [],
    reportInterval: "reportInterval" in changes ? changes.reportInterval : previous?.reportInterval,
    trafficResetDay: "trafficResetDay" in changes ? changes.trafficResetDay : previous?.trafficResetDay,
  };
}

// A poll already in flight when a save/ACK completes must not roll status back.
export function acceptDelivery(current: ConfigDelivery | undefined, next: ConfigDelivery | undefined) {
  if (!next) return false;
  if (!current || next.desiredRevision > current.desiredRevision) return true;
  if (next.desiredRevision < current.desiredRevision) return false;
  const latestTime = (value: ConfigDelivery) => [value.savedAt, value.sentAt, value.finishedAt].reduce((latest, stamp) => {
    const time = stamp ? stamp.seconds * 1_000_000_000n + BigInt(stamp.nanos) : 0n;
    return time > latest ? time : latest;
  }, 0n);
  return latestTime(next) >= latestTime(current);
}
