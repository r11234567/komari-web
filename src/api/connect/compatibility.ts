import { Code, ConnectError } from "@connectrpc/connect";

export class ConnectCompatibilityError extends Error {
  constructor(cause: unknown) {
    super("Connect endpoint is unavailable; use the legacy compatibility adapter");
    this.name = "ConnectCompatibilityError";
    Object.assign(this, { cause });
  }
}

export const isCompatibilityFailure = (error: unknown) => {
  if (!(error instanceof ConnectError)) return false;
  return error.code === Code.Unavailable || error.code === Code.Unimplemented;
};
