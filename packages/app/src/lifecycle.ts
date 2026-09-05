// @zmdb/app — lifecycle hooks, shared by the app bootstrap and the test harness.
//
// Every protocol adapter and test harness delegates to this one ledger. Hook
// detection and ordering therefore cannot drift between HTTP, commands, jobs
// or a standalone application.
//
// Detection is structural `in`-narrowing on the instance: no reflection, no cast.

/** Called after the eager application instances are constructed. */
export interface OnModuleInit {
  onModuleInit(): void | Promise<void>;
}
/** Called after all modules are initialized. */
export interface OnApplicationBootstrap {
  onApplicationBootstrap(): void | Promise<void>;
}
/** Called on graceful shutdown (via `await using` / dispose). */
export interface OnShutdown {
  onShutdown(): void | Promise<void>;
}

function hasModuleInit(x: object): x is OnModuleInit {
  return 'onModuleInit' in x && typeof x.onModuleInit === 'function';
}
function hasBootstrap(x: object): x is OnApplicationBootstrap {
  return 'onApplicationBootstrap' in x && typeof x.onApplicationBootstrap === 'function';
}
function hasShutdown(x: object): x is OnShutdown {
  return 'onShutdown' in x && typeof x.onShutdown === 'function';
}

/**
 * `onModuleInit` on every implementer, then `onApplicationBootstrap` on every
 * implementer — two full passes, so a bootstrap hook can rely on every module
 * having been initialized.
 */
export async function runInit(instances: readonly object[]): Promise<void> {
  for (const instance of instances) {
    if (hasModuleInit(instance)) await instance.onModuleInit();
  }
  for (const instance of instances) {
    if (hasBootstrap(instance)) await instance.onApplicationBootstrap();
  }
}

/** `onShutdown` in reverse construction order, so a dependent tears down before what it depends on. */
export async function runShutdown(instances: readonly (object | undefined)[]): Promise<void> {
  const errors: unknown[] = [];
  for (let i = instances.length - 1; i >= 0; i -= 1) {
    const instance = instances[i];
    if (instance === undefined || !hasShutdown(instance)) continue;
    try {
      await instance.onShutdown();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    throw new AggregateError(errors, '@zmdb/app: application shutdown hooks failed');
  }
}
