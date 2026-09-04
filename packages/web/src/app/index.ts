// @zmdb/web — application bootstrap & lifecycle (epic #292, spec ./SPEC.md).
// createApp compiles the module graph, wires routes once, and exposes lifecycle
// hooks + `await using` graceful shutdown. Per-request path is unchanged. No
// reflection per request; no `as` on the consumer surface.

import type { Container } from '../di/index.js';
import { runInit, runShutdown } from '../lifecycle.js';
import { compileModule, type LazyModuleHandle, type ModuleClass } from '../modules/index.js';
import { runtimeOf } from '../modules/runtime.js';
import { createRouter, toFetchHandler, type Router, type WebRequest, type WebResponse } from '../pipeline/index.js';

export type { OnApplicationBootstrap, OnModuleInit, OnShutdown } from '../lifecycle.js';

/** A bootstrapped application. */
export interface App extends AsyncDisposable {
  readonly container: Container;
  readonly lazy: readonly LazyModuleHandle[];
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
  const compiled = compileModule(rootModule);
  const { container, controllers, lazy } = compiled;
  const eagerControllers = [...controllers];
  const runtime = runtimeOf(compiled);
  const router: Router = createRouter();
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
  const fetchHandler = toFetchHandler(router);

  return {
    container,
    lazy,
    handle: req => router.handle(req),
    fetch: request => fetchHandler(request),
    init: () => runInit(eagerControllers),
    [Symbol.asyncDispose]: async () => {
      runtime?.beginShutdown();
      await runtime?.waitForLoads();
      await runShutdown(controllers);
    },
  };
}
