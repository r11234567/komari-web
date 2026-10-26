import assert from "node:assert/strict";
import test from "node:test";
import { deleteContactResource, nativeContactResource, normalizeNativeContact } from "../src/utils/nativeContacts.ts";

test("contact targets preserve mailbox identity and normalize the domain", () => {
  const draft = normalizeNativeContact("email", " User@Example.TEST ", "email");
  assert.deepEqual(draft, { kind: "email", address: "User@example.test", transport: "email" });
  assert.equal(nativeContactResource(draft), "contact:bind:email:email:User@example.test");
  assert.notEqual(nativeContactResource(draft), nativeContactResource({ ...draft, address: "other@example.test" }));
  assert.equal(deleteContactResource("email"), "contact:delete:email");
});

test("private TG IDs remain exact integers without JS number rounding", () => {
  const draft = normalizeNativeContact("telegram", "123456789123456789", "telegram");
  assert.equal(draft.address, "123456789123456789");
  assert.equal(nativeContactResource(draft), "contact:bind:telegram:telegram:123456789123456789");
  for (const address of ["-10012345", "@group", "0", "01234", "1.1", "9223372036854775808"]) assert.throws(() => normalizeNativeContact("telegram", address, "telegram"));
});

test("one explicit recipient and addressed channel are required", () => {
  for (const address of ["one@example.test,two@example.test", "Name <one@example.test>", "a@example.test\r\nBcc: another@example.test", "missing-domain@", "用户@example.test"]) assert.throws(() => normalizeNativeContact("email", address, "email"));
  assert.throws(() => normalizeNativeContact("email", "one@example.test", ""));
});
