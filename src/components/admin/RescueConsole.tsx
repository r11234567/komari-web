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
  type RescueHelperStatus,
  type RescueSession,
  type TemporarySSHAccess,
} from "@komari/proto/komari/rescue/v1/rescue_pb";
import {
  Button,
  Card,
  Flex,
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
} from "@/utils/credentialAction";
import { connectUnary } from "@/api/connect/client";
import { DEFAULT_STREAM_DEADLINE_MS } from "@/api/connect/deadline";
import { useConnect } from "@/contexts/ConnectContext";

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
  const [available, setAvailable] = React.useState(false);
  const [statusLoaded, setStatusLoaded] = React.useState(false);
  const [statusError, setStatusError] = React.useState<{ message?: string }>();
  const [helperStatus, setHelperStatus] = React.useState<RescueHelperStatus>();
  const [action, setAction] = React.useState<RescueAction>(RescueAction.TEMPORARY_SSH_ACCESS);
  const [credentialAction, setCredentialAction] = React.useState<SensitiveAction | null>(null);
  const [sshPort, setSshPort] = React.useState("22");
  const [session, setSession] = React.useState<RescueSession>();
  const [sshAccess, setSSHAccess] = React.useState<TemporarySSHAccess>();
  const [output, setOutput] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const statusController = React.useRef<AbortController | null>(null);
  const streamController = React.useRef<AbortController | null>(null);
  const statusTimer = React.useRef<number | undefined>(undefined);

  const loadStatus = React.useCallback(async (signal: AbortSignal) => {
    if (!agentId) return;
    const response = await connectUnary({ signal }, (requestSignal, timeoutMs) =>
      deployment.getDeployment({ agentId }, { signal: requestSignal, timeoutMs }),
    );
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

  const watch = async (sessionId: string) => {
    streamController.current?.abort();
    const controller = new AbortController();
    streamController.current = controller;
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(DEFAULT_STREAM_DEADLINE_MS),
    ]);
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
          if (event.sshAccess) setSSHAccess(event.sshAccess);
          if (event.output.length > 0) {
            setOutput((current) => current + new TextDecoder().decode(event.output));
          }
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
      setBusy(false);
      if (statusTimer.current !== undefined) window.clearTimeout(statusTimer.current);
      statusTimer.current = window.setTimeout(() => {
        const status = new AbortController();
        statusController.current = status;
        void loadStatus(status.signal).catch(() => undefined);
      }, 3_000);
    }
  };

  const start = async (
    authorizationToken: string,
    verificationSignal: AbortSignal,
    boundAction: RescueAction = action,
    boundSshPort: number = action === RescueAction.TEMPORARY_SSH_ACCESS ? (Number(sshPort) || 22) : 0,
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
            sshPort: boundSshPort,
            timeout: durationFromMs(DEFAULT_RESCUE_TIMEOUT_SECONDS * 1000),
            maxOutputBytes: BigInt(DEFAULT_RESCUE_MAX_OUTPUT_BYTES),
            idempotencyKey: crypto.randomUUID(),
            twoFactor: create(TwoFactorProofSchema, {
              authorizationToken,
            }),
          },
          { signal, timeoutMs },
        ),
      );
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

  if (!statusLoaded || !available) {
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
  const runLabel = t("rescue.run_action", { action: t("rescue.action_" + selectedAction.key) });
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
        {action === RescueAction.TEMPORARY_SSH_ACCESS && (
          <Flex gap="2" align="center">
            <Text size="2" color="gray" style={{ whiteSpace: "nowrap" }}>{t("rescue.ssh_port")}</Text>
            <TextField.Root
              type="number"
              aria-label={t("rescue.ssh_port")}
              placeholder="22"
              value={sshPort}
              onChange={(event) => setSshPort(event.target.value)}
              style={{ width: "90px" }}
            />
          </Flex>
        )}
        <Flex gap="2" justify="end" wrap="wrap">
          {session && !terminal ? (
            <Button color="red" variant="soft" onClick={() => setCredentialAction({ action: "rescue:cancel", targets: [session.sessionId], title: t("rescue.cancel_task"), execute: cancel })}>
              <Square size="15" />{t("rescue.cancel_task")}
            </Button>
          ) : (
            <Button
              {...(selectedAction.destructive ? { color: "red" as const } : {})}
              disabled={busy}
              onClick={() => {
                const capturedAction = action;
                const resolvedPort = capturedAction === RescueAction.TEMPORARY_SSH_ACCESS ? (Number(sshPort) || 22) : 0;
                void rescueCredentialTargets(agentId, capturedAction, {
                  arguments: [],
                  timeoutSeconds: DEFAULT_RESCUE_TIMEOUT_SECONDS,
                  maxOutputBytes: DEFAULT_RESCUE_MAX_OUTPUT_BYTES,
                  sshPort: resolvedPort,
                }).then((targets) => {
                  setCredentialAction({
                    action: "rescue:create",
                    targets,
                    title: runLabel,
                    execute: (token, signal) => start(token, signal, capturedAction, resolvedPort),
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
        {session?.error && <Text size="2" color="red">{session.error.message}</Text>}
        {sshAccess && (
          <Flex direction="column" gap="1" role="status">
            <Text size="2">
              {t("rescue.ssh_receipt", {
                port: sshAccess.port,
                status: t(sshAccess.granted ? "rescue.ssh_granted" : sshAccess.sshdState ? "rescue.ssh_failed" : "rescue.ssh_revoked"),
              })}
            </Text>
            {sshAccess.granted && sshAccess.expiresAt && (
              <Text size="2">{t("rescue.ssh_expires", { time: timestampDate(sshAccess.expiresAt).toLocaleString(i18n.resolvedLanguage) })}</Text>
            )}
            {sshAccess.sshdState && (
              <Flex direction="column" gap="1">
                <Text size="2" color={sshAccess.sshdState.limitation ? "orange" : "gray"}>
                  {t(sshAccess.sshdState.reachable ? "rescue.ssh_listening" : "rescue.ssh_not_confirmed")}
                </Text>
                {sshAccess.sshdState.listenAddresses.length > 0 && (
                  <Text size="2" color="gray">{t("rescue.ssh_listen_addresses", { addresses: sshAccess.sshdState.listenAddresses.join(", ") })}</Text>
                )}
                {sshAccess.sshdState.limitation && <Text size="2" color="orange">{sshAccess.sshdState.limitation}</Text>}
              </Flex>
            )}
            {sshAccess.granted && <Text size="2" color="gray">{t("rescue.ssh_verify")}</Text>}
          </Flex>
        )}
        <TextArea
          readOnly
          value={output}
          placeholder={t("rescue.output")}
          style={{ minHeight: "180px", fontFamily: "monospace" }}
        />
      </Flex>
    </Card>
  );
}
