// @zmdb/web — application bootstrap & lifecycle (epic #292, spec ./SPEC.md).
// createApp compiles the module graph, wires routes once, and exposes lifecycle
// hooks + `await using` graceful shutdown. Per-request path is unchanged. No
// reflection per request; no `as` on the consumer surface.

import type { Container } from '../di/index.js';
import { runInit, runShutdown } from '../lifecycle.js';
import { compileModule, type ModuleClass } from '../modules/index.js';
import { createRouter, toFetchHandler, type Router, type WebRequest, type WebResponse } from '../pipeline/index.js';

export type { OnApplicationBootstrap, OnModuleInit, OnShutdown } from '../lifecycle.js';

/** A bootstrapped application. */
export interface App extends AsyncDisposable {
  readonly container: Container;
  handle(req: WebRequest): Promise<WebResponse>;
  fetch(request: Request): Promise<Response>;
  init(): Promise<void>;
}

/**
 * Bootstrap an application from a root module: compile the module graph, build a
 * router, register every controller's routes. Wiring happens here (once); the
 * per-request path is the dispatcher from `createRouter`.
 */
export function createApp(rootModule: ModuleClass): App {
  const { container, controllers } = compileModule(rootModule);
  const router: Router = createRouter();
  for (const controller of controllers) {
    router.register(controller);
  }
  const fetchHandler = toFetchHandler(router);

  return {
    container,
    handle: req => router.handle(req),
    fetch: request => fetchHandler(request),
    init: () => runInit(controllers),
    [Symbol.asyncDispose]: () => runShutdown(controllers),
  };
}
