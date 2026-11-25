import assert from "node:assert/strict";
import test from "node:test";
import { agentInstallCommand, agentInstallEndpoint } from "../src/utils/agentInstallCommand.ts";
import { quotePowerShellArg, quoteShellArg } from "../src/utils/shellQuote.ts";

test("Agent installation normalizes an HTTPS origin and supports ports and IPv6", () => {
  assert.equal(agentInstallEndpoint("", "https://panel.example:8443"), "https://panel.example:8443");
  assert.equal(agentInstallEndpoint(" panel.example:8443/ ", ""), "https://panel.example:8443");
  assert.equal(agentInstallEndpoint("https://[2001:db8::1]:8443", ""), "https://[2001:db8::1]:8443");
});

test("Agent installation commands require a clean HTTPS origin", () => {
  for (const value of [
    "http://panel.example", "https://panel.example/path", "https://panel.example?",
    "https://user@panel.example", "https://panel.example#fragment", "https://panel.example/a/..",
    "https://panel .example", "https://panel.example\\\\alternate",
  ]) {
    assert.equal(agentInstallEndpoint(value, "https://panel.example"), null, value);
  }
});

test("installation commands quote the validated origin for each shell", () => {
  const endpoint = "https://[2001:db8::1]:8443";
  for (const platform of ["linux", "macos", "windows"] as const) {
    assert.ok(agentInstallCommand(platform, endpoint).includes(" -e '" + endpoint + "'"));
  }
  assert.equal(quoteShellArg("two words"), "'two words'");
  assert.equal(quotePowerShellArg("one’two'three"), "'one’’two''three'");
});

test("copyable commands pin the installer and verify it before execution", () => {
  const endpoint = "https://panel.example";
  const linux = agentInstallCommand("linux", endpoint);
  const macos = agentInstallCommand("macos", endpoint);
  const windows = agentInstallCommand("windows", endpoint);
  for (const command of [linux, macos, windows]) {
    assert.match(command, /komari-agent\/[a-f0-9]{40}\/install\.(?:sh|ps1)/);
    assert.doesNotMatch(command, /--install-version|Snapshot-/);
  }
  assert.match(linux, /sha256sum -c - && sudo bash/);
  assert.match(macos, /shasum -a 256 -c - && sudo bash/);
  assert.match(windows, /Get-FileHash.*throw 'Installer SHA-256 mismatch'.*\[scriptblock\]::Create/);
});
