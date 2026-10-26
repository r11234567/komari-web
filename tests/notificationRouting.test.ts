import assert from "node:assert/strict";
import test from "node:test";
import { normalizeRouteDraft, toggleRoute, digestSecondsInput, notificationRequest, alertKinds } from "../src/utils/notificationRouting.ts";

test("per-alert routes retain empty selection, support plugins and remove duplicate channels", () => {
 const routes=normalizeRouteDraft({offline:["email","custom-plugin","email"],online:[]});
 assert.equal(Object.keys(routes).length,alertKinds.length);
 assert.deepEqual(routes.offline,["email","custom-plugin"]);
 assert.deepEqual(routes.online,[]);
 assert.deepEqual(normalizeRouteDraft({}).offline,[]);
 const changed=toggleRoute(routes,"offline","email",false);
 assert.deepEqual(changed.offline,["custom-plugin"]);
 assert.deepEqual(routes.offline,["email","custom-plugin"]);
 assert.deepEqual(toggleRoute(changed,"offline","custom-plugin",true).offline,["custom-plugin"]);
});
test("digest accepts whole seconds from 1 to 3600 only", () => {
 for(const value of ["1","5","3600"]) assert.equal(digestSecondsInput(value),Number(value));
 for(const value of ["0","3601","1.5","","NaN","1e2","-5"]) assert.throws(()=>digestSecondsInput(value));
});
test("targeted test checks both HTTP and business errors", async () => {
 const previous=globalThis.fetch;
 try {
  globalThis.fetch=async()=>new Response(JSON.stringify({status:"error",message:"provider failed"}),{status:200});
  await assert.rejects(notificationRequest("/test"),/provider failed/);
  globalThis.fetch=async()=>new Response(JSON.stringify({status:"success"}),{status:502});
  await assert.rejects(notificationRequest("/test"),/502/);
  globalThis.fetch=async()=>new Response(JSON.stringify({status:"success",data:null}),{status:200});
  assert.equal(await notificationRequest("/test"),null);
 } finally {globalThis.fetch=previous;}
});
