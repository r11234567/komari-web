import assert from "node:assert/strict";
import test from "node:test";
import { normalizeOTP, otpFormat, validOTP } from "../src/utils/otpInput.ts";

test("native notification OTP accepts eight letters and digits, including pasted lowercase", () => {
  const format = otpFormat({ length: 8, charset: "alphanumeric", method: "notification_otp" });
  assert.deepEqual(format, { length: 8, alphanumeric: true });
  assert.equal(normalizeOTP("ab12 cd34", format), "AB12CD34");
  assert.equal(validOTP(normalizeOTP("ab12 cd34", format), format), true);
  assert.equal(validOTP("AB12CD", format), false);
});

test("legacy TOTP and old server prompts remain six numeric digits", () => {
  for (const prompt of [undefined, {}, { digits: 6, method: "totp" }, { digits: 6, method: "notification_otp" }]) {
    const format = otpFormat(prompt);
    assert.equal(normalizeOTP("123 456", format), "123456");
    assert.equal(validOTP("123456", format), true);
    assert.equal(validOTP("AB12CD34", format), false);
  }
});
