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
  assert.ok(agentInstallCommand("linux", endpoint).endsWith(" -e '" + endpoint + "'"));
  assert.ok(agentInstallCommand("windows", endpoint).endsWith(" -e '" + endpoint + "'"));
  assert.equal(quoteShellArg("two words"), "'two words'");
  assert.equal(quotePowerShellArg("one’two'three"), "'one’’two''three'");
});
