// @zmdb/web — application bootstrap & lifecycle (epic #292, spec ./SPEC.md).
// createApp compiles the module graph, wires routes once, and exposes lifecycle
// hooks + `await using` graceful shutdown. Per-request path is unchanged. No
// reflection per request; no `as` on the consumer surface.

import type { Container } from '../di/index.js';
import { runInit, runShutdown } from '../lifecycle.js';
import {
  createMessageDispatcher,
  getMessagePatterns,
  type AppOptions,
  type DispatcherOptions,
  type RawMessage,
  type Settlement,
  type TransportStrategy,
} from '../microservices/index.js';
import { compileModule, type LazyModuleHandle, type ModuleClass } from '../modules/index.js';
import { lifecycleInstances } from '../modules/lifecycle-instances.js';
import { runtimeOf } from '../modules/runtime.js';
import { createRouter, toFetchHandler, type Router, type WebRequest, type WebResponse } from '../pipeline/index.js';

export type { OnApplicationBootstrap, OnModuleInit, OnShutdown } from '../lifecycle.js';
export type { AppOptions } from '../microservices/index.js';

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
export function createApp(rootModule: ModuleClass, options: AppOptions = {}): App {
  const compiled = compileModule(rootModule);
  const { container, controllers, lazy } = compiled;
  const instances = lifecycleInstances(container);
  const runtime = runtimeOf(compiled);
  const transports = [...(options.transports ?? [])];
  const graceMs = transportGrace(options.graceMs ?? 5_000);
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
  let opened: TransportStrategy[] = [];
  let initPromise: Promise<void> | undefined;
  let disposePromise: Promise<void> | undefined;

  const start = async (): Promise<void> => {
    await runInit(instances);
    if (transports.length === 0) {
      return;
    }

    const dispatcherOptions = options.dispatcher;
    if (dispatcherOptions === undefined) {
      throw new Error('@zmdb/web: transports require dispatcher observation sinks');
    }
    validateTransportNames(transports);
    validateLazyConsumers(runtime?.routes ?? []);
    for (const transport of transports) {
      validateUndeliverableSink(transport, dispatcherOptions);
    }

    const dispatcher = createMessageDispatcher(controllers, dispatcherOptions);
    const started: TransportStrategy[] = [];
    try {
      for (const transport of transports) {
        await transport.listen(async message => {
          const outcome = await dispatcher.dispatch(message, transport.name);
          reportUndeliverable(transport, dispatcherOptions, message, outcome.settlement);
          return outcome;
        });
        started.push(transport);
      }
    } catch (error) {
      await closeIgnoringFailures(started, graceMs);
      throw error;
    }
    opened = started;
  };

  const dispose = async (): Promise<void> => {
    runtime?.beginShutdown();
    await runtime?.waitForLoads();
    if (initPromise !== undefined) {
      try {
        await initPromise;
      } catch {
        // Startup already reported its own error. Disposal still runs hooks.
      }
    }

    let closeFailed = false;
    let closeError: unknown;
    try {
      await closeAll(opened, graceMs);
    } catch (error) {
      closeFailed = true;
      closeError = error;
    } finally {
      opened = [];
    }
    let shutdownFailed = false;
    let shutdownError: unknown;
    try {
      await runShutdown(instances);
    } catch (error) {
      shutdownFailed = true;
      shutdownError = error;
    }
    if (closeFailed) {
      throw closeError;
    }
    if (shutdownFailed) {
      throw shutdownError;
    }
  };

  return {
    container,
    lazy,
    handle: req => router.handle(req),
    fetch: request => fetchHandler(request),
    init: () => {
      if (disposePromise !== undefined) {
        return Promise.reject(new Error('@zmdb/web: application is shutting down'));
      }
      initPromise ??= start();
      return initPromise;
    },
    [Symbol.asyncDispose]: () => {
      disposePromise ??= dispose();
      return disposePromise;
    },
  };
}

function transportGrace(value: number): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError('@zmdb/web: graceMs must be a positive integer');
  }
  return value;
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

function validateLazyConsumers(
  routes: readonly (
    | { readonly kind: 'eager'; readonly controller: object }
    | {
        readonly kind: 'deferred';
        readonly controller: abstract new (...args: never[]) => object;
        readonly instance: () => Promise<object>;
      }
  )[],
): void {
  for (const route of routes) {
    if (route.kind === 'deferred' && getMessagePatterns(route.controller).length > 0) {
      throw new Error(
        `@zmdb/web: lazy controller "${route.controller.name}" declares message patterns; message consumers must be eager`,
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

async function closeIgnoringFailures(transports: readonly TransportStrategy[], graceMs: number): Promise<void> {
  for (let index = transports.length - 1; index >= 0; index -= 1) {
    try {
      await transports[index]?.close(graceMs);
    } catch {
      // Preserve the startup error; close remains best effort on that path.
    }
  }
}

async function closeAll(transports: readonly TransportStrategy[], graceMs: number): Promise<void> {
  let failed = false;
  let firstError: unknown;
  for (let index = transports.length - 1; index >= 0; index -= 1) {
    try {
      await transports[index]?.close(graceMs);
    } catch (error) {
      if (!failed) {
        failed = true;
        firstError = error;
      }
    }
  }
  if (failed) {
    throw firstError;
  }
}
