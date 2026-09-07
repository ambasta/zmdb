import type { ResolvedConfig } from '@zmdb/compiler/config';

import { SuppressedErrorCtor } from './errors.js';

/** Own only the driver requested during this invocation, including non-enumerable disposal methods. */
export async function withConfiguredDriver<T>(
  config: ResolvedConfig,
  run: (config: ResolvedConfig) => Promise<T>,
): Promise<T> {
  const create = config.driver;
  if (create === undefined) return run(config);
  let opened: Awaited<ReturnType<typeof create>> | undefined;
  let pending: Promise<Awaited<ReturnType<typeof create>>> | undefined;
  let outcome: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: unknown };
  try {
    outcome = {
      ok: true,
      value: await run({
        ...config,
        driver() {
          pending ??= Promise.resolve()
            .then(create)
            .then(driver => {
              opened = driver;
              return driver;
            });
          return pending;
        },
      }),
    };
  } catch (error) {
    outcome = { ok: false, error };
  }
  try {
    if (opened !== undefined) {
      const disposeAsync: unknown = Reflect.get(opened, Symbol.asyncDispose);
      const dispose: unknown = Reflect.get(opened, Symbol.dispose);
      if (typeof disposeAsync === 'function') await disposeAsync.call(opened);
      else if (typeof dispose === 'function') dispose.call(opened);
    }
  } catch (cleanupError) {
    if (!outcome.ok) throw new SuppressedErrorCtor(cleanupError, outcome.error, 'command and driver cleanup failed');
    throw cleanupError;
  }
  if (!outcome.ok) throw outcome.error;
  return outcome.value;
}

/** Translate process termination into the command's existing cancellable lifetime. */
export async function withSignals<T>(run: (until: Promise<void>) => Promise<T>): Promise<T | undefined> {
  const until = Promise.withResolvers<void>();
  let interrupted = false;
  const stop = (): void => {
    interrupted = true;
    until.resolve();
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    return await run(until.promise);
  } catch (error) {
    // A terminal signal also terminates the TypeScript child in the same process group.
    // The watch has already run its cleanup before this closed-channel error arrives.
    if (
      interrupted &&
      error instanceof Error &&
      error.message.startsWith('Unexpected EOF while reading from child process')
    )
      return undefined;
    throw error;
  } finally {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
  }
}
