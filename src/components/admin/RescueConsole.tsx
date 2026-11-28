import { createStreamOutputDecoder } from "@/utils/streamOutput";
import * as React from "react";
import { create } from "@bufbuild/protobuf";
import { durationFromMs, timestampDate } from "@bufbuild/protobuf/wkt";
import {
  OperationState,
  TwoFactorProofSchema,
} from "@komari/proto/komari/common/v1/common_pb";
import {
  RescueAction,
  NetworkIsolationMode,
  ExpiryMechanism,
  type RescueHelperStatus,
  type RescueSession,
  type TemporarySSHAccess,
} from "@komari/proto/komari/rescue/v1/rescue_pb";
import {
  Button,
  Card,
  Flex,
  Link,
  Select,
  Text,
  TextArea,
  TextField,
} from "@radix-ui/themes";
import { Power, RefreshCw, ShieldAlert, Square } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import SensitiveActionDialog, { type SensitiveAction } from "@/components/SensitiveActionDialog";
import {
  DEFAULT_RESCUE_MAX_OUTPUT_BYTES,
  DEFAULT_RESCUE_TIMEOUT_SECONDS,
  rescueCredentialTargets,
  type RescueCredentialSpec,
} from "@/utils/credentialAction";
import { connectUnary } from "@/api/connect/client";
import { DEFAULT_STREAM_DEADLINE_MS } from "@/api/connect/deadline";
import { useConnect } from "@/contexts/ConnectContext";
import { temporarySSHHelpURL } from "@/utils/temporarySSHHelp";

const actions = [
  { value: RescueAction.TEMPORARY_SSH_ACCESS, key: "grant_ssh", destructive: false },
  { value: RescueAction.REVOKE_TEMPORARY_SSH_ACCESS, key: "revoke_ssh", destructive: false },
  { value: RescueAction.ROLLBACK_PRIVILEGED_CONFIG, key: "rollback_privileged", destructive: true },
  { value: RescueAction.SHUTDOWN, key: "shutdown", destructive: true },
  { value: RescueAction.REBOOT, key: "reboot", destructive: true },
  { value: RescueAction.BLOCK_PUBLIC_INTERFACES, key: "block_public", destructive: true },
  { value: RescueAction.BLOCK_TAILSCALE_INTERFACES, key: "block_tailscale", destructive: true },
  { value: RescueAction.ISOLATE_CONTROL_PLANE, key: "isolate", destructive: true },
  { value: RescueAction.RESTORE_NETWORK, key: "restore_network", destructive: false },
  { value: RescueAction.ROLLBACK_ONLINE_CONFIG, key: "rollback_online", destructive: true },
] as const;

const isolationText: Record<NetworkIsolationMode, string> = {
  [NetworkIsolationMode.UNSPECIFIED]: "common.unknown",
  [NetworkIsolationMode.NONE]: "rescue.isolation_none",
  [NetworkIsolationMode.PUBLIC_INTERFACES]: "rescue.isolation_public",
  [NetworkIsolationMode.TAILSCALE_INTERFACES]: "rescue.isolation_tailscale",
  [NetworkIsolationMode.CONTROL_PLANE_ONLY]: "rescue.isolation_panel",
};

const stateText: Record<OperationState, string> = {
  [OperationState.UNSPECIFIED]: "common.unknown",
  [OperationState.QUEUED]: "rescue.state_queued",
  [OperationState.RUNNING]: "rescue.state_running",
  [OperationState.CANCEL_REQUESTED]: "rescue.state_cancelling",
  [OperationState.CANCELLED]: "rescue.state_cancelled",
  [OperationState.DEADLINE_EXCEEDED]: "rescue.state_timeout",
  [OperationState.FAILED]: "rescue.state_failed",
  [OperationState.SUCCEEDED]: "rescue.state_succeeded",
};

const terminalStates = new Set([
  OperationState.CANCELLED,
  OperationState.DEADLINE_EXCEEDED,
  OperationState.FAILED,
  OperationState.SUCCEEDED,
]);

