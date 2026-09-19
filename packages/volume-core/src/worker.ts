// Ported from Cornerstone3D webWorkerManager + ITK-Wasm WorkerPool.
// Cornerstone: registerWorker(name, workerFn, {maxWorkerInstances}) +
// executeTask(name, method, args, {priority, requestType, transferList}).
// ITK-Wasm: WorkerPool(poolSize, fcn) + runTasks -> {promise, runId} +
// cancel/terminate. CPU-only: no comlink/vtk, transferables are TypedArrays.

export type RequestType = 'interaction' | 'prefetch' | 'compute';

export interface ExecuteOptions {
  priority?: number;
  requestType?: RequestType;
  transferList?: Transferable[];
}

export type WorkerFn = (...args: unknown[]) => Promise<unknown>;

/** Least-loaded worker registry (Cornerstone CentralizedWorkerManager, lite). */
export class WorkerManager {
  private fns = new Map<string, { fn: WorkerFn; max: number; load: number }>();

  registerWorker(name: string, fn: WorkerFn, maxInstances = 1): void {
    this.fns.set(name, { fn, max: Math.max(1, maxInstances), load: 0 });
  }

  async executeTask<T>(name: string, args: unknown[], opts: ExecuteOptions = {}): Promise<T> {
    const e = this.fns.get(name);
    if (!e) throw new Error(`Unknown worker: ${name}`);
    e.load++;
    try {
      void opts;
      return (await e.fn(...args)) as T;
    } finally {
      e.load--;
    }
  }

  getLoad(name: string): number {
    return this.fns.get(name)?.load ?? 0;
  }
}

/**
 * Task pool (ITK-Wasm WorkerPool): chunk inputs -> runTasks -> stitch.
 * fcn(...taskArgs, {webWorker}) -> result; workers are logical slots here
 * (real Web Workers get wired in the UI package later).
 */
export class WorkerPool {
  private running = 0;
  private cancelled = new Set<number>();
  private nextRunId = 1;

  constructor(
    public poolSize: number,
    private fcn: (taskArgs: unknown[], opts: { slot: number }) => Promise<unknown>,
  ) {}

  runTasks(taskArgsArray: unknown[][]): { promise: Promise<unknown[]>; runId: number } {
    const runId = this.nextRunId++;
    const results: unknown[] = new Array(taskArgsArray.length);
    const promise = (async () => {
      const queue = taskArgsArray.map((a, i) => ({ a, i }));
      const workers = Array.from({ length: Math.min(this.poolSize, queue.length) }, async (_, slot) => {
        while (queue.length) {
          if (this.cancelled.has(runId)) return;
          const job = queue.shift()!;
          this.running++;
          try {
            results[job.i] = await this.fcn(job.a, { slot });
          } finally {
            this.running--;
          }
        }
      });
      await Promise.all(workers);
      return results;
    })();
    return { promise, runId };
  }

  cancel(runId: number): void {
    this.cancelled.add(runId);
  }
}

/** Default pool size: concurrency/2 (Cornerstone dicomImageLoader init).
 * Takes the value as a parameter so engine code never sniffs the environment:
 * chrome passes `navigator.hardwareConcurrency`, engine defaults to 4. */
export function defaultPoolSize(concurrency = 4): number {
  return Math.max(1, Math.floor(concurrency / 2));
}
