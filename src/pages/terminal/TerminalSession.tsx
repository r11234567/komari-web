import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Terminal } from "@xterm/xterm";
import type { ITerminalOptions } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Button,
  Dialog,
  Flex,
  TextArea,
} from "@radix-ui/themes";
import {
  closeRemoteSession,
  createRemoteSession,
  sendRemoteSessionInput,
  sendRemoteSessionResize,
  watchRemoteSession,
} from "@/api/connect/remote";
import {
  readTextFromClipboard,
  terminalKeyAction,
} from "@/utils/terminalClipboard";
import { createTerminalCommandQueue } from "@/utils/terminalTransport";
import { ensureWorkspace, workspaceState } from "@/api/connect/workspace";
import WorkspaceSurface from "./WorkspaceSurface";
import { writeClipboardText } from "@/utils/clipboard";
import {
  DEFAULT_TERMINAL_OPTIONS,
  DEFAULT_TERMINAL_PADDING,
} from "./terminalDefaults";

export interface TerminalSessionApi {
  terminal: Terminal;
  searchAddon: SearchAddon;
  send: (data: string | Uint8Array) => void;
  fit: () => void;
  exportText: () => string;
}

interface TerminalSessionProps {
  uuid: string;
  active: boolean;
  fontSize?: number;
  padding?: number;
  options?: Partial<ITerminalOptions>;
  transparentBackground?: boolean;
  twoFaEnabled: boolean;
  disconnectMessage: string;
  onApiChange: (api: TerminalSessionApi | null) => void;
}

