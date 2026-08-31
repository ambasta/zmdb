// @zmdb/web — lifecycle hooks, shared by the app bootstrap and the test harness.
//
// `createApp` and `createTestApp` both have to work out which controllers
// implement which hook and drive them in the right order. They used to carry a
// copy each, and the copies disagreed: the test harness ran `onModuleInit` but
// never `onApplicationBootstrap`, though testing/SPEC.md says its lifecycle is
// "same as App". One implementation, one behaviour.
//
// Detection is structural `in`-narrowing on the instance: no reflection, no cast.

/** Called after a controller/provider is constructed. */
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
  for (let i = instances.length - 1; i >= 0; i -= 1) {
    const instance = instances[i];
    if (instance !== undefined && hasShutdown(instance)) await instance.onShutdown();
  }
}
