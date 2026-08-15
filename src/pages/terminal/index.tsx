import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import type { CSSProperties } from "react";
import { create } from "@bufbuild/protobuf";
import { Terminal } from "@xterm/xterm";
import type { ITerminalOptions } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon } from "@xterm/addon-search";
import "@xterm/xterm/css/xterm.css";
import "./Terminal.css";
import {
  Button,
  Callout,
  Dialog,
  Flex,
  IconButton,
  Tabs,
  Text,
  TextField,
  Theme,
} from "@radix-ui/themes";


import { useTranslation } from "react-i18next";
import { Cross1Icon } from "@radix-ui/react-icons";
import { Copy, Download, FilePlus2, FolderPlus, Pencil, RefreshCw, Trash2, Upload } from "lucide-react";
import { TablerAlertTriangleFilled } from "../../components/Icones/Tabler";
import CommandClipboardPanel from "@/pages/terminal/CommandClipboard";
import { Toaster } from "@/components/ui/sonner";
import { TerminalContext } from "@/contexts/TerminalContext";
import {
  isTransparentBackground,
  defaultXtermjsSettings,
  type XtermjsSettings,
  useXtermjsSettings,
} from "@/hooks/useXtermjsSettings";
import { motion } from "framer-motion";
import throttle from "lodash/throttle";
import {
  closeRemoteSession,
  createRemoteSession,
  listRemoteAgentCapabilities,
  sendRemoteFileCommand,
  sendRemoteSessionInput,
  sendRemoteSessionResize,
  watchRemoteSession,
} from "@/api/connect/remote";
import {
  FileCommandSchema,
  FileOperation,
  type FileEntry,
  type FileEvent,
} from "@komari/proto/komari/webssh/v1/webssh_pb";

type PendingFileRequest = {
  events: FileEvent[];
  finishOnComplete: boolean;
  resolve: (events: FileEvent[]) => void;
  reject: (reason: Error) => void;
};

type FileCommandInput = {
  operation: FileOperation;
  path?: string;
  destination?: string;
  recursive?: boolean;
  overwrite?: boolean;
  size?: bigint;
  sha256?: string;
  uploadId?: string;
  data?: Uint8Array;
};
interface TerminalAreaProps {
  terminalRef: React.RefObject<HTMLDivElement | null>;
  toggleClipboard: () => void;
  width: number | string;
  isOpen: boolean;
  appearance: CSSProperties;
}
const TerminalArea: React.FC<TerminalAreaProps> = ({
  terminalRef,
  toggleClipboard,
  width,
  isOpen,
  appearance,
}) => {
  const { t } = useTranslation();
  return (
    <div
      className="km-terminal-container terminal-page relative flex justify-center flex-col h-full min-w-128"
      style={{ width, ...appearance }}
    >
      <div className="km-terminal-toolbar terminal-xterm-host m-0 w-full h-full">
        <div ref={terminalRef} className="km-terminal-xterm h-full w-full" />
      </div>
      <div
        className="absolute right-0 top-1/2 transform -translate-y-1/2 flex items-center justify-center bg-accent-4 hover:bg-accent-6 text-white cursor-pointer rounded-l-full w-6 h-12 z-20"
        onClick={toggleClipboard}
        role="button"
        tabIndex={0}
        aria-label={isOpen ? t("common.close", "Close") : t("command_clipboard.title", "Command Clipboard")}
        title={isOpen ? t("common.close", "Close") : t("command_clipboard.title", "Command Clipboard")}
      >
        {isOpen ? ">" : "<"}
      </div>
    </div>
  );
};

const Divider: React.FC<{
  onMouseDown: (e: React.MouseEvent | React.TouchEvent) => void;
}> = ({ onMouseDown }) => (
  <div
    className="h-full bg-accent-2 cursor-col-resize hover:bg-accent-4"
    style={{ width: 8 }}
    onMouseDown={onMouseDown}
    onTouchStart={onMouseDown}
  />
);

