import { Code, ConnectError, type Transport } from "@connectrpc/connect";

type ReadJob = {
  signal: AbortSignal;
  expiresAt: number;
  attempts: number;
  operation: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  cleanup: () => void;
};

export class MetricReadQueue {
  private pending: ReadJob[] = [];
  private active = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private nextStart = 0;
  private cooldownUntil = 0;
  private readonly intervalMs: number;
  private readonly maximumQueued: number;
  private readonly maximumWaitMs: number;
  private readonly maximumConcurrent: number;

  constructor(options: { intervalMs?: number; maximumQueued?: number; maximumWaitMs?: number; maximumConcurrent?: number } = {}) {
    this.intervalMs = options.intervalMs ?? 0;
    this.maximumQueued = options.maximumQueued ?? 128;
    this.maximumWaitMs = options.maximumWaitMs ?? 30_000;
    this.maximumConcurrent = options.maximumConcurrent ?? 16;
    if (!Number.isFinite(this.intervalMs) || this.intervalMs < 0 ||
        !Number.isInteger(this.maximumQueued) || this.maximumQueued < 1 ||
        !Number.isFinite(this.maximumWaitMs) || this.maximumWaitMs <= 0 ||
        !Number.isInteger(this.maximumConcurrent) || this.maximumConcurrent < 1) {
      throw new RangeError("Invalid historical read queue limits");
    }
  }

  run<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const job: ReadJob = {
        signal, operation, expiresAt: Date.now() + this.maximumWaitMs, attempts: 0,
        resolve: (value) => resolve(value as T), reject, cleanup: () => {},
      };
      this.enqueue(job);
    });
  }

  private enqueue(job: ReadJob, retry = false) {
    if (job.signal.aborted) {
      job.reject(job.signal.reason ?? new DOMException("Request aborted", "AbortError"));
      return;
    }
    if (this.pending.length >= this.maximumQueued || Date.now() >= job.expiresAt) {
      job.reject(new ConnectError("Historical reads are busy. Retry after the current reads finish.", Code.ResourceExhausted));
      return;
    }
    const remove = (reason: unknown) => {
      const index = this.pending.indexOf(job);
      if (index < 0) return;
      this.pending.splice(index, 1);
      job.cleanup();
      job.reject(reason);
      this.pump();
    };
    const abort = () => remove(job.signal.reason ?? new DOMException("Request aborted", "AbortError"));
    const timeout = setTimeout(() => remove(new ConnectError("Historical read queue timed out", Code.DeadlineExceeded)), job.expiresAt - Date.now());
    job.cleanup = () => {
      clearTimeout(timeout);
      job.signal.removeEventListener("abort", abort);
    };
    job.signal.addEventListener("abort", abort, { once: true });
    if (retry) this.pending.unshift(job);
    else this.pending.push(job);
    this.pump();
  }

  private pump() {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (this.active >= this.maximumConcurrent || this.pending.length === 0) return;
    const wait = Math.max(this.nextStart, this.cooldownUntil) - Date.now();
    if (wait > 0) {
      this.timer = setTimeout(() => { this.timer = undefined; this.pump(); }, Math.min(wait, 2_147_483_647));
      return;
    }
    const job = this.pending.shift()!;
    job.cleanup();
    if (job.signal.aborted) {
      job.reject(job.signal.reason ?? new DOMException("Request aborted", "AbortError"));
      this.pump();
      return;
    }
    this.active++;
    this.nextStart = Date.now() + this.intervalMs;
    job.attempts++;
    void this.execute(job);
    this.pump();
  }

  private async execute(job: ReadJob) {
    let retry = false;
    try {
      const result = await job.operation();
      if (job.signal.aborted) job.reject(job.signal.reason);
      else job.resolve(result);
    } catch (error) {
      const failure = ConnectError.from(error);
      const backpressure = failure.code === Code.ResourceExhausted || failure.code === Code.Unavailable;
      if (!job.signal.aborted && backpressure) {
        const header = failure.metadata.get("Retry-After");
        const seconds = header ? Number(header) : NaN;
        const indicated = Number.isFinite(seconds) ? seconds * 1000 : header ? Date.parse(header) - Date.now() : 0;
        const delay = Math.max(2000, Number.isFinite(indicated) ? indicated : 0);
        this.cooldownUntil = Math.max(this.cooldownUntil, Date.now() + delay);
        retry = job.attempts < 2;
      }
      if (!retry) job.reject(error);
    } finally {
      this.active--;
      if (retry) this.enqueue(job, true);
      this.pump();
    }
  }
}

const historyMethods = new Set([
  "komari.metrics.v1.MetricsService/QueryMetrics",
  "komari.metrics.v1.MetricsService/GetPingStats",
  "komari.admin.v1.DashboardService/GetDashboardSummary",
  "komari.admin.v1.DashboardService/GetDashboardCharts",
  "komari.browser.v1.BrowserService/GetTrafficTrend",
]);

export function withMetricReadQueue(
  base: Transport,
  queue = new MetricReadQueue(),
  pingQueue = new MetricReadQueue({ maximumConcurrent: 4 }),
): Transport {
  return {
    ...base,
    unary(method, signal, timeoutMs, header, input, contextValues) {
      if (!historyMethods.has(`${method.parent.typeName}/${method.name}`)) {
        return base.unary(method, signal, timeoutMs, header, input, contextValues);
      }
      // Ping must remain usable while charts are slow or backing off. Both
      // lanes still obey server Retry-After and have bounded pending work.
      const lane = method.name === "GetPingStats" ? pingQueue : queue;
      return lane.run(signal ?? new AbortController().signal,
        () => base.unary(method, signal, timeoutMs, header, input, contextValues));
    },
  };
}
