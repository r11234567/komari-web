import assert from "node:assert/strict";
import test from "node:test";

import {
  adminLoginPath,
  safeLoginReturnTo,
} from "../src/utils/loginRedirect.ts";

test("admin login redirects retain only local admin destinations", () => {
  assert.equal(
    safeLoginReturnTo("/admin/servers?state=offline#node-1"),
    "/admin/servers?state=offline#node-1",
  );
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
