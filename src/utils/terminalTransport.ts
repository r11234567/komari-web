const INPUT_CHUNK_BYTES = 64 << 10;
const MAX_PENDING_INPUT_BYTES = 1 << 20;

type PendingCommand =
  | { kind: "input"; chunks: Uint8Array[]; bytes: number }
  | { kind: "resize"; rows: number; columns: number };

// Keep ordering, but batch input arriving during a slow request into the next
// request instead of making an ever-growing one-RPC-per-keystroke promise chain.
export function createTerminalCommandQueue(options: {
  signal: AbortSignal;
  input: (sequence: bigint, data: Uint8Array) => Promise<unknown>;
  resize: (sequence: bigint, rows: number, columns: number) => Promise<unknown>;
  onError: (error: unknown) => void;
}) {
  const pending: PendingCommand[] = [];
  let pendingBytes = 0;
  let sequence = 0n;
  let sending = false;
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const dispose = () => {
    closed = true;
    clearTimeout(timer);
    timer = undefined;
    pending.length = 0;
    pendingBytes = 0;
    options.signal.removeEventListener("abort", dispose);
  };
  const fail = (error: unknown) => {
    dispose();
    if (!options.signal.aborted) options.onError(error);
  };
  const pump = async () => {
    timer = undefined;
    if (closed || sending || options.signal.aborted) return;
    sending = true;
    try {
      while (!closed && !options.signal.aborted && pending.length) {
        const command = pending.shift()!;
        const next = ++sequence;
        if (command.kind === "input") {
          const data = new Uint8Array(command.bytes);
          let offset = 0;
          for (const chunk of command.chunks) {
            data.set(chunk, offset);
            offset += chunk.byteLength;
          }
          await options.input(next, data);
          pendingBytes = Math.max(0, pendingBytes - command.bytes);
        } else {
          await options.resize(next, command.rows, command.columns);
        }
      }
    } catch (error) {
      fail(error);
    } finally {
      sending = false;
    }
  };
  const schedule = () => {
    if (!sending && timer === undefined) timer = setTimeout(() => void pump(), 8);
  };
  options.signal.addEventListener("abort", dispose, { once: true });
  return {
    input(data: Uint8Array) {
      if (closed || options.signal.aborted || data.byteLength === 0) return;
      if (pendingBytes + data.byteLength > MAX_PENDING_INPUT_BYTES) {
        fail(new Error("Terminal input backlog is full; reconnect before sending more input"));
        return;
      }
      pendingBytes += data.byteLength;
      for (let offset = 0; offset < data.byteLength;) {
        let last = pending[pending.length - 1];
        if (last?.kind !== "input" || last.bytes === INPUT_CHUNK_BYTES) {
          last = { kind: "input", chunks: [], bytes: 0 };
          pending.push(last);
        }
        const end = Math.min(data.byteLength, offset + INPUT_CHUNK_BYTES - last.bytes);
        last.chunks.push(data.slice(offset, end));
        last.bytes += end - offset;
        offset = end;
      }
      schedule();
    },
    resize(rows: number, columns: number) {
      if (closed || options.signal.aborted) return;
      const last = pending[pending.length - 1];
      if (last?.kind === "resize") {
        last.rows = rows;
        last.columns = columns;
      } else {
        pending.push({ kind: "resize", rows, columns });
      }
      schedule();
    },
    dispose,
  };
}

// ACK the highest consumed sequence without stalling output on a network RTT.
// There is at most one RPC in flight and one cumulative sequence pending.
export function createTerminalEventAcknowledger(options: {
  signal: AbortSignal;
  acknowledge: (sequence: bigint) => Promise<unknown>;
  onError: (error: unknown) => void;
}) {
  let latest = 0n;
  let accepted = 0n;
  let sending = false;
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const dispose = () => {
    closed = true;
    clearTimeout(timer);
    timer = undefined;
    options.signal.removeEventListener("abort", dispose);
  };
  const schedule = () => {
    if (closed || sending || timer !== undefined || latest <= accepted) return;
    timer = setTimeout(() => void flush(), 50);
  };
  const flush = async () => {
    timer = undefined;
    if (closed || options.signal.aborted) return;
    sending = true;
    const sequence = latest;
    try {
      await options.acknowledge(sequence);
      accepted = sequence;
    } catch (error) {
      dispose();
      if (!options.signal.aborted) options.onError(error);
    } finally {
      sending = false;
      schedule();
    }
  };
  options.signal.addEventListener("abort", dispose, { once: true });
  return {
    accept(sequence: bigint) {
      if (closed || options.signal.aborted) return;
      if (sequence > latest) latest = sequence;
      schedule();
    },
    dispose,
  };
}
