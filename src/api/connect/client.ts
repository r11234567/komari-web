import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { BrowserService } from "@komari/proto/komari/browser/v1/browser_pb";
import { DeploymentService } from "@komari/proto/komari/deployment/v1/deployment_pb";
import { RescueService } from "@komari/proto/komari/rescue/v1/rescue_pb";
import {
  ConnectCompatibilityError,
  isCompatibilityFailure,
} from "./compatibility";
import { DEFAULT_UNARY_DEADLINE_MS, withRequestBudget } from "./deadline";

export { ConnectCompatibilityError, isCompatibilityFailure } from "./compatibility";

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
const deployment = createClient(DeploymentService, transport);
const rescue = createClient(RescueService, transport);

export const connectClients = { browser, deployment, rescue };

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
