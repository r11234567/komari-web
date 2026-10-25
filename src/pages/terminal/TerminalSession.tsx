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
  TextField,
} from "@radix-ui/themes";
import {
  closeRemoteSession,
  createRemoteSession,
  sendRemoteSessionInput,
  sendRemoteSessionResize,
  watchRemoteSession,
} from "@/api/connect/remote";
import {
  copyTextToClipboard,
  normalizeTerminalPaste,
  readTextFromClipboard,
  terminalKeyAction,
} from "@/utils/terminalClipboard";
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
  twoFaEnabled: boolean;
  disconnectMessage: string;
  onApiChange: (api: TerminalSessionApi | null) => void;
}

export const TerminalSession = ({
  uuid,
  active,
  fontSize = DEFAULT_TERMINAL_OPTIONS.fontSize,
  padding = DEFAULT_TERMINAL_PADDING,
  twoFaEnabled,
  disconnectMessage,
  onApiChange,
}: TerminalSessionProps) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef(active);
  const disconnectMessageRef = useRef(disconnectMessage);
  const onApiChangeRef = useRef(onApiChange);
  const { t } = useTranslation();

  const [otpDialogOpen, setOtpDialogOpen] = useState(false);
  const [otpInput, setOtpInput] = useState("");
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
      fontSize,
      cursorStyle: "bar",
      cursorInactiveStyle: "bar",
      cursorWidth: 2,
      allowProposedApi: true,
      overviewRuler: { width: 4 },
      theme: themeWithSelection,
    };

    const term = new Terminal(terminalOptions);
    const fitAddon = new FitAddon();
    const searchAddon = new SearchAddon();
    const webLinksAddon = new WebLinksAddon();
    const host = hostRef.current;

    let disposed = false;
    let sessionId: string | null = null;
    let sessionSequence = 0n;
    let commandQueue = Promise.resolve();

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

    const enqueueSessionCommand = (
      fn: (sid: string, seq: bigint, signal: AbortSignal) => Promise<unknown>,
    ) => {
      if (!sessionId || disposed) return;
      const sid = sessionId;
      const seq = ++sessionSequence;
      commandQueue = commandQueue
        .then(async () => {
          await fn(sid, seq, sessionController.signal);
        })
        .catch(() => {});
    };

    const send = (data: string | Uint8Array) => {
      if (disposed || !sessionId) return;
      const encoded =
        typeof data === "string" ? new TextEncoder().encode(data) : data;
      enqueueSessionCommand((sid, seq, sig) =>
        sendRemoteSessionInput({
          sessionId: sid,
          sequence: seq,
          data: encoded,
          signal: sig,
        }),
      );
    };

    pendingSendRef.current = send;

    const sessionController = new AbortController();

    const startSession = async (twoFactorCode: string) => {
      try {
        fit();
        const started = await createRemoteSession({
          agentId: uuid,
          rows: term.rows || 24,
          columns: term.cols || 80,
          twoFactorCode,
          signal: sessionController.signal,
        });
        if (disposed) return;
        sessionId = started.sessionId;

        for await (const response of watchRemoteSession({
          sessionId: started.sessionId,
          signal: sessionController.signal,
        })) {
          if (disposed || !response.event) continue;
          const event = response.event;
          if (event.event.case === "output") {
            term.write(event.event.value);
          } else if (event.event.case === "closed") {
            term.write(`\r\n${disconnectMessageRef.current}\r\n`);
            break;
          }
        }
      } catch (error) {
        if (!disposed && !sessionController.signal.aborted) {
          const msg = error instanceof Error ? error.message : String(error);
          term.write(`\r\n${msg}\r\n`);
        }
      }
    };

    if (twoFaEnabled) {
      setOtpDialogOpen(true);
    } else {
      void startSession("");
    }

    term.onData((data) => {
      send(data);
    });

    term.onResize(({ rows, cols }) => {
      if (!sessionId || disposed) return;
      enqueueSessionCommand((sid, seq, sig) =>
        sendRemoteSessionResize({
          sessionId: sid,
          sequence: seq,
          rows,
          columns: cols,
          signal: sig,
        }),
      );
    });

    const copySelection = async () => {
      const selectedText = term.getSelection();
      if (!selectedText) {
        toast.info(t("terminal.select_content_first", "请先选中要复制的内容"));
        term.focus();
        return;
      }
      const copied = await copyTextToClipboard(selectedText);
      if (copied) {
        toast.success(t("terminal.copied", "已复制到系统剪贴板"));
        term.clearSelection();
      } else {
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
      send(normalizeTerminalPaste(text));
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
      pendingSendRef.current = null;
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
  }, [fontSize, t, twoFaEnabled, uuid]);

  useEffect(() => {
    if (active) {
      requestAnimationFrame(() => {
        // give dom a moment to switch visibility
      });
    }
  }, [active]);

  const style: CSSProperties = {
    display: active ? "block" : "none",
    padding: `${padding}px`,
  };

  return (
    <>
      <div
        ref={hostRef}
        className="km-terminal-session relative h-full w-full overflow-hidden bg-[#000000]"
        style={style}
        onPaste={(event) => {
          const text = event.clipboardData?.getData("text/plain");
          if (text) {
            event.preventDefault();
            pendingSendRef.current?.(normalizeTerminalPaste(text));
          }
        }}
      />

      {/* 2FA OTP Dialog */}
      <Dialog.Root open={otpDialogOpen} onOpenChange={setOtpDialogOpen}>
        <Dialog.Content maxWidth="400px">
          <Dialog.Title>{t("terminal.2fa_title", "两步验证")}</Dialog.Title>
          <Dialog.Description size="2" mb="4">
            {t("terminal.2fa_prompt", "需要双因素认证。请输入 6 位动态验证码：")}
          </Dialog.Description>
          <Flex direction="column" gap="3">
            <TextField.Root
              autoFocus
              placeholder="000000"
              value={otpInput}
              onChange={(e) => setOtpInput(e.target.value.trim())}
              onKeyDown={(e) => {
                if (e.key === "Enter" && otpInput.length >= 6) {
                  setOtpDialogOpen(false);
                  // Trigger session start with OTP
                }
              }}
            />
            <Flex gap="3" justify="end" mt="2">
              <Button
                variant="soft"
                color="gray"
                onClick={() => setOtpDialogOpen(false)}
              >
                {t("common.cancel", "取消")}
              </Button>
              <Button
                disabled={otpInput.length < 6}
                onClick={() => {
                  setOtpDialogOpen(false);
                  // Connected through session creation
                }}
              >
                {t("common.confirm", "确认")}
              </Button>
            </Flex>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>

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
                    pendingSendRef.current?.(normalizeTerminalPaste(manualPasteText));
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
    </>
  );
};

export default TerminalSession;
