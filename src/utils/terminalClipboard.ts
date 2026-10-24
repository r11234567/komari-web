// Terminal keyboard and clipboard rules shared by the browser terminal.
// Ctrl+Shift+C copies the xterm selection, Ctrl+Shift+V pastes, and Ctrl+C
// still interrupts when nothing is selected.
export type TerminalKeyInput = Pick<
  KeyboardEvent,
  "altKey" | "code" | "ctrlKey" | "key" | "metaKey" | "shiftKey"
> & { keyCode?: number };

export type TerminalKeyAction =
  | { action: "copy" }
  | { action: "paste"; explicit: boolean }
  | { action: "send"; byte: number; keepBrowserCopy?: boolean }
  | { action: "pass" };

function controlLetter(event: TerminalKeyInput): string {
  if (event.key.length === 1) {
    const letter = event.key.toLowerCase();
    if (letter >= "a" && letter <= "z") return letter;
  }
  // IME reports key "Process" and keyCode 229; the physical key is still KeyX.
  if (/^Key[A-Z]$/.test(event.code)) return event.code.slice(3).toLowerCase();
  if (typeof event.keyCode === "number" && event.keyCode >= 65 && event.keyCode <= 90) {
    return String.fromCharCode(event.keyCode + 32);
  }
  return "";
}

// Ctrl+A..Z as one C0 byte. Ctrl+V stays null so the browser can paste.
function terminalControlByte(event: TerminalKeyInput): number | null {
  if (!event.ctrlKey || event.altKey || event.metaKey) return null;
  if (event.shiftKey) {
    if (event.key === "_" || event.code === "Minus") return 0x1f;
    return null;
  }
  const letter = controlLetter(event);
  if (letter === "v") return null;
  if (letter) return letter.charCodeAt(0) - 96;
  if (event.code === "Backslash" || event.key === "\\" || event.keyCode === 220) return 0x1c;
  if (event.code === "BracketLeft" || event.key === "[" || event.keyCode === 219) return 0x1b;
  if (event.code === "BracketRight" || event.key === "]" || event.keyCode === 221) return 0x1d;
  if (event.code === "Digit6" || event.key === "6" || event.keyCode === 54) return 0x1e;
  return null;
}

export function terminalKeyAction(event: TerminalKeyInput, hasSelection: boolean): TerminalKeyAction {
  const letter = controlLetter(event);
  const copyWithSelection = event.ctrlKey && !event.shiftKey && letter === "c" && hasSelection;
  const copyShortcut =
    copyWithSelection ||
    (((event.ctrlKey && event.shiftKey) || event.metaKey) && letter === "c") ||
    (event.ctrlKey && event.key === "Insert");
  if (copyShortcut) return { action: "copy" };
  if ((event.ctrlKey || event.metaKey) && !event.altKey && letter === "v") {
    return { action: "paste", explicit: event.shiftKey };
  }
  if (event.shiftKey && event.key === "Insert") {
    return { action: "paste", explicit: true };
  }
  const control = terminalControlByte(event);
  if (control === null) return { action: "pass" };
  return {
    action: "send",
    byte: control,
    keepBrowserCopy: control === 0x03,
  };
}

// Chrome may turn Ctrl+X into a cut on the terminal textarea and swallow the
// letter; this maps that input event back to the C0 byte.
export function controlByteForCut(inputType: string): number | null {
  return inputType === "deleteByCut" ? 0x18 : null;
}

// Newlines become carriage returns so multiline pastes behave like typing.
export function normalizeTerminalPaste(text: string): string {
  return text.replace(/\r?\n/g, "\r");
}

// Clipboard reads require a secure context, and some browsers expose the API
// but deny the call. Return null so the caller can offer a manual paste box.
export async function readTextFromClipboard(): Promise<string | null> {
  if (typeof navigator === "undefined" || !navigator.clipboard?.readText) return null;
  try {
    return await navigator.clipboard.readText();
  } catch {
    return null;
  }
}

// navigator.clipboard.writeText is unavailable on plain HTTP deployments, so
// fall back to the legacy selection copy that still works from a user gesture.
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text) return false;
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the legacy path.
    }
  }
  if (typeof document === "undefined" || !document.body || typeof document.execCommand !== "function") {
    return false;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "0";
  textarea.style.width = "1px";
  textarea.style.height = "1px";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  try {
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange?.(0, text.length);
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}
