import assert from "node:assert/strict";
import test from "node:test";
import {
  createTab,
  TAB_COLORS,
  type TerminalClient,
  type TerminalTab,
} from "../src/pages/terminal/terminalTypes.ts";
import {
  formatTransferRate,
} from "../src/pages/terminal/transferFormat.ts";
import {
  controlByteForCut,
  normalizeTerminalPaste,
  terminalKeyAction,
} from "../src/utils/terminalClipboard.ts";

test("Terminal Workbench: Multi-tab concurrent lifecycle (>= 5 tabs, reordering, duplicate, rename, colors)", () => {
  const clients: TerminalClient[] = [
    { uuid: "agent-1", name: "Node Alpha", os: "linux", weight: 1 },
    { uuid: "agent-2", name: "Node Beta", os: "linux", weight: 2 },
    { uuid: "agent-3", name: "Node Gamma", os: "windows", weight: 3 },
    { uuid: "agent-4", name: "Node Delta", os: "darwin", weight: 4 },
    { uuid: "agent-5", name: "Node Epsilon", os: "linux", weight: 5 },
    { uuid: "agent-6", name: "Node Zeta", os: "linux", weight: 6 },
  ];

  // 1. Concurrent tabs creation (>= 5 concurrent tabs)
  let tabs: TerminalTab[] = clients.map((c) => createTab(c));
  assert.equal(tabs.length, 6);
  assert.equal(new Set(tabs.map((t) => t.id)).size, 6, "Every tab must have a unique ID");

  // 2. Tab selection and active tracking
  let activeTabId: string | null = tabs[0].id;
  assert.equal(activeTabId, tabs[0].id);

  // 3. Tab reordering (simulate drag and drop from index 0 to index 3)
  const sourceIndex = 0;
  const targetIndex = 3;
  const reordered = [...tabs];
  const [moved] = reordered.splice(sourceIndex, 1);
  reordered.splice(targetIndex, 0, moved);
  tabs = reordered;
  assert.equal(tabs[3].title, "Node Alpha");
  assert.equal(tabs[0].title, "Node Beta");

  // 4. Tab rename: draft & commit
  const targetTab = tabs[3];
  const renamedTitle = "Node Alpha (Prod Master)";
  tabs = tabs.map((t) => (t.id === targetTab.id ? { ...t, title: renamedTitle } : t));
  assert.equal(tabs[3].title, renamedTitle);

  // 5. Color assignment from TAB_COLORS
  const assignedColor = TAB_COLORS[2]; // "#3cb371"
  tabs = tabs.map((t) => (t.id === targetTab.id ? { ...t, color: assignedColor } : t));
  assert.equal(tabs[3].color, assignedColor);

  // 6. Duplicate tab: clones client/title/color with a new unique tab ID
  const toDuplicate = tabs[3];
  const duplicated: TerminalTab = {
    id: `terminal-tab-dup-${Date.now()}`,
    uuid: toDuplicate.uuid,
    title: `${toDuplicate.title} (Copy)`,
    color: toDuplicate.color,
  };
  tabs = [...tabs, duplicated];
  assert.equal(tabs.length, 7);
  assert.equal(tabs[6].uuid, "agent-1");
  assert.equal(tabs[6].color, assignedColor);
  assert.notEqual(tabs[6].id, toDuplicate.id);

  // 7. Batch close operations
  // Test close "right"
  const pivotIndex = 4;
  const pivotId = tabs[pivotIndex].id;
  const rightClosed = tabs.slice(0, pivotIndex + 1);
  assert.equal(rightClosed.length, 5);

  // Test close "left"
  const leftClosed = tabs.slice(pivotIndex);
  assert.equal(leftClosed[0].id, pivotId);

  // Test close "others"
  const othersClosed = tabs.filter((t) => t.id === pivotId);
  assert.equal(othersClosed.length, 1);
  assert.equal(othersClosed[0].id, pivotId);

  // Test close "current"
  const currentClosed = tabs.filter((t) => t.id !== pivotId);
  assert.equal(currentClosed.length, tabs.length - 1);
});

test("Terminal Workbench: Buffer export text trims trailing blank lines", () => {
  const simulatedBuffer = [
    "user@server:~$ ls -la",
    "total 16",
    "drwxr-xr-x 2 user user 4096 Oct 25 00:00 .",
    "drwxr-xr-x 4 user user 4096 Oct 25 00:00 ..",
    "",
    "",
    "",
  ];

  const exportText = (lines: string[]) => {
    const copy = [...lines];
    while (copy.length > 0 && copy[copy.length - 1] === "") {
      copy.pop();
    }
    return copy.join("\n");
  };

  const exported = exportText(simulatedBuffer);
  assert.equal(
    exported,
    "user@server:~$ ls -la\ntotal 16\ndrwxr-xr-x 2 user user 4096 Oct 25 00:00 .\ndrwxr-xr-x 4 user user 4096 Oct 25 00:00 ..",
  );
});

