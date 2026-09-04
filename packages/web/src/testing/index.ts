// @zmdb/web — testing utilities (epic #312, spec ./SPEC.md). createTestApp
// applies provider overrides, then drives routes in-process (no socket). No `as`
// on the consumer surface.

import type { Container, Token } from '../di/index.js';
import { runInit, runShutdown } from '../lifecycle.js';
import { compileModule, type ModuleClass, type ProviderDef } from '../modules/index.js';
import { lifecycleInstances } from '../modules/lifecycle-instances.js';
import { runtimeOf } from '../modules/runtime.js';
import type { Observability } from '../observability/types.js';
import { createRouter, type Router, type WebRequest, type WebResponse } from '../pipeline/index.js';

/** Options for `createTestApp`. */
export interface TestAppOptions {
  readonly overrides?: readonly ProviderDef[];
  readonly observability?: Observability;
}

/** A test application: drive requests in-process and resolve providers. */
export interface TestApp extends AsyncDisposable {
  request(req: WebRequest): Promise<WebResponse>;
  get<T>(token: Token<T>): T;
  init(): Promise<void>;
}

/**
 * Build a test app from a root module, applying provider `overrides` before
 * controllers are built (so controllers inject the stubs), and drive routes
 * in-process via the same pipeline as production.
 */
export function createTestApp(rootModule: ModuleClass, options: TestAppOptions = {}): TestApp {
  const compiled = compileModule(rootModule, options.overrides ?? []);
  const { container, controllers } = compiled;
  const instances = lifecycleInstances(container);
  const runtime = runtimeOf(compiled);
  const router: Router = createRouter(options.observability);
  if (runtime === undefined) {
    for (const controller of controllers) {
      router.register(controller);
    }
  } else {
    for (const route of runtime.routes) {
      if (route.kind === 'eager') {
        router.register(route.controller);
      } else {
        router.registerDeferred(route.controller, route.instance);
      }
    }
  }
  const resolve = <T>(token: Token<T>): T => resolveFrom(container, token);

  return {
    request: req => router.handle(req),
    get: resolve,
    init: () => runInit(instances),
    [Symbol.asyncDispose]: async () => {
      runtime?.beginShutdown();
      await runtime?.waitForLoads();
      await runShutdown(instances);
    },
  };
}

function resolveFrom<T>(container: Container, token: Token<T>): T {
  return container.resolve(token);
}