export function RescueConsole({ agentId }: { agentId?: string }) {
  const { deployment, rescue } = useConnect();
  const { t, i18n } = useTranslation();
  const outputId = React.useId();
  const [available, setAvailable] = React.useState(false);
  const [statusLoaded, setStatusLoaded] = React.useState(false);
  const [statusError, setStatusError] = React.useState<{ message?: string }>();
  const [helperStatus, setHelperStatus] = React.useState<RescueHelperStatus>();
  const [action, setAction] = React.useState<RescueAction>(RescueAction.TEMPORARY_SSH_ACCESS);
  const [credentialAction, setCredentialAction] = React.useState<SensitiveAction | null>(null);
  const [sourceIp, setSourceIp] = React.useState("");
  const sourceIpEdited = React.useRef(false);
  const [session, setSession] = React.useState<RescueSession>();
  const [sshAccess, setSSHAccess] = React.useState<TemporarySSHAccess>();
  const [output, setOutput] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [expiredGrantId, setExpiredGrantId] = React.useState("");
  const statusController = React.useRef<AbortController | null>(null);
  const streamController = React.useRef<AbortController | null>(null);
  const statusTimer = React.useRef<number | undefined>(undefined);

  const loadStatus = React.useCallback(async (signal: AbortSignal) => {
    if (!agentId) return;
    const response = await connectUnary({ signal }, (requestSignal, timeoutMs) =>
      deployment.getDeployment({ agentId }, {
        signal: requestSignal, timeoutMs,
        onHeader: (headers) => {
          const ip = headers.get("X-Komari-SSH-Source-IP");
          if (ip && !signal.aborted && !sourceIpEdited.current) setSourceIp(ip);
        },
      }),
    );
    if (signal.aborted) return;
    const helper = response.rescueHelper;
    setHelperStatus(helper);
    setAvailable(
      helper?.requested === true &&
        helper.installed === true &&
        helper.guardianRunning === true &&
        helper.helperRunning === true,
    );
    setStatusLoaded(true);
    setStatusError(undefined);
  }, [agentId, deployment]);

  React.useEffect(() => {
    statusController.current?.abort();
    streamController.current?.abort();
    setCredentialAction(null);
    setAvailable(false);
    setStatusLoaded(false);
    setStatusError(undefined);
    setHelperStatus(undefined);
    setSession(undefined);
    setSSHAccess(undefined);
    sourceIpEdited.current = false;
    setSourceIp("");
    setOutput("");
    if (!agentId) return;

    const controller = new AbortController();
    statusController.current = controller;
    void loadStatus(controller.signal)
      .catch((error) => {
        if (!controller.signal.aborted) {
          setStatusLoaded(true);
          const message = error instanceof Error ? error.message : undefined;
          setStatusError({ message });
          toast.error(message || i18n.t("rescue.load_failed"));
        }
      });

    return () => {
      controller.abort();
      streamController.current?.abort();
      if (statusTimer.current !== undefined) window.clearTimeout(statusTimer.current);
    };
  }, [agentId, i18n, loadStatus]);

  const latestWindow = helperStatus?.sshAccess;
  const windowDeadline = latestWindow?.expiresAt ? timestampDate(latestWindow.expiresAt).getTime() : 0;
  const windowExpired = !windowDeadline || windowDeadline <= Date.now() || expiredGrantId === latestWindow?.grantId;
  const activeWindow = latestWindow?.granted && !windowExpired ? latestWindow : undefined;
  const listener = sshAccess?.sshdState ?? latestWindow?.sshdState;
  React.useEffect(() => {
    if (!latestWindow?.grantId || windowExpired) return;
    const grantId = latestWindow.grantId;
    const timer = window.setTimeout(() => setExpiredGrantId(grantId), Math.max(0, windowDeadline - Date.now()));
    return () => window.clearTimeout(timer);
  }, [latestWindow?.grantId, windowDeadline, windowExpired]);

  const activeGrantId = activeWindow?.grantId;
  React.useEffect(() => {
    if (!activeGrantId) return;
    const controller = new AbortController();
    const timer = window.setInterval(() => {
      if (!document.hidden) void loadStatus(controller.signal).catch(() => undefined);
    }, 20_000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [activeGrantId, loadStatus]);

  const watch = async (sessionId: string) => {
    streamController.current?.abort();
    const controller = new AbortController();
    streamController.current = controller;
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(DEFAULT_STREAM_DEADLINE_MS),
    ]);
    const decoder = createStreamOutputDecoder();
    try {
      const stream = rescue.watchRescueSession(
        { sessionId, afterSequence: 0n },
        { signal, timeoutMs: DEFAULT_STREAM_DEADLINE_MS },
      );
      for await (const message of stream) {
        if (signal.aborted) break;
        if (message.heartbeat) continue;
        if (message.session) setSession(message.session);
        const event = message.event;
        if (event) {
          const access = event.sshAccess;
          if (access) {
            setSSHAccess(access);
            if (access.expiryMechanism === ExpiryMechanism.NFTABLES_TIMEOUT && access.expiresAt) {
              setHelperStatus((current) =>
                current && (access.granted || current.sshAccess?.grantId === access.grantId)
                  ? { ...current, sshAccess: access, sshRevokePending: Boolean(access.granted && current.sshRevokePending) }
                  : current,
              );
            }
          }
          let outputChunk = decoder.decode(event.stream, event.output);
          if (terminalStates.has(event.state)) outputChunk += decoder.finish();
          if (outputChunk) setOutput((current) => current + outputChunk);
          setSession((current) =>
            current ? { ...current, state: event.state, error: event.error ?? current.error } : current,
          );
        }
      }
    } catch (error) {
      if (!signal.aborted) {
        toast.error(error instanceof Error ? error.message : t("rescue.stream_interrupted"));
      }
    } finally {
      const tail = decoder.finish();
      if (tail && !controller.signal.aborted) setOutput((current) => current + tail);
      if (streamController.current === controller) {
        setBusy(false);
        if (statusTimer.current !== undefined) window.clearTimeout(statusTimer.current);
        statusTimer.current = window.setTimeout(() => {
          const status = new AbortController();
          statusController.current = status;
          void loadStatus(status.signal).catch(() => undefined);
        }, 3_000);
      }
    }
  };

  const start = async (
    authorizationToken: string,
    verificationSignal: AbortSignal,
    boundAction: RescueAction,
    spec: RescueCredentialSpec,
    idempotencyKey: string,
  ) => {
    if (!agentId) throw new Error(t("rescue.select_node"));
    const controller = new AbortController();
    statusController.current?.abort();
    statusController.current = controller;
    setBusy(true);
    setSSHAccess(undefined);
    setOutput("");
    try {
      const response = await connectUnary({ signal: AbortSignal.any([controller.signal, verificationSignal]) }, (signal, timeoutMs) =>
        rescue.createRescueSession(
          {
            agentId,
            action: boundAction,
            arguments: [],
            sshPort: spec.sshPort || undefined,
            sshWindow: spec.sshWindow,
            timeout: durationFromMs(DEFAULT_RESCUE_TIMEOUT_SECONDS * 1000),
            maxOutputBytes: BigInt(DEFAULT_RESCUE_MAX_OUTPUT_BYTES),
            idempotencyKey,
            twoFactor: create(TwoFactorProofSchema, {
              authorizationToken,
            }),
          },
          { signal, timeoutMs },
        ),
      );
      if (boundAction === RescueAction.REVOKE_TEMPORARY_SSH_ACCESS) {
        setHelperStatus((current) =>
          current && current.sshAccess?.grantId === spec.sshWindow?.previousGrantId
            ? { ...current, sshRevokePending: true }
            : current,
        );
      }
      setSession(response.session);
      if (response.session) void watch(response.session.sessionId);
    } catch (error) {
      setBusy(false);
      throw error;
    }
  };

  const cancel = async (authorizationToken: string, verificationSignal: AbortSignal) => {
    if (!session) throw new Error(t("rescue.session_changed"));
    const controller = new AbortController();
    statusController.current?.abort();
    statusController.current = controller;
    const response = await connectUnary({ signal: AbortSignal.any([controller.signal, verificationSignal]) }, (signal, timeoutMs) =>
      rescue.cancelRescueSession(
        {
          sessionId: session.sessionId,
          reason: "cancelled by administrator",
          twoFactor: create(TwoFactorProofSchema, {
            authorizationToken,
          }),
        },
        { signal, timeoutMs },
      ),
    );
    if (response.session) setSession(response.session);
  };

  if (!agentId) return null;

  if (!statusLoaded || (!available && !activeWindow)) {
    return (
      <Card className="p-6">
        <Flex direction="column" gap="2">
          <Flex align="center" gap="2">
            <ShieldAlert size="18" />
            <Text size="4" weight="bold">{t("rescue.console")}</Text>
          </Flex>
          {!statusLoaded ? (
            <Text size="2" color="gray">{t("rescue.loading")}</Text>
          ) : statusError ? (
            <Text size="2" color="red">{statusError.message || t("rescue.load_failed")}</Text>
          ) : (
            <Text size="2" color="orange">
              {t("rescue.unavailable")}
            </Text>
          )}
          {statusLoaded && !statusError && (
            <Text size="2" color="gray">
              {t("rescue.helper_status", {
                installed: t(helperStatus?.installed ? "rescue.installed" : "rescue.not_installed"),
                helper: t(helperStatus?.helperRunning ? "rescue.state_running" : "rescue.helper_stopped"),
              })}
            </Text>
          )}
        </Flex>
      </Card>
    );
  }

  const terminal = session ? terminalStates.has(session.state) : false;
  const selectedAction = actions.find((item) => item.value === action) ?? actions[0];
  const isGrant = action === RescueAction.TEMPORARY_SSH_ACCESS;
  const isRevoke = action === RescueAction.REVOKE_TEMPORARY_SSH_ACCESS;
  const fixedPort = helperStatus?.sshAccessPort ?? 0;
  const enrollmentKeyId = helperStatus?.sshEnrollmentKeyId ?? "";
  const diagnostic = helperStatus?.sshWindowError;
  const diagnosticCode = isGrant && !fixedPort
    ? diagnostic?.code || (helperStatus?.sshWindowSupported ? "SSH_STATUS_UNAVAILABLE" : "SSH_HELPER_UPDATE_REQUIRED")
    : undefined;
  const sshHelpURL = temporarySSHHelpURL(i18n.resolvedLanguage || i18n.language || "en", diagnosticCode);
  const resultLines = [];
  if (diagnosticCode) {
    resultLines.push(`${t(helperStatus?.sshWindowSupported ? "rescue.ssh_not_configured" : "rescue.ssh_upgrade")} [${diagnosticCode}]`);
    if (diagnostic?.message) resultLines.push(diagnostic.message);
  }
  if (session?.error) resultLines.push(session.error.message);
  if (listener) {
    resultLines.push(t(listener.reachable ? "rescue.ssh_listening" : "rescue.ssh_not_confirmed"));
    if (listener.listenAddresses.length > 0) {
      resultLines.push(t("rescue.ssh_listen_addresses", { addresses: listener.listenAddresses.join(", ") }));
    }
    if (listener.limitation) resultLines.push(listener.limitation);
  }
  if (latestWindow) {
    resultLines.push(t("rescue.ssh_receipt", {
      port: latestWindow.port,
      status: t(!latestWindow.granted ? "rescue.ssh_window_closed" : windowExpired
        ? "rescue.ssh_expired" : helperStatus?.sshRevokePending ? "rescue.ssh_revoke_pending" : "rescue.ssh_kernel_written"),
    }));
  }
  if (activeWindow?.expiresAt) {
    resultLines.push(t("rescue.ssh_window_until", {
      source: activeWindow.sourceIp, time: timestampDate(activeWindow.expiresAt).toLocaleString(i18n.resolvedLanguage),
    }));
  }
  if (output) resultLines.push(output);
  const helperOutput = resultLines.join("\n");
  const runLabel = isGrant && activeWindow
    ? t("rescue.ssh_replace")
    : t("rescue.run_action", { action: t("rescue.action_" + selectedAction.key) });
  const canRun = isRevoke
    ? Boolean(activeWindow && enrollmentKeyId && !helperStatus?.sshRevokePending)
    : available && (!isGrant || Boolean(fixedPort && enrollmentKeyId && sourceIp.trim() && !helperStatus?.sshRevokePending));
  return (
    <Card className="p-6">
      <Flex direction="column" gap="4">
        <SensitiveActionDialog request={credentialAction} onClose={() => setCredentialAction(null)} />
        <Flex align="center" gap="2">
          <ShieldAlert size="18" />
          <Text size="4" weight="bold">{t("rescue.console")}</Text>
        </Flex>
        <Flex direction="column" gap="2">
          <Text size="2">{t("rescue.network_state", { state: t(isolationText[helperStatus?.networkIsolation ?? NetworkIsolationMode.UNSPECIFIED] || "common.unknown") })}</Text>
          {(helperStatus?.blockedInterfaces.length ?? 0) > 0 && (
            <Text size="2" color="gray">{t("rescue.blocked_interfaces", { interfaces: helperStatus?.blockedInterfaces.join(", ") })}</Text>
          )}
        </Flex>
        <Select.Root
          value={String(action)}
          onValueChange={(value) => setAction(Number(value) as RescueAction)}
        >
          <Select.Trigger aria-label={t("rescue.action")} />
          <Select.Content>
            {actions.map((item) => (
              <Select.Item key={item.value} value={String(item.value)}>{t("rescue.action_" + item.key)}</Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
        <Text size="2" color={selectedAction.destructive ? "red" : "gray"}>{t("rescue.detail_" + selectedAction.key)}</Text>
        {isGrant && fixedPort > 0 && (
          <Flex direction="column" gap="2">
            <Text size="2">{t("rescue.ssh_fixed_port", { port: fixedPort })}</Text>
            <label>
              <Text size="2">{t("rescue.ssh_source")}</Text>
              <TextField.Root value={sourceIp} maxLength={45} spellCheck={false} autoComplete="off"
                onChange={(event) => {
                  sourceIpEdited.current = true;
                  setSourceIp(event.target.value);
                }} />
            </label>
            <Text size="2" color="gray">
              {t("rescue.ssh_nat_hint")} <code>curl -4 -fsS https://api.ipify.org</code>
            </Text>
          </Flex>
        )}
        {(isGrant || isRevoke) && (
          <Link size="2" href={sshHelpURL} target="_blank" rel="noopener noreferrer">{t("rescue.ssh_docs")}</Link>
        )}
        {isRevoke && !activeWindow && (
          <Text size="2" color="gray">{t("rescue.ssh_no_window")}</Text>
        )}
        <Flex gap="2" justify="end" wrap="wrap">
          {session && !terminal ? (
            <Button color="red" variant="soft" disabled={session.action === RescueAction.REVOKE_TEMPORARY_SSH_ACCESS}
              onClick={() => setCredentialAction({ action: "rescue:cancel", targets: [session.sessionId], title: t("rescue.cancel_task"), execute: cancel })}>
              <Square size="15" />{t("rescue.cancel_task")}
            </Button>
          ) : (
            <Button
              {...(selectedAction.destructive ? { color: "red" as const } : {})}
              disabled={busy || !canRun}
              onClick={() => {
                const capturedAction = action;
                const spec: RescueCredentialSpec = {
                  arguments: [],
                  timeoutSeconds: DEFAULT_RESCUE_TIMEOUT_SECONDS,
                  maxOutputBytes: DEFAULT_RESCUE_MAX_OUTPUT_BYTES,
                  sshPort: isGrant ? fixedPort : 0,
                  sshWindow: isGrant || isRevoke ? {
                    sourceIp: isGrant ? sourceIp.trim() : "",
                    previousGrantId: activeWindow?.grantId ?? "",
                    enrollmentKeyId,
                  } : undefined,
                };
                const idempotencyKey = crypto.randomUUID();
                void rescueCredentialTargets(agentId, capturedAction, spec).then((targets) => {
                  setCredentialAction({
                    action: "rescue:create",
                    targets,
                    title: runLabel,
                    execute: (token, signal) => start(token, signal, capturedAction, spec, idempotencyKey),
                  });
                });
              }}
            >
              {action === RescueAction.RESTORE_NETWORK ? <RefreshCw size="15" /> : <Power size="15" />}
              {runLabel}
            </Button>
          )}
        </Flex>
        {session && (
          <Text size="2">
            {t("rescue.session_state", { state: t(stateText[session.state] || "common.unknown"), session: session.sessionId })}
          </Text>
        )}
        {(resultLines.length > 0 || session) && (
          <Flex direction="column" gap="1">
            <Text as="label" size="2" htmlFor={outputId}>{t("rescue.output")}</Text>
            <TextArea
              id={outputId}
              readOnly
              value={helperOutput}
              rows={Math.min(10, Math.max(2, helperOutput.split("\n").length))}
              style={{ fontFamily: "monospace" }}
            />
          </Flex>
        )}
      </Flex>
    </Card>
  );
}
