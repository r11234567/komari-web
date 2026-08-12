import assert from "node:assert/strict";
import test from "node:test";

import { Code, ConnectError } from "@connectrpc/connect";
import { isCompatibilityFailure } from "../src/api/connect/compatibility.ts";
import { withRequestBudget } from "../src/api/connect/deadline.ts";
import {
  THEME_MANIFEST_SCHEMA_VERSION,
  normalizeThemeManifest,
} from "../src/utils/themeConfiguration.ts";

test("Connect fallback is limited to unavailable and unimplemented procedures", () => {
  assert.equal(
    isCompatibilityFailure(new ConnectError("old backend", Code.Unavailable)),
    true,
  );
  assert.equal(
    isCompatibilityFailure(new ConnectError("old backend", Code.Unimplemented)),
    true,
  );
  assert.equal(
    isCompatibilityFailure(new ConnectError("forbidden", Code.PermissionDenied)),
    false,
  );
  assert.equal(
    isCompatibilityFailure(new ConnectError("cancelled", Code.Canceled)),
    false,
  );
});

test("third-party manifests without schemaVersion remain v1-compatible", () => {
  const legacy = normalizeThemeManifest({
    short: "third-party",
    configuration: { type: "managed", data: [] },
  });
  assert.equal(legacy?.schemaVersion, THEME_MANIFEST_SCHEMA_VERSION);

  const current = normalizeThemeManifest({ schemaVersion: 2, short: "future" });
  assert.equal(current?.schemaVersion, 2);
  assert.equal(normalizeThemeManifest([]), null);
});

test("request budgets propagate caller cancellation to the operation", async () => {
  const controller = new AbortController();
  const observed = withRequestBudget(
    controller.signal,
    10_000,
    ({ signal }) =>
      new Promise<void>((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => reject(signal.reason),
          { once: true },
        );
      }),
  );

  const reason = new DOMException("route changed", "AbortError");
  controller.abort(reason);
  await assert.rejects(observed, (error) => error === reason);
});

test("request budgets reject invalid deadlines before transport work", async () => {
  const controller = new AbortController();
  let called = false;
  await assert.rejects(
    withRequestBudget(controller.signal, 0, async () => {
      called = true;
    }),
    RangeError,
  );
  assert.equal(called, false);
});
