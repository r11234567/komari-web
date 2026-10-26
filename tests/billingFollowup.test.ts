import assert from "node:assert/strict";
import test from "node:test";
import { expiryEditPayload, formatExpiry, remainingExpiryDays, billingCurrencySymbol, billingNativeCurrencies } from "../src/utils/billing.ts";

test("finite free/one-time expiries ceil sub-day remainder and long-term has no countdown", () => {
 const now = Date.parse("2026-10-26T12:00:00Z");
 assert.equal(remainingExpiryDays("2026-10-26T12:00:01Z", now), 1);
 assert.equal(remainingExpiryDays("2026-10-25T12:00:00Z", now), 0);
 for (const value of [null, "0001-01-01T00:00:00Z", "9999-12-31T00:00:00Z"]) assert.equal(remainingExpiryDays(value, now), null);
 assert.match(formatExpiry("2026-10-26T12:30:45Z", "Asia/Shanghai"), /20:30:45.*Asia\/Shanghai/);
 assert.equal(billingCurrencySymbol("HKD"), "HK$");
 assert.ok(billingNativeCurrencies.includes("HKD"));
});

test("unchanged saves preserve absolute expiry, subsecond precision and DST fold", () => {
 const policy = { expired_at:"2026-11-01T06:30:45.123456Z", expiry_timezone:"America/New_York", expiry_local_datetime:"2026-11-01T01:30:45" };
 assert.deepEqual(expiryEditPayload(policy, policy.expiry_local_datetime, policy.expiry_timezone), {});
 assert.deepEqual(expiryEditPayload(policy, "", policy.expiry_timezone), {expired_at:null});
 assert.deepEqual(expiryEditPayload(policy, "2026-11-02T01:30", "UTC"), {expiry_timezone:"UTC", expiry_local_datetime:"2026-11-02T01:30:00"});
 assert.throws(() => expiryEditPayload(policy, "2026-11-02", "UTC"));
});
