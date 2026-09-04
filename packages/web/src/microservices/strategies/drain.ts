export type TransportErrorSink = (error: unknown) => void;

export function reportTransportError(sink: TransportErrorSink, error: unknown): void {
  try {
    sink(error);
  } catch {
    // A diagnostic sink cannot replace transport settlement or shutdown.
  }
}

export class InFlight {
  readonly #tasks = new Set<Promise<void>>();
  readonly #onError: TransportErrorSink;
  #accepting = true;

  constructor(onError: TransportErrorSink) {
    this.#onError = onError;
  }

  run(action: () => Promise<void>): Promise<void> {
    if (!this.#accepting) {
      return Promise.resolve();
    }
    let task: Promise<void>;
    task = Promise.resolve()
      .then(action)
      .catch(error => {
        reportTransportError(this.#onError, error);
      })
      .finally(() => {
        this.#tasks.delete(task);
      });
    this.#tasks.add(task);
    return task;
  }

  stop(): void {
    this.#accepting = false;
  }

  async settled(): Promise<void> {
    await Promise.all(this.#tasks);
  }
}

export async function withinGrace(action: Promise<void>, graceMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      action.then(() => true),
      new Promise<false>(resolve => {
        timer = setTimeout(() => resolve(false), graceMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

export function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new Error('@zmdb/web: broker request aborted');
}
