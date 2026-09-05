// @zmdb/web — HTTP application composition over the protocol-neutral kernel.
// One @zmdb/app graph owns construction, lazy loading and lifecycle; this file
// adds one startup-built router; protocol integrations remain explicit app extensions.

import { createApplication, type Application, type ApplicationOptions, type ModuleClass } from '@zmdb/app';

import {
  createRouter,
  toFetchHandler,
  type AdapterOptions,
  type GuardRegistry,
  type Router,
  type RouterOptions,
  type WebRequest,
  type WebResponse,
} from '../pipeline/index.js';
import type { VersionStrategy } from '../versioning/index.js';
import { applicationControllersOf, type CompiledController } from './bridge.js';

export type { OnApplicationBootstrap, OnModuleInit, OnShutdown } from '@zmdb/app/lifecycle';

/**
 * Protocol integrations attach through `ApplicationOptions.extensions`.
 */
export interface WebApplicationOptions extends ApplicationOptions, AdapterOptions {
  readonly guardRegistry?: GuardRegistry;
  readonly versioning?: VersionStrategy;
}

/** A protocol-neutral application with one HTTP router attached. */
export interface WebApplication extends Application {
  handle(req: WebRequest): Promise<WebResponse>;
  fetch(request: Request): Promise<Response>;
}

/**
 * Compose one router over one application graph. The container, lazy handles,
 * init function and async-dispose function are the app-owned members by
 * identity; no second lifecycle or construction ledger exists here.
 */
export function createApp(rootModule: ModuleClass, options: WebApplicationOptions = {}): WebApplication {
  const applicationOptions: ApplicationOptions = {
    ...(options.graceMs === undefined ? {} : { graceMs: options.graceMs }),
    ...(options.observability === undefined ? {} : { observability: options.observability }),
    ...(options.extensions === undefined ? {} : { extensions: options.extensions }),
  };
  const application = createApplication(rootModule, applicationOptions);
  const controllerBindings: readonly CompiledController[] = applicationControllersOf(application);

  const router: Router = createRouter(routerOptions(options));
  for (const binding of controllerBindings) {
    if (binding.kind === 'eager') {
      router.register(binding.controller);
    } else {
      router.registerDeferred(binding.controller, binding.instance);
    }
  }
  const fetchHandler = toFetchHandler(router, options);

  return {
    container: application.container,
    lazy: application.lazy,
    handle: req => router.handle(req),
    fetch: request => fetchHandler(request),
    init: application.init,
    [Symbol.asyncDispose]: application[Symbol.asyncDispose],
  };
}

function routerOptions(options: WebApplicationOptions): RouterOptions {
  const observability = options.observability ?? {};
  return {
    ...observability,
    ...(options.guardRegistry === undefined ? {} : { guardRegistry: options.guardRegistry }),
    ...(options.versioning === undefined ? {} : { versioning: options.versioning }),
  };
}