const remoteJoin = (directory: string, name: string) => {
  if (!directory) return name;
  const separator = directory.includes("\\") ? "\\" : "/";
  return directory.endsWith("/") || directory.endsWith("\\")
    ? `${directory}${name}`
    : `${directory}${separator}${name}`;
};

const remoteBaseName = (path: string) => path.split(/[\\/]/).filter(Boolean).at(-1) || "download";

const FileManagerPanel: React.FC<{
  connected: boolean;
  request: (input: FileCommandInput) => Promise<FileEvent[]>;
}> = ({ connected, request }) => {
  const uploadRef = useRef<HTMLInputElement>(null);
  const [path, setPath] = useState("");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [parent, setParent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const list = useCallback(async (nextPath: string) => {
    if (!connected) return;
    setBusy(true);
    setError("");
    try {
      const [event] = await request({ operation: FileOperation.LIST, path: nextPath });
      setPath(nextPath || event.parent);
      setParent(event.parent);
      setEntries(event.entries);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }, [connected, request]);

  useEffect(() => {
    if (connected) void list("");
  }, [connected, list]);

  const mutate = async (input: FileCommandInput) => {
    setBusy(true);
    setError("");
    try {
      await request(input);
      await list(path);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const createEntry = (directory: boolean) => {
    const name = window.prompt(directory ? "Directory name" : "File name")?.trim();
    if (!name) return;
    void mutate({
      operation: directory ? FileOperation.MKDIR : FileOperation.CREATE,
      path: remoteJoin(path, name),
    });
  };

  const rename = (entry: FileEntry) => {
    const name = window.prompt("New name", entry.name)?.trim();
    if (!name || name === entry.name) return;
    void mutate({ operation: FileOperation.RENAME, path: entry.path, destination: remoteJoin(path, name) });
  };

  const copy = (entry: FileEntry) => {
    const destination = window.prompt("Copy destination", `${entry.path}.copy`)?.trim();
    if (!destination) return;
    void mutate({ operation: FileOperation.COPY, path: entry.path, destination });
  };

  const remove = (entry: FileEntry) => {
    if (!window.confirm(`Delete ${entry.path}?`)) return;
    void mutate({ operation: FileOperation.DELETE, path: entry.path, recursive: entry.directory });
  };

  const upload = async (file: File) => {
    setBusy(true);
    setError("");
    try {
      const destination = remoteJoin(path, file.name);
      const [started] = await request({
        operation: FileOperation.UPLOAD_START,
        path: destination,
        size: BigInt(file.size),
        overwrite: false,
      });
      if (!started.uploadId) throw new Error("Agent did not create an upload session");
      const bytes = new Uint8Array(await file.arrayBuffer());
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
      const sha256 = Array.from(digest, (value) => value.toString(16).padStart(2, "0")).join("");
      const chunkSize = 256 * 1024;
      for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        await request({
          operation: FileOperation.UPLOAD_CHUNK,
          uploadId: started.uploadId,
          data: bytes.slice(offset, Math.min(offset + chunkSize, bytes.length)),
        });
      }
      await request({ operation: FileOperation.UPLOAD_FINISH, uploadId: started.uploadId, sha256 });
      await list(path);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
      if (uploadRef.current) uploadRef.current.value = "";
    }
  };

  const download = async (entry: FileEntry) => {
    setBusy(true);
    setError("");
    try {
      const events = await request({ operation: FileOperation.DOWNLOAD, path: entry.path });
      const parts = events
        .filter((event) => event.data.length > 0)
        .map((event) => event.data.buffer.slice(event.data.byteOffset, event.data.byteOffset + event.data.byteLength) as ArrayBuffer);
      const blob = new Blob(parts);
      const completed = events.at(-1);
      if (completed?.sha256) {
        const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()));
        const actual = Array.from(digest, (value) => value.toString(16).padStart(2, "0")).join("");
        if (actual !== completed.sha256.toLowerCase()) {
          throw new Error("Downloaded file checksum mismatch");
        }
      }
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = remoteBaseName(entry.path);
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Flex direction="column" gap="2" className="h-full min-h-0 p-2">
      <Flex gap="1" align="center">
        <IconButton size="1" variant="soft" disabled={!connected || busy} onClick={() => void list(path)} title="Refresh"><RefreshCw size={14} /></IconButton>
        <IconButton size="1" variant="soft" disabled={!connected || busy} onClick={() => createEntry(true)} title="New directory"><FolderPlus size={14} /></IconButton>
        <IconButton size="1" variant="soft" disabled={!connected || busy} onClick={() => createEntry(false)} title="New file"><FilePlus2 size={14} /></IconButton>
        <IconButton size="1" variant="soft" disabled={!connected || busy} onClick={() => uploadRef.current?.click()} title="Upload"><Upload size={14} /></IconButton>
        <input ref={uploadRef} type="file" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }} />
      </Flex>
      <TextField.Root value={path} disabled={!connected || busy} placeholder="Remote path" onChange={(event) => setPath(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void list(path); }} />
      {error ? <Text size="1" color="red">{error}</Text> : null}
      <div className="min-h-0 flex-1 overflow-auto">
        {parent ? (
          <button type="button" className="w-full px-2 py-1 text-left hover:bg-accent-3" onClick={() => void list(parent)}>../</button>
        ) : null}
        {entries.map((entry) => (
          <Flex key={entry.path} align="center" justify="between" gap="2" className="border-b border-gray-7 px-2 py-1">
            <button type="button" className="min-w-0 flex-1 truncate text-left" onDoubleClick={() => { if (entry.directory) void list(entry.path); }} title={entry.path}>
              {entry.directory ? `${entry.name}/` : entry.name}
            </button>
            <Flex gap="1">
              {!entry.directory ? <IconButton size="1" variant="ghost" onClick={() => void download(entry)} disabled={busy} title="Download"><Download size={13} /></IconButton> : null}
              <IconButton size="1" variant="ghost" onClick={() => rename(entry)} disabled={busy} title="Rename"><Pencil size={13} /></IconButton>
              <IconButton size="1" variant="ghost" onClick={() => copy(entry)} disabled={busy} title="Copy"><Copy size={13} /></IconButton>
              <IconButton size="1" variant="ghost" color="red" onClick={() => remove(entry)} disabled={busy} title="Delete"><Trash2 size={13} /></IconButton>
            </Flex>
          </Flex>
        ))}
      </div>
    </Flex>
  );
};

