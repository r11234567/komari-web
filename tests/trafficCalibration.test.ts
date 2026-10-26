import assert from "node:assert/strict";
import test from "node:test";
import { bytesToGB, calibrationTargets, gbToBytes, trafficRequest, trafficResetPayload } from "../src/utils/trafficCalibration.ts";
import type { CalibrationSnapshot } from "../src/utils/trafficCalibration.ts";

test("provider decimal GB preserves two decimal places exactly", () => {
  assert.equal(gbToBytes("50.72"), 50_720_000_000);
  assert.equal(gbToBytes("21.23"), 21_230_000_000);
  assert.equal(gbToBytes("50.72") - gbToBytes("21.23"), 29_490_000_000);
  assert.equal(gbToBytes("0.01"), 10_000_000);
  assert.equal(gbToBytes("5"), 5_000_000_000);
  assert.equal(bytesToGB(-29_490_000_000), "-29.49");
});

test("rejects invalid, negative, imprecise and unsafe provider values", () => {
  for (const value of ["", "-1", "1.234", "1e2", "NaN", "Infinity", "50GB", ".5", "1,50", "9007199.26"]) {
    assert.throws(() => gbToBytes(value), undefined, value);
  }
  assert.throws(() => bytesToGB(Number.MAX_SAFE_INTEGER + 1));
});

test("untouched rounded fields preserve original bytes without accumulated rounding", () => {
  const snapshot = { effective: { up: 21_234_567_890, down: 1_234_567_890 } } as CalibrationSnapshot;
  assert.deepEqual(calibrationTargets(snapshot, "50.72", "1.23"), {
    target_up: 50_720_000_000,
    target_down: 1_234_567_890,
  });
});

test("reset policy retains follow/disabled states and normalizes minute precision", () => {
  assert.deepEqual(trafficResetPayload("31", "12:45", "UTC-05:30"), {
    traffic_reset_day: 31, traffic_reset_time: "12:45:00", traffic_reset_timezone: "UTC-05:30",
  });
  assert.equal(trafficResetPayload("follow", "00:00", "UTC").traffic_reset_day, null);
  assert.equal(trafficResetPayload("0", "00:00:15", "Asia/Shanghai").traffic_reset_time, "00:00:15");
  for (const day of ["-1", "32", "1.5", "NaN"]) assert.throws(() => trafficResetPayload(day, "00:00", "UTC"));
  for (const clock of ["24:00", "12:60", "12:30garbage"]) assert.throws(() => trafficResetPayload("1", clock, "UTC"));
});

test("API failures and cancellation remain failures, with full server message", async () => {
  const original = globalThis.fetch;
  const controller = new AbortController();
  try {
    globalThis.fetch = async (_input, options) => {
      assert.equal(options?.signal, controller.signal);
      assert.equal(options?.method, "POST");
      assert.deepEqual(JSON.parse(String(options?.body)), { target_up: 10 });
      return new Response(JSON.stringify({ status: "error", message: "cycle changed" }), { status: 409 });
    };
    await assert.rejects(trafficRequest("/api/admin/client/node/traffic-calibration", controller.signal, { target_up: 10 }), /cycle changed/);
    controller.abort();
    globalThis.fetch = async (_input, options) => { options?.signal?.throwIfAborted(); return new Response(); };
    await assert.rejects(trafficRequest("/api/admin/client/node/traffic-policy", controller.signal), { name: "AbortError" });
  } finally { globalThis.fetch = original; }
});
