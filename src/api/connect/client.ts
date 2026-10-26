import { createClient, type Transport } from "@connectrpc/connect";
import { workspaceAccess } from "./workspace";
import { createConnectTransport } from "@connectrpc/connect-web";
import { DashboardService } from "@komari/proto/komari/admin/v1/dashboard_pb";
import { TerminalSettingsService } from "@komari/proto/komari/admin/v1/terminal_pb";
import { MaintenanceService } from "@komari/proto/komari/admin/v1/maintenance_pb";
import { PingTaskService } from "@komari/proto/komari/admin/v1/ping_pb";
import { BrowserService } from "@komari/proto/komari/browser/v1/browser_pb";
import { DeploymentService } from "@komari/proto/komari/deployment/v1/deployment_pb";
import { RescueService } from "@komari/proto/komari/rescue/v1/rescue_pb";
import { MetricsService } from "@komari/proto/komari/metrics/v1/metrics_pb";
import { ExecutionService } from "@komari/proto/komari/exec/v1/exec_pb";
import { WebSSHService } from "@komari/proto/komari/webssh/v1/webssh_pb";
import { PluginService } from "@komari/proto/komari/plugin/v1/plugin_pb";
import { TrustedCredentialService } from "@komari/proto/komari/credential/v1/credential_pb";
import { FileService } from "@komari/proto/komari/file/v1/file_pb";
import { EnrollmentService, EnrollmentAdminService } from "@komari/proto/komari/enrollment/v1/enrollment_pb";
import { PrivilegedDeliveryService } from "@komari/proto/komari/config/v1/config_pb";
import {
  ConnectCompatibilityError,
  isCompatibilityFailure,
} from "./compatibility";
import { DEFAULT_UNARY_DEADLINE_MS, withRequestBudget } from "./deadline";

export { ConnectCompatibilityError, isCompatibilityFailure } from "./compatibility";
export { isAbortError } from "@/utils/dashboard";

export interface ConnectCallOptions {
  signal: AbortSignal;
  timeoutMs?: number;
}

const transport = createConnectTransport({
  baseUrl:
    typeof window === "undefined" ? "http://localhost" : window.location.origin,
  useBinaryFormat: true,
  defaultTimeoutMs: DEFAULT_UNARY_DEADLINE_MS,
  fetch: (input, init) => fetch(input, { ...init, credentials: "same-origin" }),
});

const browser = createClient(BrowserService, transport);
const dashboard = createClient(DashboardService, transport);
const terminalSettings = createClient(TerminalSettingsService, transport);
const maintenance = createClient(MaintenanceService, transport);
const pingTask = createClient(PingTaskService, transport);
const deployment = createClient(DeploymentService, transport);
const rescue = createClient(RescueService, transport);
const metrics = createClient(MetricsService, transport);
const execution = createClient(ExecutionService, transport);
const webssh = createClient(WebSSHService, transport);
const plugin = createClient(PluginService, transport);
const credential = createClient(TrustedCredentialService, transport);
const enrollment = createClient(EnrollmentService, transport);
const enrollmentAdmin = createClient(EnrollmentAdminService, transport);
const privilegedDelivery = createClient(PrivilegedDeliveryService, transport);
// Wait for human verification before the network request's deadline starts.
const fileTransport: Transport = {
  ...transport,
  async unary(method, signal, timeoutMs, header, input, contextValues) {
    const agentId = (input as { agentId?: string }).agentId;
    if (!agentId) throw new Error("File operation requires an agent");
    const access = await workspaceAccess(agentId, signal ?? new AbortController().signal);
    const headers = new Headers(header);
    headers.set("X-Komari-Workspace-Grant", access.headers["X-Komari-Workspace-Grant"]);
    return transport.unary(method, access.signal, timeoutMs, headers, input, contextValues);
  },
};
const file = createClient(FileService, fileTransport);

export const connectClients = {
  browser,
  agentLifecycleClient: browser,
  dashboard,
  terminalSettings,
  maintenance,
  pingTask,
  deployment,
  rescue,
  metrics,
  execution,
  webssh,
  plugin,
  credential,
  enrollment,
  enrollmentAdmin,
  privilegedDelivery,
  file,
};

export const connectUnary = <T>(
  options: ConnectCallOptions,
  call: (signal: AbortSignal, timeoutMs: number) => Promise<T>,
) =>
  withRequestBudget(
    options.signal,
    options.timeoutMs ?? DEFAULT_UNARY_DEADLINE_MS,
    ({ signal, timeoutMs }) =>
      call(signal, timeoutMs).catch((error) => {
        if (isCompatibilityFailure(error)) {
          throw new ConnectCompatibilityError(error);
        }
        throw error;
      }),
  );
