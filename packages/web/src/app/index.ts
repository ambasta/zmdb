// @zmdb/web — HTTP application composition over the protocol-neutral kernel.
// One @zmdb/app graph owns construction, lazy loading and lifecycle; this file
// adds one startup-built router and the still-web-owned typed gRPC integration.

import {
  createApplication,
  type Application,
  type ApplicationExtension,
  type ApplicationOptions,
  type ModuleClass,
} from '@zmdb/app';

import { openBoundGrpcServer, type OpenedGrpcServer } from '../microservices/grpc/bridge.js';
import type { GrpcServerOptions } from '../microservices/grpc/types.js';
import {
  createRouter,
  toFetchHandler,
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
 * Transitional web options retain the typed gRPC field until #649 removes it.
 * Broker strategies attach through `ApplicationOptions.extensions`.
 */
export interface WebApplicationOptions extends ApplicationOptions {
  readonly guardRegistry?: GuardRegistry;
  readonly versioning?: VersionStrategy;
  readonly grpc?: GrpcServerOptions;
}

/** A protocol-neutral application with one HTTP router attached. */
export interface WebApplication extends Application {
  handle(req: WebRequest): Promise<WebResponse>;
  fetch(request: Request): Promise<Response>;
}

/** Compatibility name retained until the HTTP package cutover in #649. */
export type App = WebApplication;

/**
 * Compose one router over one application graph. The container, lazy handles,
 * init function and async-dispose function are the app-owned members by
 * identity; no second lifecycle or construction ledger exists here.
 */
export function createApp(rootModule: ModuleClass, options: WebApplicationOptions = {}): WebApplication {
  const grpc = grpcExtension(options.grpc);
  const extensions = [...(options.extensions ?? []), ...(grpc === undefined ? [] : [grpc])];
  const applicationOptions: ApplicationOptions = {
    ...(options.graceMs === undefined ? {} : { graceMs: options.graceMs }),
    ...(options.observability === undefined ? {} : { observability: options.observability }),
    ...(extensions.length === 0 ? {} : { extensions }),
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
  const fetchHandler = toFetchHandler(router);

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

function grpcExtension(options: GrpcServerOptions | undefined): ApplicationExtension | undefined {
  if (options === undefined) {
    return undefined;
  }

  let openedGrpc: OpenedGrpcServer | undefined;
  return {
    name: '@zmdb/web:grpc',
    async start() {
      openedGrpc = await openBoundGrpcServer(options);
    },
    async stop({ graceMs }) {
      try {
        await openedGrpc?.close(graceMs);
      } finally {
        openedGrpc = undefined;
      }
    },
  };
}
