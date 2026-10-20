import assert from "node:assert/strict";
import test from "node:test";

import {
  adminLoginPath,
  bindLoginPath,
  safeBindReturnTo,
  safeLoginReturnTo,
} from "../src/utils/loginRedirect.ts";

test("admin login redirects retain only local admin destinations", () => {
  assert.equal(
    safeLoginReturnTo("/admin/servers?state=offline#node-1"),
    "/admin/servers?state=offline#node-1",
  );
  assert.equal(
    safeLoginReturnTo("/bind?code=ABCD-1234"),
    "/bind?code=ABCD-1234",
  );
  assert.equal(safeLoginReturnTo("/bind"), "/bind");
  assert.equal(
    safeLoginReturnTo("https://example.invalid/admin"),
    "/admin/dashboard",
  );
  assert.equal(safeLoginReturnTo("//example.invalid/admin"), "/admin/dashboard");
  assert.equal(safeLoginReturnTo("/administrator"), "/admin/dashboard");
  assert.equal(safeLoginReturnTo("/"), "/admin/dashboard");
});

test("admin routes use the dedicated login page", () => {
  assert.equal(
    adminLoginPath("/admin/servers", "?state=offline", "#node-1"),
    "/login?returnTo=%2Fadmin%2Fservers%3Fstate%3Doffline%23node-1",
  );
});

test("bind login redirects retain only local bind destinations", () => {
  assert.equal(safeBindReturnTo("/bind?code=ABCD-1234"), "/bind?code=ABCD-1234");
  assert.equal(safeBindReturnTo("/enroll"), "/enroll");
  assert.equal(safeBindReturnTo("https://example.invalid/admin"), "/bind");
  assert.equal(safeBindReturnTo("/admin/servers"), "/bind");
});

test("bind login path generates returnTo parameter", () => {
  assert.equal(
    bindLoginPath("/bind", "?code=XYZ-123", ""),
    "/bind-login?returnTo=%2Fbind%3Fcode%3DXYZ-123",
  );
});
