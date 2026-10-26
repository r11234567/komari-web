import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = ts.transpileModule(readFileSync(new URL("../src/api/connect/remote.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

test("execution adapters forward the completed native authorization to each typed action", async () => {
  const calls: { method: string; input: any; signal: AbortSignal }[] = [];
  const execution = {
    async createExecution(input: unknown, options: { signal: AbortSignal }) { calls.push({ method: "create", input, signal: options.signal }); return { executions: [{ executionId: "synthetic-execution" }] }; },
    async cancelExecution(input: unknown, options: { signal: AbortSignal }) { calls.push({ method: "cancel", input, signal: options.signal }); return {}; },
  };
  const exports: any = {};
  vm.runInNewContext(source, { exports, require(name: string) {
    if (name === "./client") return { connectClients: { execution }, connectUnary: async (options: { signal: AbortSignal }, call: (signal: AbortSignal, timeoutMs: number) => Promise<unknown>) => call(options.signal, 30_000) };
    if (name === "@bufbuild/protobuf/wkt") return { durationFromMs: (milliseconds: number) => ({ seconds: BigInt(milliseconds / 1000) }) };
    if (["./workspace", "@connectrpc/connect", "../../utils/terminalTransport", "./deadline"].includes(name)) return {};
    throw new Error(`Unexpected import ${name}`);
  } });
  const signal = new AbortController().signal;
  const result = await exports.createRemoteExecutions({ agentIds: ["synthetic-agent"], command: "synthetic-placeholder", authorizationToken: "synthetic-create-grant", idempotencyKey: "synthetic-request", signal });
  await exports.cancelRemoteExecution({ executionId: result[0].executionId, reason: "synthetic-cancel", authorizationToken: "synthetic-cancel-grant", signal });
  assert.equal(calls[0].input.twoFactor.authorizationToken, "synthetic-create-grant");
  assert.equal(calls[1].input.twoFactor.authorizationToken, "synthetic-cancel-grant");
  assert.equal(calls[1].input.executionId, "synthetic-execution");
  assert.equal(calls[0].signal, signal);
  assert.equal(calls[1].signal, signal);
});
