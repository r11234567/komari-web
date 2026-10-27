import assert from "node:assert/strict";
import test from "node:test";
import { parseTrafficQuota, trafficQuotaInput } from "../src/utils/trafficQuota.ts";

test("provider GB quotas are decimal and explicit GiB retains binary semantics", () => {
  assert.equal(parseTrafficQuota("550 GB"), 550_000_000_000);
  assert.equal(parseTrafficQuota("550 GiB"), 590_558_003_200);
  assert.equal(parseTrafficQuota("1.5 TB"), 1_500_000_000_000);
  assert.equal(parseTrafficQuota("512*2gb"), 1_024_000_000_000);
  assert.equal(parseTrafficQuota("0"), 0);
  assert.equal(parseTrafficQuota("1024"), 1024);
});
test("existing binary quotas retain exact bytes unless deliberately edited", () => {
  assert.equal(trafficQuotaInput(590_558_003_200), "590.5580032 GB");
  for (const bytes of [0, 1, 590_558_003_200, 131_020_000_000, 123_456_789_123]) assert.equal(parseTrafficQuota(trafficQuotaInput(bytes)), bytes);
});
test("invalid input never silently resets a quota to zero or executes code", () => {
  for (const input of ["", "GB", "-1 GB", "Infinity", "NaN", "1e20 GB", "(() => 1)() GB", "1;globalThis.x=1", "550 unknown"]) assert.equal(parseTrafficQuota(input), null, input);
});
