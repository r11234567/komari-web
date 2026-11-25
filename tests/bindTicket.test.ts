import assert from "node:assert/strict";
import test from "node:test";
import { formatTicketTime, getBindAuthorizationExpiry } from "../src/utils/bindTicket.ts";

test("bind authorization reads only its lifetime and uses the same-origin cookie", async (t) => {
  const start = Date.now();
  const signal = new AbortController().signal;
  const read = t.mock.method(globalThis, "fetch", async () =>
    Response.json({ data: { expires_in: 60 } }),
  );
  const expiry = await getBindAuthorizationExpiry(signal);
  assert.ok(expiry !== null && expiry >= start + 60_000);
  assert.deepEqual(read.mock.calls[0].arguments, [
    "/api/public/bind/ticket", { credentials: "same-origin", cache: "no-store", signal },
  ]);
  assert.equal(formatTicketTime(61), "01:01");
});

test("missing or expired bind authorization has no expiry", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 401 }));
  const signal = new AbortController().signal;
  assert.equal(await getBindAuthorizationExpiry(signal), null);
  fetch.mock.mockImplementation(async () => Response.json({ data: { expires_in: 0 } }));
  assert.equal(await getBindAuthorizationExpiry(signal), null);
  fetch.mock.mockImplementation(async () => new Response(null, { status: 500 }));
  await assert.rejects(getBindAuthorizationExpiry(signal));
});
