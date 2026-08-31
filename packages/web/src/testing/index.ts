// @zmdb/web — testing utilities (epic #312, spec ./SPEC.md). createTestApp
// applies provider overrides, then drives routes in-process (no socket). No `as`
// on the consumer surface.

import type { Container, Token } from '../di/index.ts';
import { runInit, runShutdown } from '../lifecycle.ts';
import { compileModule, type ModuleClass, type ProviderDef } from '../modules/index.ts';
import { createRouter, type Router, type WebRequest, type WebResponse } from '../pipeline/index.ts';

/** Options for `createTestApp`. */
export interface TestAppOptions {
  readonly overrides?: readonly ProviderDef[];
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
  const { container, controllers } = compileModule(rootModule, options.overrides ?? []);
  const router: Router = createRouter();
  for (const controller of controllers) {
    router.register(controller);
  }
  const resolve = <T>(token: Token<T>): T => resolveFrom(container, token);

  return {
    request: req => router.handle(req),
    get: resolve,
    init: () => runInit(controllers),
    [Symbol.asyncDispose]: () => runShutdown(controllers),
  };
}

function resolveFrom<T>(container: Container, token: Token<T>): T {
  return container.resolve(token);
}
