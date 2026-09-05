// @zmdb/web — in-process HTTP testing over the app-owned graph and lifecycle.

import {
  compileModule,
  createApplication,
  type ApplicationOptions,
  type Container,
  type ModuleClass,
  type ProviderDef,
  type Token,
} from '@zmdb/app';
import type { Observability } from '@zmdb/app/observability';

import { applicationControllersOf, withCompiledApplication } from '../app/bridge.js';
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
  close(): Promise<void>;
}

/**
 * Compile one overridden graph, hand that exact graph to createApplication,
 * and drive its controllers through the production HTTP router.
 */
export function createTestApp(rootModule: ModuleClass, options: TestAppOptions = {}): TestApp {
  const compiled = compileModule(rootModule, options.overrides ?? []);
  const applicationOptions: ApplicationOptions =
    options.observability === undefined ? {} : { observability: options.observability };
  const application = createApplication(rootModule, withCompiledApplication(applicationOptions, compiled));
  const router: Router = createRouter(options.observability);
  for (const binding of applicationControllersOf(application)) {
    if (binding.kind === 'eager') {
      router.register(binding.controller);
    } else {
      router.registerDeferred(binding.controller, binding.instance);
    }
  }

  const app: TestApp = {
    request: req => router.handle(req),
    get: <T>(token: Token<T>): T => resolveFrom(application.container, token),
    init: application.init,
    close: async () => application[Symbol.asyncDispose](),
    [Symbol.asyncDispose]: application[Symbol.asyncDispose],
  };
  Object.defineProperty(app, 'close', {
    enumerable: false,
  });
  return app;
}

function resolveFrom<T>(container: Container, token: Token<T>): T {
  return container.resolve(token);
}