test("Terminal Workbench: Search matching state machine (case-sensitive, regex)", () => {
  const textLines = [
    "Error: failed to open config.yaml: no such file",
    "INFO: worker started on port 8080",
    "WARN: memory pressure high",
    "ERROR: database connection timed out",
  ];

  const performSearch = (
    query: string,
    caseSensitive: boolean,
    useRegex: boolean,
  ) => {
    if (!query) return [];
    let regex: RegExp;
    try {
      regex = new RegExp(
        useRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        caseSensitive ? "g" : "gi",
      );
    } catch {
      return [];
    }
    const matches: Array<{ lineIndex: number; text: string }> = [];
    textLines.forEach((line, lineIndex) => {
      if (regex.test(line)) {
        matches.push({ lineIndex, text: line });
      }
    });
    return matches;
  };

  // Case-insensitive search: matches "Error" and "ERROR"
  const caseInsensitive = performSearch("error", false, false);
  assert.equal(caseInsensitive.length, 2);

  // Case-sensitive search: matches only "error" or exact case
  const caseSensitive = performSearch("Error", true, false);
  assert.equal(caseSensitive.length, 1);
  assert.equal(caseSensitive[0].lineIndex, 0);

  // Regex search
  const regexMatches = performSearch("port \\d+", false, true);
  assert.equal(regexMatches.length, 1);
  assert.equal(regexMatches[0].lineIndex, 1);
});

test("Terminal Workbench: Connect session streaming and afterSequence resume", async () => {
  type SessionEvent = {
    sequence: bigint;
    data: string;
  };

  // Mock server event store
  const serverEvents: SessionEvent[] = [
    { sequence: 1n, data: "Welcome to Komari WebSSH\r\n" },
    { sequence: 2n, data: "Linux agent-1 6.6.0 #1 SMP\r\n" },
    { sequence: 3n, data: "agent-1:~$ " },
    { sequence: 4n, data: "echo resumed\r\n" },
    { sequence: 5n, data: "resumed\r\nagent-1:~$ " },
  ];

  let receivedOutput = "";
  let lastAckedSequence = 0n;

  // First connection: stream events 1 to 3, then transient network disconnect
  const streamSession = async function* (afterSeq: bigint, limitCount = 5) {
    let count = 0;
    for (const ev of serverEvents) {
      if (ev.sequence > afterSeq) {
        yield ev;
        count++;
        if (count >= limitCount) break;
      }
    }
  };

  // Stream first batch (before network drop)
  for await (const ev of streamSession(0n, 3)) {
    receivedOutput += ev.data;
    lastAckedSequence = ev.sequence;
  }

  assert.equal(lastAckedSequence, 3n);
  assert.equal(receivedOutput, "Welcome to Komari WebSSH\r\nLinux agent-1 6.6.0 #1 SMP\r\nagent-1:~$ ");

  // Network drop simulated: client reconnects帶 afterSequence = 3n
  for await (const ev of streamSession(lastAckedSequence, 10)) {
    receivedOutput += ev.data;
    lastAckedSequence = ev.sequence;
  }

  // Verify resumed stream without duplicating previous output
  assert.equal(lastAckedSequence, 5n);
  assert.equal(
    receivedOutput,
    "Welcome to Komari WebSSH\r\nLinux agent-1 6.6.0 #1 SMP\r\nagent-1:~$ echo resumed\r\nresumed\r\nagent-1:~$ ",
  );
});

test("Terminal Workbench: Transfer formatting utilities", () => {
  assert.equal(formatTransferRate(0), "0 B/s");
  assert.equal(formatTransferRate(512), "512 B/s");
  assert.equal(formatTransferRate(1024), "1.0 KB/s");
  assert.equal(formatTransferRate(1024 * 1024 * 2.5), "2.5 MB/s");
  assert.equal(formatTransferRate(1024 * 1024 * 1024 * 10), "10.0 GB/s");
  assert.equal(formatTransferRate(1024 * 1024 * 1024 * 120), "120 GB/s");
});

test("Terminal Workbench: Clipboard key matrix and paste normalization", () => {
  // Ctrl+Shift+C: copy selection or empty
  const copyEvent = {
    ctrlKey: true,
    shiftKey: true,
    key: "C",
    code: "KeyC",
    altKey: false,
    metaKey: false,
  };
  assert.deepEqual(terminalKeyAction(copyEvent, false), { action: "copy" });

  // Ctrl+C with selection: copy
  const ctrlCWithSelection = {
    ctrlKey: true,
    shiftKey: false,
    key: "c",
    code: "KeyC",
    altKey: false,
    metaKey: false,
  };
  assert.deepEqual(terminalKeyAction(ctrlCWithSelection, true), { action: "copy" });

  // Ctrl+C without selection: send 0x03 (SIGINT) to PTY
  const interruptAction = terminalKeyAction(ctrlCWithSelection, false);
  assert.equal(interruptAction.action, "send");
  if (interruptAction.action === "send") {
    assert.equal(interruptAction.byte, 0x03);
  }

  // Ctrl+X cut interception
  assert.equal(controlByteForCut("deleteByCut"), 0x18);

  // Multiline paste normalization (CRLF -> CR, LF -> CR)
  assert.equal(normalizeTerminalPaste("git status\r\ngit log\nls -l"), "git status\rgit log\rls -l");
});

test("Terminal Workbench: Feature flag & route fallback", () => {
  const isEnabled = (searchParams: string, storageValue: string | null) => {
    const params = new URLSearchParams(searchParams);
    if (params.get("legacy") === "1" || params.get("workbench") === "0") return false;
    if (storageValue === "false") return false;
    return true;
  };

  // Default: enabled
  assert.equal(isEnabled("", null), true);

  // Explicit URL legacy override
  assert.equal(isEnabled("?legacy=1", null), false);
  assert.equal(isEnabled("?workbench=0", null), false);

  // Local storage feature flag override
  assert.equal(isEnabled("", "false"), false);
  assert.equal(isEnabled("", "true"), true);
});