export const TerminalSession = ({
  uuid,
  active,
  fontSize = DEFAULT_TERMINAL_OPTIONS.fontSize,
  padding = DEFAULT_TERMINAL_PADDING,
  options,
  transparentBackground = false,
  disconnectMessage,
  onApiChange,
}: TerminalSessionProps) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef(active);
  const disconnectMessageRef = useRef(disconnectMessage);
  const onApiChangeRef = useRef(onApiChange);
  const apiRef = useRef<TerminalSessionApi | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const { t } = useTranslation();

  const startRef = useRef<(() => void) | null>(null);
  const [manualPasteOpen, setManualPasteOpen] = useState(false);
  const [manualPasteText, setManualPasteText] = useState("");

  const pendingSendRef = useRef<((data: string | Uint8Array) => void) | null>(null);

  activeRef.current = active;

  useEffect(() => {
    disconnectMessageRef.current = disconnectMessage;
  }, [disconnectMessage]);

  useEffect(() => {
    onApiChangeRef.current = onApiChange;
  }, [onApiChange]);

  useEffect(() => {
    if (!hostRef.current) return;

    const themeWithSelection = {
      selectionBackground: "#ffffff",
      selectionForeground: "#000000",
      selectionInactiveBackground: "#ffffff",
      scrollbarSliderBackground: "#555555",
      scrollbarSliderHoverBackground: "#777777",
      scrollbarSliderActiveBackground: "#888888",
    };

    const terminalOptions: Partial<ITerminalOptions> = {
      ...DEFAULT_TERMINAL_OPTIONS,
      ...optionsRef.current,
      cursorStyle: "bar",
      cursorInactiveStyle: "bar",
      cursorWidth: 2,
      allowProposedApi: true,
      disableStdin: true,
      overviewRuler: { width: 4 },
      allowTransparency: true,
      theme: { ...themeWithSelection, ...optionsRef.current?.theme },
    };

    const term = new Terminal(terminalOptions);
    const fitAddon = new FitAddon();
    const searchAddon = new SearchAddon();
    const webLinksAddon = new WebLinksAddon();
    const host = hostRef.current;

    let disposed = false;
    let sessionId: string | null = null;
    const sessionController = new AbortController();

    term.loadAddon(fitAddon);
    term.loadAddon(searchAddon);
    term.loadAddon(webLinksAddon);
    term.open(host);

    const fit = () => {
      if (disposed || !hostRef.current || !activeRef.current) return;
      try {
        fitAddon.fit();
      } catch {
        // ignore
      }
    };

    let commands: ReturnType<typeof createTerminalCommandQueue> | undefined;
    const createCommands = () => createTerminalCommandQueue({
      signal: sessionController.signal,
      input: (sequence, data) => sendRemoteSessionInput({
        sessionId: sessionId!, sequence, data, signal: sessionController.signal,
      }),
      resize: (sequence, rows, columns) => sendRemoteSessionResize({
        sessionId: sessionId!, sequence, rows, columns, signal: sessionController.signal,
      }),
      onError: (error) => {
        term.options.disableStdin = true;
        const message = error instanceof Error ? error.message : String(error);
        term.write(`\r\n${message}\r\n`);
        commands?.dispose();
      },
    });
    const send = (data: string | Uint8Array) => {
      if (disposed || !sessionId) return;
      commands?.input(typeof data === "string" ? new TextEncoder().encode(data) : data);
    };
    pendingSendRef.current = send;

    let starting = false;
    let connectionToken: string | undefined;

    const startSession = async () => {
      if (disposed || starting || sessionId || !activeRef.current) return;
      const grant = workspaceState.grants.get(uuid);
      if ((!grant || !workspaceState.valid(grant)) && workspaceState.revision(uuid) > 0) return;
      starting = true;
      commands = createCommands();
      try {
        const authorized = await ensureWorkspace(uuid, sessionController.signal);
        // Capture before create: a failed create must not become a hot retry
        // loop merely because connectionToken was never initialized.
        connectionToken = authorized.token;
        if (screenUser && screenUser !== authorized.systemUser) term.reset();
        fit();
        const started = await createRemoteSession({
          agentId: uuid,
          rows: term.rows || 24,
          columns: term.cols || 80,
          signal: sessionController.signal,
        });
        if (disposed) {
          void closeRemoteSession({
            sessionId: started.sessionId,
            reason: "tab_closed",
            signal: AbortSignal.timeout(3000),
          }).catch(() => {});
          return;
        }
        sessionId = started.sessionId;
        connectionToken = workspaceState.grants.get(uuid)?.token;
        const currentGrant = workspaceState.grants.get(uuid);
        if (currentGrant) {
          if (screenUser && screenUser !== currentGrant.systemUser) term.reset();
          screenUser = currentGrant.systemUser;
          window.clearTimeout(screenDeadline);
          screenDeadline = window.setTimeout(() => { term.reset(); screenDeadline = 0; }, Math.max(0, currentGrant.expiresAt - Date.now()));
        }
        term.options.disableStdin = false;
        if (activeRef.current) term.focus();

        for await (const response of watchRemoteSession({
          sessionId: started.sessionId,
          signal: sessionController.signal,
        })) {
          if (disposed || !response.event) continue;
          const event = response.event;
          if (event.event.case === "output") {
            term.write(event.event.value);
          } else if (event.event.case === "closed") {
            sessionId = null;
            term.write(`\r\n${disconnectMessageRef.current}\r\n`);
            break;
          }
        }
      } catch (error) {
        if (!disposed && !sessionController.signal.aborted) {
          const msg = error instanceof Error ? error.message : String(error);
          term.write(`\r\n${msg}\r\n`);
        }
      } finally {
        commands?.dispose();
        starting = false;
        if (!disposed) {
          if (sessionId) {
            void closeRemoteSession({
              sessionId,
              reason: "stream_closed",
              signal: AbortSignal.timeout(3000),
            }).catch(() => {});
          }
          sessionId = null;
          term.options.disableStdin = true;
          const current = workspaceState.grants.get(uuid);
          if (connectionToken && current && workspaceState.valid(current) && current.token !== connectionToken) void startSession();
        }
      }
    };
    let screenDeadline = 0;
    let screenUser = "";
    startRef.current = () => { void startSession(); };
    const unsubscribe = workspaceState.subscribe(() => {
      const grant = workspaceState.grants.get(uuid);
      if (!grant || !workspaceState.valid(grant)) term.options.disableStdin = true;
      else void startSession();
    });
    void startSession();

    term.onData((data) => {
      send(data);
    });

    term.onResize(({ rows, cols }) => {
      if (!sessionId || disposed) return;
      commands?.resize(rows, cols);
    });

    const copySelection = async () => {
      const selectedText = term.getSelection();
      if (!selectedText) {
        toast.info(t("terminal.select_content_first", "请先选中要复制的内容"));
        term.focus();
        return;
      }
      try {
        const result = await writeClipboardText(selectedText);
        if (result.confirmed) {
          toast.success(t("terminal.copied", "已复制到系统剪贴板"));
        } else {
          toast.info(t("terminal.copy_unconfirmed", "已尝试复制，浏览器无法确认系统剪贴板内容，请粘贴检查"));
        }
        term.clearSelection();
      } catch {
        toast.error(
          t(
            "terminal.copy_denied",
            "浏览器拒绝了剪贴板写入，请使用 HTTPS 访问",
          ),
        );
      }
      term.focus();
    };

    const pasteFromClipboard = async () => {
      const text = await readTextFromClipboard();
      if (text === null) {
        setManualPasteText("");
        setManualPasteOpen(true);
        return;
      }
      term.paste(text);
      term.focus();
    };

    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown") return true;
      const decision = terminalKeyAction(event, term.hasSelection());
      if (decision.action === "copy") {
        event.preventDefault();
        event.stopPropagation();
        void copySelection();
        return false;
      }
      if (decision.action === "paste") {
        if (decision.explicit) {
          event.preventDefault();
          event.stopPropagation();
          void pasteFromClipboard();
          return false;
        }
        return false;
      }
      if (decision.action === "send") {
        event.stopPropagation();
        if (!decision.keepBrowserCopy) {
          event.preventDefault();
          send(new Uint8Array([decision.byte]));
          return false;
        }
      }
      return true;
    });

    const exportText = () => {
      const buffer = term.buffer.active;
      const lines: string[] = [];
      for (let i = 0; i < buffer.length; i++) {
        const line = buffer.getLine(i);
        if (line) lines.push(line.translateToString(true));
      }
      while (lines.length > 0 && lines[lines.length - 1] === "") {
        lines.pop();
      }
      return lines.join("\n");
    };

    const api: TerminalSessionApi = {
      terminal: term,
      searchAddon,
      send,
      fit,
      exportText,
    };
    apiRef.current = api;
    onApiChangeRef.current(api);

    requestAnimationFrame(() => {
      fit();
      if (activeRef.current) term.focus();
    });

    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => fit())
        : null;
    resizeObserver?.observe(host);

    return () => {
      disposed = true;
      startRef.current = null;
      unsubscribe();
      window.clearTimeout(screenDeadline);
      pendingSendRef.current = null;
      apiRef.current = null;
      commands?.dispose();
      sessionController.abort();
      if (sessionId) {
        void closeRemoteSession({
          sessionId,
          reason: "tab_closed",
          signal: AbortSignal.timeout(3000),
        }).catch(() => {});
      }
      resizeObserver?.disconnect();
      onApiChangeRef.current(null);
      term.dispose();
    };
  }, [t, uuid]);

  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    api.terminal.options = {
      ...DEFAULT_TERMINAL_OPTIONS,
      ...options,
      fontSize: options?.fontSize ?? fontSize,
      theme: {
        ...api.terminal.options.theme,
        ...options?.theme,
        background: transparentBackground ? "transparent" : (options?.theme?.background ?? "#000000"),
      },
    };
    api.fit();
  }, [fontSize, options, transparentBackground]);

  useEffect(() => {
    if (active) {
      startRef.current?.();
      requestAnimationFrame(() => {
        apiRef.current?.fit();
        apiRef.current?.terminal.focus();
      });
    }
  }, [active]);

  const style: CSSProperties = {
    display: active ? "block" : "none",
    padding: `${padding}px`,
    background: transparentBackground ? "transparent" : (options?.theme?.background ?? "#000000"),
  };

  return (
    <WorkspaceSurface agentId={uuid} active={active}>
      <div
        ref={hostRef}
        data-workspace-agent={uuid}
        className="km-terminal-session relative h-full w-full overflow-hidden bg-[#000000]"
        style={style}
        onPaste={(event) => {
          const text = event.clipboardData?.getData("text/plain");
          if (text) {
            event.preventDefault();
            apiRef.current?.terminal.paste(text);
          }
        }}
      />

      {/* Manual Paste Fallback Dialog */}
      <Dialog.Root open={manualPasteOpen} onOpenChange={setManualPasteOpen}>
        <Dialog.Content maxWidth="480px">
          <Dialog.Title>{t("terminal.paste_title", "粘贴文本到终端")}</Dialog.Title>
          <Dialog.Description size="2" mb="3">
            {t(
              "terminal.paste_description",
              "当前环境无法直接访问系统剪贴板，请在此处粘贴：",
            )}
          </Dialog.Description>
          <Flex direction="column" gap="3">
            <TextArea
              autoFocus
              rows={6}
              value={manualPasteText}
              onChange={(e) => setManualPasteText(e.target.value)}
              placeholder={t("terminal.paste_placeholder", "在此处粘贴文本...")}
            />
            <Flex gap="3" justify="end">
              <Button
                variant="soft"
                color="gray"
                onClick={() => setManualPasteOpen(false)}
              >
                {t("common.cancel", "取消")}
              </Button>
              <Button
                onClick={() => {
                  if (manualPasteText) {
                    apiRef.current?.terminal.paste(manualPasteText);
                  }
                  setManualPasteOpen(false);
                }}
              >
                {t("common.paste", "发送到终端")}
              </Button>
            </Flex>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>
    </WorkspaceSurface>
  );
};

export default TerminalSession;