const SidePanel: React.FC<{
  connected: boolean;
  requestFile: (input: FileCommandInput) => Promise<FileEvent[]>;
}> = ({ connected, requestFile }) => (
  <div className="km-terminal-clipboard h-screen p-2 min-w-64" style={{ flex: 1 }}>
    <Tabs.Root defaultValue="commands" className="flex h-full flex-col">
      <Tabs.List>
        <Tabs.Trigger value="commands">Commands</Tabs.Trigger>
        <Tabs.Trigger value="files">Files</Tabs.Trigger>
      </Tabs.List>
      <Tabs.Content value="commands" className="min-h-0 flex-1"><CommandClipboardPanel className="h-full w-full" /></Tabs.Content>
      <Tabs.Content value="files" className="min-h-0 flex-1"><FileManagerPanel connected={connected} request={requestFile} /></Tabs.Content>
    </Tabs.Root>
  </div>
);

const TerminalPage = () => {
  const {
    settings,
    loading: settingsLoading,
    error: settingsError,
  } = useXtermjsSettings();
  const terminalRef = useRef<HTMLDivElement>(null);
  const terminalInstance = useRef<Terminal | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const sessionControllerRef = useRef<AbortController | null>(null);
  const sessionSequenceRef = useRef(0n);
  const sessionCommandQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const pendingFileRequestsRef = useRef(new Map<string, PendingFileRequest>());
  const resolvedSettingsRef = useRef<XtermjsSettings>(defaultXtermjsSettings);
  const initializedUuidRef = useRef<string | null>(null);
  const params = new URLSearchParams(window.location.search);
  const uuid = params.get("uuid");
  const [t] = useTranslation();
  const disconnectMessageRef = useRef(t("terminal.disconnect"));
  const firstBinary = useRef(false);
  const [isClipboardOpen, setIsClipboardOpen] = useState(false);
  const [leftWidth, setLeftWidth] = useState<number>(window.innerWidth * 0.7);
  const draggingRef = useRef(false);
  const fitAddonRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [callout, setCallout] = useState(
    window.location.protocol !== "https:"
  );
  const [settingsResolved, setSettingsResolved] = useState(false);
  const [settingsResolutionError, setSettingsResolutionError] =
    useState<Error | null>(null);
  const [appearance, setAppearance] = useState<CSSProperties>({});
  const [twoFaEnabled, setTwoFaEnabled] = useState(false);
  const [twoFaResolved, setTwoFaResolved] = useState(false);
  const [remoteAgentReady, setRemoteAgentReady] = useState(false);
  const [sessionConnected, setSessionConnected] = useState(false);
  const [otpCode, setOtpCode] = useState<string | null>(null);
  const [otpDialogOpen, setOtpDialogOpen] = useState(false);
  const [otpInput, setOtpInput] = useState("");


  useEffect(() => {
    fetch("/api/me")
      .then((response) => response.json())
      .then((data) => {
        setTwoFaEnabled(Boolean(data?.["2fa_enabled"]));
      })
      .catch(() => {
        setTwoFaEnabled(false);
      })
      .finally(() => {
        setTwoFaResolved(true);
      });
  }, []);

  useEffect(() => {
    if (settingsLoading || settingsResolved) {
      return;
    }

    const resolvedSettings = settingsError
      ? defaultXtermjsSettings
      : settings;

    resolvedSettingsRef.current = resolvedSettings;
    setAppearance({
      "--xterm-padding": `${resolvedSettings.terminalPadding}px`,
    } as CSSProperties);
    setSettingsResolutionError(settingsError);
    setSettingsResolved(true);
  }, [settings, settingsError, settingsLoading, settingsResolved]);

  useEffect(() => {
    disconnectMessageRef.current = t("terminal.disconnect");
  }, [t]);

  const enqueueSessionCommand = useCallback((
    command: (sessionId: string, sequence: bigint, signal: AbortSignal) => Promise<unknown>,
    onError?: (error: Error) => void,
  ) => {
    const sessionId = sessionIdRef.current;
    const controller = sessionControllerRef.current;
    if (!sessionId || !controller || controller.signal.aborted) {
      onError?.(new Error("Remote session is not connected"));
      return;
    }
    sessionSequenceRef.current += 1n;
    const sequence = sessionSequenceRef.current;
    sessionCommandQueueRef.current = sessionCommandQueueRef.current
      .then(() => command(sessionId, sequence, controller.signal))
      .catch((error) => {
        const normalized = error instanceof Error ? error : new Error(String(error));
        onError?.(normalized);
        if (!controller.signal.aborted) {
          terminalInstance.current?.write(`\r\n${normalized.message}\r\n`);
        }
      });
  }, []);

  const requestFile = useCallback((input: FileCommandInput) => {
    const requestId = crypto.randomUUID();
    const command = create(FileCommandSchema, {
      requestId,
      operation: input.operation,
      path: input.path ?? "",
      destination: input.destination ?? "",
      recursive: input.recursive ?? false,
      overwrite: input.overwrite ?? false,
      size: input.size ?? 0n,
      sha256: input.sha256 ?? "",
      uploadId: input.uploadId ?? "",
      data: input.data ?? new Uint8Array(),
    });
    return new Promise<FileEvent[]>((resolve, reject) => {
      pendingFileRequestsRef.current.set(requestId, {
        events: [],
        finishOnComplete:
          input.operation === FileOperation.DOWNLOAD ||
          input.operation === FileOperation.UPLOAD_FINISH,
        resolve,
        reject,
      });
      enqueueSessionCommand(
        (sessionId, sequence, signal) => sendRemoteFileCommand({ sessionId, sequence, command, signal }),
        (error) => {
          pendingFileRequestsRef.current.delete(requestId);
          reject(error);
        },
      );
    });
  }, [enqueueSessionCommand]);

  const resizeTerminal = useCallback(() => {
    fitAddonRef.current?.fit();
    const term = terminalInstance.current;
    if (term) {
      enqueueSessionCommand((sessionId, sequence, signal) => sendRemoteSessionResize({
        sessionId,
        sequence,
        columns: term.cols,
        rows: term.rows,
        signal,
      }));
    }
  }, [enqueueSessionCommand]);

  const startDragging = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      e.preventDefault();
      draggingRef.current = true;
      document.body.style.userSelect = "none";
    },
    []
  );

  const stopDragging = useCallback(() => {
    if (draggingRef.current) {
      draggingRef.current = false;
      document.body.style.userSelect = "";
      resizeTerminal();
    }
  }, [resizeTerminal]);

  // 限制resize onMouseMove 调用频率
  const onMouseMove = useMemo(
    () =>
      throttle((e: MouseEvent | TouchEvent) => {
        if (!draggingRef.current || !containerRef.current) return;

        const containerRect = containerRef.current.getBoundingClientRect();
        let clientX: number;

        if (e instanceof MouseEvent) {
          clientX = e.clientX;
        } else {
          clientX = e.touches[0].clientX;
        }

        const newLeftWidth = clientX - containerRect.left;
        const minWidth = 300;
        const maxWidth = containerRect.width - 300;

        if (newLeftWidth >= minWidth && newLeftWidth <= maxWidth) {
          setLeftWidth(newLeftWidth);
        }
      }, 1000 / 60), // （60fps）
    []
  );

  useEffect(() => {
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", stopDragging);
    document.addEventListener("touchmove", onMouseMove);
    document.addEventListener("touchend", stopDragging);

    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", stopDragging);
      document.removeEventListener("touchmove", onMouseMove);
      document.removeEventListener("touchend", stopDragging);
      onMouseMove.cancel(); // 清理 throttle
    };
  }, [onMouseMove, stopDragging]);

  useEffect(() => {
    if (uuid === null) {
      window.location.href = "/";
      return;
    }
    const controller = new AbortController();
    setRemoteAgentReady(false);
    void listRemoteAgentCapabilities(controller.signal)
      .then((agents) => {
        const agent = agents.find((item) => item.agentId === uuid);
        if (!agent) {
          throw new Error(t("terminal.no_active_connection"));
        }
        if (!agent.capabilities?.webssh?.available) {
          throw new Error(
            agent.capabilities?.webssh?.limitation ||
              t("terminal.no_active_connection"),
          );
        }
        document.title = `${t("terminal.title")} - ${agent.name || t("terminal.title")}`;
        setRemoteAgentReady(true);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setSettingsResolutionError(
          error instanceof Error ? error : new Error(String(error)),
        );
      });
    return () => controller.abort();
  }, [t, uuid]);

  // Trigger OTP dialog when 2FA is enabled
  useEffect(() => {
    if (!settingsResolved || !twoFaResolved) return;
    if (twoFaEnabled && otpCode === null) {
      setOtpDialogOpen(true);
    }
  }, [settingsResolved, twoFaResolved, twoFaEnabled, otpCode]);

  // Connection effect - waits for OTP if 2FA is enabled
  useEffect(() => {
    if (!settingsResolved || !twoFaResolved || !remoteAgentReady || uuid === null || !terminalRef.current) return;
    if (!twoFaEnabled) return;
    if (initializedUuidRef.current === uuid) return;
    if (twoFaEnabled && otpCode === null) return; // Wait for OTP

    initializedUuidRef.current = uuid;
    firstBinary.current = false;
    const snapshot = resolvedSettingsRef.current;
    const terminalOptions: Partial<ITerminalOptions> = {
      cursorBlink: snapshot.terminalOptions.cursorBlink,
      convertEol: snapshot.terminalOptions.convertEol,
      fontFamily: snapshot.terminalOptions.fontFamily,
      fontSize: snapshot.terminalOptions.fontSize,
      macOptionIsMeta: snapshot.terminalOptions.macOptionIsMeta,
      scrollback: snapshot.terminalOptions.scrollback,
    };

    if (snapshot.terminalOptions.theme !== undefined) {
      terminalOptions.theme = snapshot.terminalOptions.theme;
    }
    if (
      snapshot.transparentBackground ||
      isTransparentBackground(snapshot.terminalOptions.theme?.background)
    ) {
      terminalOptions.allowTransparency = true;
    }

    const term = new Terminal(terminalOptions);
    const fitAddon = new FitAddon();
    fitAddonRef.current = fitAddon;
    const webLinksAddon = new WebLinksAddon();
    const searchAddon = new SearchAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.loadAddon(searchAddon);

    term.open(terminalRef.current);
    terminalInstance.current = term;

    const customCssStyle = document.createElement("style");
    customCssStyle.id = "xtermjs-custom-css";
    customCssStyle.textContent = snapshot.customCss;
    document.head.appendChild(customCssStyle);

    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            resizeTerminal();
          })
        : null;

    if (resizeObserver && terminalRef.current) {
      resizeObserver.observe(terminalRef.current);
    }

    let isMounted = true;
    let disposed = false;
    let firstBinaryTimeout: ReturnType<typeof setTimeout> | null = null;

    document.fonts?.ready?.then(() => {
      if (isMounted && !disposed) {
        resizeTerminal();
      }
    });

    const sessionController = new AbortController();
    sessionControllerRef.current = sessionController;
    sessionSequenceRef.current = 0n;
    sessionCommandQueueRef.current = Promise.resolve();
    void (async () => {
      try {
        const started = await createRemoteSession({
          agentId: uuid,
          rows: term.rows,
          columns: term.cols,
          twoFactorCode: otpCode ?? "",
          signal: sessionController.signal,
        });
        if (disposed) return;
        sessionIdRef.current = started.sessionId;
        setSessionConnected(true);
        resizeTerminal();
        for await (const response of watchRemoteSession({ sessionId: started.sessionId, signal: sessionController.signal })) {
          if (disposed || !response.event) continue;
          const event = response.event;
          if (event.event.case === "output") {
            term.write(event.event.value);
            if (!firstBinary.current) {
              firstBinary.current = true;
              firstBinaryTimeout = setTimeout(() => {
                if (disposed) return;
                const active = terminalInstance.current;
                if (active && active.cols > 1) active.resize(active.cols - 1, active.rows);
                resizeTerminal();
              }, 200);
            }
          } else if (event.event.case === "file") {
            const fileEvent = event.event.value;
            const pending = pendingFileRequestsRef.current.get(fileEvent.requestId);
            if (pending) {
              pending.events.push(fileEvent);
              if (!fileEvent.success) {
                pendingFileRequestsRef.current.delete(fileEvent.requestId);
                pending.reject(new Error(fileEvent.error || "Remote file operation failed"));
              } else if (!pending.finishOnComplete || fileEvent.complete) {
                pendingFileRequestsRef.current.delete(fileEvent.requestId);
                pending.resolve(pending.events);
              }
            }
          } else if (event.event.case === "closed") {
            setSessionConnected(false);
            term.write(`\n ${disconnectMessageRef.current}`);
            break;
          }
        }
      } catch (error) {
        setSessionConnected(false);
        if (!disposed && !sessionController.signal.aborted) {
          term.write(`\r\n${error instanceof Error ? error.message : String(error)}\r\n`);
        }
      }
    })();

    const termDataDisposable = term.onData((data) => {
      if (disposed) {
        return;
      }
      const encoded = new TextEncoder().encode(data);
      enqueueSessionCommand((sessionId, sequence, signal) => sendRemoteSessionInput({ sessionId, sequence, data: encoded, signal }));
    });

    const handleResize = () => {
      resizeTerminal();
    };
    window.addEventListener("resize", handleResize);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey) {
        if (e.key === "f" || e.key === "d") {
          searchAddon.findNext("");
          e.preventDefault();
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);

    const handleContextMenu = (e: MouseEvent) => {
      if (e.ctrlKey || !sessionIdRef.current) {
        return;
      }
      const selection = window.getSelection();
      const hasSelection = selection && selection.toString().length > 0;
      if (hasSelection) {
        e.preventDefault();
        const selectedText = selection.toString();
        navigator.clipboard.writeText(selectedText).finally(() => {
          if (disposed) {
            return;
          }
          term.focus();
          term.clearSelection();
        });
      } else {
        e.preventDefault();
        term.focus();
        navigator.clipboard.readText().then((text) => {
          if (disposed || !sessionIdRef.current) {
            return;
          }
          const encoded = new TextEncoder().encode(text.replace(/\r?\n/g, "\r"));
          enqueueSessionCommand((sessionId, sequence, signal) => sendRemoteSessionInput({ sessionId, sequence, data: encoded, signal }));
        });
      }
    };

    document.addEventListener("contextmenu", handleContextMenu);

    return () => {
      disposed = true;
      isMounted = false;
      const closingSession = sessionIdRef.current;
      setSessionConnected(false);
      sessionController.abort();
      for (const pending of pendingFileRequestsRef.current.values()) {
        pending.reject(new Error("Remote session closed"));
      }
      pendingFileRequestsRef.current.clear();
      if (closingSession) {
        void closeRemoteSession({ sessionId: closingSession, reason: "browser page closed", signal: AbortSignal.timeout(10_000) });
      }
      resizeObserver?.disconnect();
      if (firstBinaryTimeout !== null) {
        clearTimeout(firstBinaryTimeout);
      }
      termDataDisposable.dispose();
      term.dispose();
      if (customCssStyle.parentNode) {
        customCssStyle.parentNode.removeChild(customCssStyle);
      }
      if (initializedUuidRef.current === uuid) {
        initializedUuidRef.current = null;
      }
      terminalInstance.current = null;
      sessionIdRef.current = null;
      sessionControllerRef.current = null;
      fitAddonRef.current = null;
      window.removeEventListener("resize", handleResize);
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("contextmenu", handleContextMenu);
    };
  }, [settingsResolved, twoFaEnabled, twoFaResolved, remoteAgentReady, otpCode, uuid, resizeTerminal, enqueueSessionCommand, t]);

  const submitOtp = useCallback(() => {
    if (!otpInput) return;
    setOtpCode(otpInput);
    setOtpDialogOpen(false);
  }, [otpInput]);


  // 移除对 leftWidth 的直接依赖，改用防抖
  useEffect(() => {
    if (!fitAddonRef.current) return;
    const debouncedResize = setTimeout(() => {
      resizeTerminal();
    }, 100);
    return () => clearTimeout(debouncedResize);
  }, [isClipboardOpen, resizeTerminal]);

  const sendCommand = useCallback((cmd: string) => {
    const encoded = new TextEncoder().encode(cmd + "\r");
    enqueueSessionCommand((sessionId, sequence, signal) => sendRemoteSessionInput({ sessionId, sequence, data: encoded, signal }));
  }, [enqueueSessionCommand]);

  return (
    <TerminalContext.Provider
      value={{ terminal: terminalInstance.current, sendCommand }}
    >
      <Theme appearance="dark" className="km-page-terminal">
        <Toaster theme="dark" />
        {twoFaResolved && !twoFaEnabled ? (
          <div className="absolute left-1/2 top-4 z-40 w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2">
            <Callout.Root color="red" size="2">
              <Callout.Icon><TablerAlertTriangleFilled /></Callout.Icon>
              <Callout.Text>
                <Flex align="center" justify="between" gap="3">
                  <span>{t("exec.errors.twoFactorRequired", "请先配置双重验证")}</span>
                  <Button size="1" variant="soft" onClick={() => { window.location.href = "/admin/account"; }}>
                    {t("common.settings", "设置")}
                  </Button>
                </Flex>
              </Callout.Text>
            </Callout.Root>
          </div>
        ) : null}
        {settingsResolutionError ? (
          <div className="absolute left-4 top-4 z-30 max-w-[32rem]">
            <Callout.Root
              color="red"
              size="2"
              className="bg-red-50 backdrop-blur-sm border-2 border-red-800 rounded-lg"
            >
              <Callout.Icon>
                <TablerAlertTriangleFilled className="text-red-700" />
              </Callout.Icon>
              <Callout.Text className="text-red-400 font-medium">
                <Flex align="center" justify="between" gap="3">
                  <span>
                    xterm settings fallback: {settingsResolutionError.message}
                  </span>
                </Flex>
              </Callout.Text>
            </Callout.Root>
          </div>
        ) : null}
        <div className="absolute inset-x-0 top-4 flex justify-center items-center z-30">
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            transition={{ duration: 0.3, ease: "easeInOut" }}
            hidden={!callout}
          >
            <Callout.Root
              color="red"
              size="2"
              className="bg-red-50 backdrop-blur-sm border-2 border-red-800 rounded-lg"
            >
              <Callout.Icon>
                <TablerAlertTriangleFilled className="text-red-700" />
              </Callout.Icon>
              <Callout.Text className="text-red-400 font-medium">
                <Flex align="center" justify="between" gap="3">
                  <span>{t("warn_https")}</span>
                  <IconButton
                    variant="soft"
                    color="red"
                    size="1"
                    className="hover:bg-red-200/50 transition-colors"
                    onClick={() => setCallout(false)}
                  >
                    <Cross1Icon />
                  </IconButton>
                </Flex>
              </Callout.Text>
            </Callout.Root>
          </motion.div>
        </div>
        <Flex className="h-screen w-screen" direction="row" ref={containerRef}>
          <TerminalArea
            terminalRef={terminalRef}
            toggleClipboard={() => setIsClipboardOpen(!isClipboardOpen)}
            width={isClipboardOpen ? `${leftWidth}px` : "100%"}
            isOpen={isClipboardOpen}
            appearance={appearance}
          />
          {isClipboardOpen && <Divider onMouseDown={startDragging} />}
          {isClipboardOpen && <SidePanel connected={sessionConnected} requestFile={requestFile} />}
        </Flex>
        <Dialog.Root
          open={otpDialogOpen}
          onOpenChange={(open) => {
            // 阻止在未输入验证码时关闭
            if (!open && otpCode === null) {
              return;
            }
            setOtpDialogOpen(open);
          }}
        >
          <Dialog.Content maxWidth="400px">
            <Dialog.Title>{t("login.two_factor")}</Dialog.Title>
            <Dialog.Description size="2" mb="3">
              {t("account.2fa_otp_input_prompt")}
            </Dialog.Description>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submitOtp();
              }}
            >
              <Flex direction="column" gap="3">
                <TextField.Root
                  type="number"
                  autoFocus
                  value={otpInput}
                  placeholder="123456"
                  onChange={(e) => setOtpInput(e.target.value)}
                />
                <Flex gap="3" justify="end">
                  <Button
                    variant="soft"
                    color="gray"
                    type="button"
                    onClick={() => {
                      window.location.href = "/";
                    }}
                  >
                    {t("common.cancel")}
                  </Button>
                  <Button type="submit" disabled={!otpInput}>
                    {t("common.confirm")}
                  </Button>
                </Flex>
              </Flex>
            </form>
          </Dialog.Content>
        </Dialog.Root>
      </Theme>

    </TerminalContext.Provider>
  );
};

export default TerminalPage;
