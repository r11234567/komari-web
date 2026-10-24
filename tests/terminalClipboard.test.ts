import assert from "node:assert/strict";
import test from "node:test";

import {
  controlByteForCut,
  normalizeTerminalPaste,
  terminalKeyAction,
} from "../src/utils/terminalClipboard.ts";

const key = (overrides: Partial<Parameters<typeof terminalKeyAction>[0]>) => ({
  altKey: false,
  code: "",
  ctrlKey: false,
  key: "",
  metaKey: false,
  shiftKey: false,
  ...overrides,
});

test("Ctrl+Shift+C copies even without a selection", () => {
  const action = terminalKeyAction(key({ ctrlKey: true, shiftKey: true, key: "C", code: "KeyC" }), false);
  assert.deepEqual(action, { action: "copy" });
});

test("Ctrl+C copies only with a selection", () => {
  assert.deepEqual(terminalKeyAction(key({ ctrlKey: true, key: "c" }), true), { action: "copy" });
  const interrupt = terminalKeyAction(key({ ctrlKey: true, key: "c" }), false);
  assert.equal(interrupt.action, "send");
  if (interrupt.action === "send") {
    assert.equal(interrupt.byte, 0x03);
    assert.equal(interrupt.keepBrowserCopy, true);
  }
});

test("Ctrl+Shift+V is an explicit paste, Ctrl+V defers to the browser", () => {
  assert.deepEqual(
    terminalKeyAction(key({ ctrlKey: true, shiftKey: true, key: "V" }), false),
    { action: "paste", explicit: true },
  );
  assert.deepEqual(
    terminalKeyAction(key({ ctrlKey: true, key: "v" }), false),
    { action: "paste", explicit: false },
  );
});

test("Ctrl+Insert and Shift+Insert map to copy and paste", () => {
  assert.deepEqual(terminalKeyAction(key({ ctrlKey: true, key: "Insert" }), false), { action: "copy" });
  assert.deepEqual(terminalKeyAction(key({ shiftKey: true, key: "Insert" }), false), {
    action: "paste",
    explicit: true,
  });
});

test("IME reports Process but the physical key still maps", () => {
  const action = terminalKeyAction(
    key({ ctrlKey: true, key: "Process", code: "KeyD", keyCode: 229 }),
    false,
  );
  assert.equal(action.action, "send");
  if (action.action === "send") assert.equal(action.byte, 0x04);
});

test("Ctrl+X cut maps to 0x18", () => {
  assert.equal(controlByteForCut("deleteByCut"), 0x18);
  assert.equal(controlByteForCut("insertText"), null);
});

test("multiline paste normalizes to carriage returns", () => {
  assert.equal(normalizeTerminalPaste("a\nb\r\nc"), "a\rb\rc");
});
