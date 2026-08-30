// @zmdb/web — application bootstrap & lifecycle (epic #292, spec ./SPEC.md).
// createApp compiles the module graph, wires routes once, and exposes lifecycle
// hooks + `await using` graceful shutdown. Per-request path is unchanged. No
// reflection per request; no `as` on the consumer surface.

import { compileModule, type ModuleClass } from '../modules/index.ts';
import { createRouter, toFetchHandler, type Router, type WebRequest, type WebResponse } from '../pipeline/index.ts';
import { Container } from '../di/index.ts';

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

/** A bootstrapped application. */
export interface App extends AsyncDisposable {
  readonly container: Container;
  handle(req: WebRequest): Promise<WebResponse>;
  fetch(request: Request): Promise<Response>;
  init(): Promise<void>;
}

// Structural hook detection — no casts, just `in`-narrowing on the instance.
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
    handle: (req) => router.handle(req),
    fetch: (request) => fetchHandler(request),
    async init(): Promise<void> {
      for (const controller of controllers) {
        if (hasModuleInit(controller)) {
          await controller.onModuleInit();
        }
      }
      for (const controller of controllers) {
        if (hasBootstrap(controller)) {
          await controller.onApplicationBootstrap();
        }
      }
    },
    async [Symbol.asyncDispose](): Promise<void> {
      for (let i = controllers.length - 1; i >= 0; i -= 1) {
        const controller = controllers[i];
        if (controller !== undefined && hasShutdown(controller)) {
          await controller.onShutdown();
        }
      }
    },
  };
}
