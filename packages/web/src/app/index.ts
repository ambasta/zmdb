// @zmdb/web — HTTP application composition over the protocol-neutral kernel.
// One @zmdb/app graph owns construction, lazy loading and lifecycle; this file
// adds one startup-built router and the still-web-owned transport integrations.

import {
  createApplication,
  type Application,
  type ApplicationExtension,
  type ApplicationExtensionContext,
  type ApplicationOptions,
  type ModuleClass,
} from '@zmdb/app';

import { openBoundGrpcServer, type OpenedGrpcServer } from '../microservices/grpc/bridge.js';
import {
  createMessageDispatcher,
  getMessagePatterns,
  type AppOptions,
  type DispatcherOptions,
  type RawMessage,
  type Settlement,
  type TransportStrategy,
} from '../microservices/index.js';
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
export type { AppOptions } from '../microservices/index.js';

/**
 * Transitional web options retain the current broker/gRPC fields until #648
 * moves them behind public app extensions. The application, HTTP and lifecycle
 * fields already have their final owners.
 */
export interface WebApplicationOptions extends AppOptions, ApplicationOptions {
  readonly guardRegistry?: GuardRegistry;
  readonly versioning?: VersionStrategy;
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
  let controllerBindings: readonly CompiledController[] = [];
  const legacyExtension = legacyTransportExtension(options, () => controllerBindings);
  const extensions = [...(options.extensions ?? []), ...(legacyExtension === undefined ? [] : [legacyExtension])];
  const applicationOptions: ApplicationOptions = {
    ...(options.graceMs === undefined ? {} : { graceMs: options.graceMs }),
    ...(options.observability === undefined ? {} : { observability: options.observability }),
    ...(extensions.length === 0 ? {} : { extensions }),
  };
  const application = createApplication(rootModule, applicationOptions);
  controllerBindings = applicationControllersOf(application);

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

function legacyTransportExtension(
  options: WebApplicationOptions,
  controllers: () => readonly CompiledController[],
): ApplicationExtension | undefined {
  const transports = [...(options.transports ?? [])];
  if (transports.length === 0 && options.grpc === undefined) {
    return undefined;
  }

  let opened: TransportStrategy[] = [];
  let openedGrpc: OpenedGrpcServer | undefined;
  return {
    name: '@zmdb/web:legacy-transports',
    async start(context) {
      const dispatcherOptions = options.dispatcher;
      if (transports.length > 0 && dispatcherOptions === undefined) {
        throw new Error('@zmdb/web: transports require dispatcher observation sinks');
      }
      if (dispatcherOptions !== undefined) {
        validateTransportNames(transports);
        validateLazyConsumers(controllers());
        for (const transport of transports) {
          validateUndeliverableSink(transport, dispatcherOptions);
        }
        await startTransports(transports, dispatcherOptions, context, opened);
      }
      if (options.grpc !== undefined) {
        openedGrpc = await openBoundGrpcServer(options.grpc);
      }
    },
    async stop({ graceMs }) {
      const errors: unknown[] = [];
      try {
        await openedGrpc?.close(graceMs);
      } catch (error) {
        errors.push(error);
      } finally {
        openedGrpc = undefined;
      }
      for (let index = opened.length - 1; index >= 0; index -= 1) {
        try {
          await opened[index]?.close(graceMs);
        } catch (error) {
          errors.push(error);
        }
      }
      opened = [];
      throwObserved(errors);
    },
  };
}

async function startTransports(
  transports: readonly TransportStrategy[],
  options: DispatcherOptions,
  context: ApplicationExtensionContext,
  opened: TransportStrategy[],
): Promise<void> {
  const dispatcher = createMessageDispatcher(context.controllers, {
    ...options,
    observability: context.observability,
  });
  for (const transport of transports) {
    await transport.listen(async message => {
      const outcome = await dispatcher.dispatch(message, transport.name);
      reportUndeliverable(transport, options, message, outcome.settlement);
      return outcome;
    });
    opened.push(transport);
  }
}

function validateTransportNames(transports: readonly TransportStrategy[]): void {
  const names = new Set<string>();
  for (const transport of transports) {
    if (transport.name.length === 0) {
      throw new RangeError('@zmdb/web: a transport name cannot be empty');
    }
    if (names.has(transport.name)) {
      throw new Error(`@zmdb/web: duplicate transport name "${transport.name}"`);
    }
    names.add(transport.name);
  }
}

function validateLazyConsumers(controllers: readonly CompiledController[]): void {
  for (const binding of controllers) {
    if (binding.kind === 'deferred' && getMessagePatterns(binding.controller).length > 0) {
      throw new Error(
        `@zmdb/web: lazy controller "${binding.controller.name}" declares message patterns; ` +
          'message consumers must be eager',
      );
    }
  }
}

function validateUndeliverableSink(transport: TransportStrategy, options: DispatcherOptions): void {
  if (
    (!transport.capabilities.redelivery || !transport.capabilities.deadLetter) &&
    options.onUndeliverable === undefined
  ) {
    throw new Error(`@zmdb/web: transport "${transport.name}" requires onUndeliverable`);
  }
}

function reportUndeliverable(
  transport: TransportStrategy,
  options: DispatcherOptions,
  message: RawMessage,
  settlement: Settlement,
): void {
  const dropped =
    (settlement.kind === 'retry' && !transport.capabilities.redelivery) ||
    (settlement.kind === 'dead' && !transport.capabilities.deadLetter);
  if (!dropped || options.onUndeliverable === undefined) {
    return;
  }
  try {
    void Promise.resolve(options.onUndeliverable(message, settlement)).catch(() => undefined);
  } catch {
    // Observation cannot replace the settlement the strategy must apply.
  }
}

function throwObserved(errors: readonly unknown[]): void {
  if (errors.length === 0) return;
  const first = errors[0];
  if (errors.length === 1 && first !== undefined) throw first;
  throw new AggregateError(errors, '@zmdb/web: transport shutdown failed');
}
