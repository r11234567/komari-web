import assert from "node:assert/strict";
import test from "node:test";
import { acceptDelivery, configQueryCommand, installationView, runtimeDraft, unsupportedHostPlatform } from "../src/utils/deploymentObservation.ts";

test("missing observations never invent Linux defaults, accounts or enabled options", () => {
  const view = installationView();
  assert.ok(Object.values(view).every((value) => value === "未上报"));
  assert.equal(configQueryCommand(), undefined);
  assert.equal(configQueryCommand({ operatingSystem: "linux" } as any), undefined);
});

test("all platforms show actual reported identity and custom installation", () => {
  for (const [operatingSystem, processUser, privilegeMode, executable] of [
    ["windows", "NT AUTHORITY\\LOCAL SERVICE", 4, "D:\\Apps\\Komari\\agent.exe"],
    ["linux", "root", 1, "/usr/local/custom/agent"],
    ["linux", "custom-monitor", 2, "/srv/monitor/agent"],
  ] as const) {
    const view = installationView({ operatingSystem, processUser, privilegeMode, executable, serviceName: "custom-service" } as any);
    assert.equal(view.operatingSystem, operatingSystem);
    assert.ok(view.identity.startsWith(processUser));
    assert.equal(view.executable, executable);
    assert.equal(view.serviceName, "custom-service");
  }
  assert.equal(installationView({ privilegeMode: 2 } as any).identity, "Linux 非特权账号");
});

test("optional false differs from unknown, and a flag cannot prove update support", () => {
  const unknown = installationView({} as any);
  assert.equal(unknown.tls, "未上报");
  assert.equal(unknown.updates, "未上报");
  const view = installationView({ ignoreUnsafeCertificate: false, disableAutoUpdate: false, disableRemoteControl: false, daemonSelfUpdateSupported: false } as any);
  assert.equal(view.tls, "本地已配置证书校验");
  assert.equal(view.updates, "守护进程不支持自更新；需在本机更新");
  assert.equal(view.remoteControl, "未强制关闭，仍需授权");
  assert.equal(installationView({ ignoreUnsafeCertificate: true, disableRemoteControl: true } as any).remoteControl, "本机强制关闭");
});

test("configuration commands quote actual paths for the correct shell", () => {
  assert.equal(configQueryCommand({ operatingSystem: "windows", executable: "C:\\Program Files\\O'Brien\\agent.exe", serviceManifest: "C:\\ProgramData\\Komari\\service.json" } as any),
    "& 'C:\\Program Files\\O''Brien\\agent.exe' --service-manifest 'C:\\ProgramData\\Komari\\service.json' config show");
  assert.equal(configQueryCommand({ operatingSystem: "linux", executable: "/opt/O'Brien/agent", serviceManifest: "/etc/komari/custom.json" } as any),
    `sudo '/opt/O'"'"'Brien/agent' --service-manifest '/etc/komari/custom.json' config show`);
  for (const field of ["executable", "serviceManifest"]) {
    assert.equal(configQueryCommand({ operatingSystem: "linux", executable: "/bin/agent", [field]: "bad\npath" } as any), undefined);
  }
});

test("unsupported platform guidance follows reports, without guessing unknown systems", () => {
  assert.equal(unsupportedHostPlatform("Windows 11"), "Windows");
  assert.equal(unsupportedHostPlatform("darwin"), "macOS");
  assert.equal(unsupportedHostPlatform("FreeBSD"), "BSD");
  assert.equal(unsupportedHostPlatform("linux"), undefined);
  assert.equal(unsupportedHostPlatform(), undefined);
});

test("ordinary drafts preserve explicit false and zero, and exclude installation and grants", () => {
  const draft = runtimeDraft({ memoryIncludeCache: true, detailedGpu: true, getIpAddrFromNic: true, includeNics: ["eth0"], trafficResetDay: 7, enableGpu: true, remoteControlEnabled: true, install: { dir: "/bad" } } as any,
    { memoryIncludeCache: false, detailedGpu: false, getIpAddrFromNic: false, trafficResetDay: 0 });
  assert.equal(draft.memoryIncludeCache, false);
  assert.equal(draft.detailedGpu, false);
  assert.equal(draft.getIpAddrFromNic, false);
  assert.equal(draft.trafficResetDay, 0);
  assert.deepEqual(draft.includeNics, ["eth0"]);
  for (const key of ["enableGpu", "remoteControlEnabled", "install"]) assert.equal(key in draft, false);
});

test("polls cannot replace a newer revision or an acknowledgement with older status", () => {
  const sent = { desiredRevision: 6n, sentAt: { seconds: 2n, nanos: 0 } } as any;
  const ack = { ...sent, finishedAt: { seconds: 2n, nanos: 1 } } as any;
  assert.equal(acceptDelivery(ack, sent), false);
  assert.equal(acceptDelivery(sent, ack), true);
  assert.equal(acceptDelivery(ack, { desiredRevision: 5n } as any), false);
  assert.equal(acceptDelivery(ack, { desiredRevision: 7n } as any), true);
  assert.equal(acceptDelivery(undefined, sent), true);
  assert.equal(acceptDelivery(sent, undefined), false);
});
