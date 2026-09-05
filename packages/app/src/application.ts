import type { Container } from './di/index.js';
import { runInit, runShutdown } from './lifecycle.js';
import { compileModule, type CompiledModule, type LazyModuleHandle, type ModuleClass } from './modules/index.js';
import { lifecycleInstances } from './modules/lifecycle-instances.js';
import { runtimeOf, type CompiledController } from './modules/runtime.js';
import type { Observability } from './observability/types.js';

const APPLICATION_BRIDGE = Symbol.for('@zmdb/app.application-bridge');
const COMPILED_APPLICATION = Symbol.for('@zmdb/app.compiled-application');
const DEFAULT_GRACE_MS = 5_000;
const EMPTY_OBSERVABILITY: Observability = Object.freeze({});

interface CompiledApplicationOptions {
  readonly [COMPILED_APPLICATION]?: CompiledModule;
}

/** Private cross-package bridge used by HTTP/testing adapters without widening Application. */
export interface ApplicationBridge {
  readonly compiled: CompiledModule;
  readonly controllers: readonly CompiledController[];
}

interface BridgedApplication extends Application {
  readonly [APPLICATION_BRIDGE]?: ApplicationBridge;
}

export interface ApplicationExtensionContext {
  readonly container: Container;
  readonly controllers: readonly object[];
  readonly commands: readonly object[];
  readonly observability: Observability;
}

export interface ApplicationExtension {
  readonly name: string;
  start(context: ApplicationExtensionContext): void | Promise<void>;
  stop(options: { readonly graceMs: number }): void | Promise<void>;
}

export interface ApplicationOptions {
  readonly extensions?: readonly ApplicationExtension[];
  readonly observability?: Observability;
  readonly graceMs?: number;
}

export interface Application extends AsyncDisposable {
  readonly container: Container;
  readonly lazy: readonly LazyModuleHandle[];
  init(): Promise<void>;
}

/**
 * Compile one protocol-neutral application and own its complete lifecycle.
 *
 * The two symbol-keyed bridge properties are non-enumerable implementation
 * details. They let the HTTP and testing adapters consume the same compiled
 * identities without adding public Application fields or compiling twice.
 */
export function createApplication(rootModule: ModuleClass, options: ApplicationOptions = {}): Application {
  const graceMs = applicationGrace(options.graceMs ?? DEFAULT_GRACE_MS);
  const extensions = validatedExtensions(options.extensions ?? []);
  const compiled = compiledApplication(options) ?? compileModule(rootModule);
  const runtime = runtimeOf(compiled);
  const instances = lifecycleInstances(compiled.container);
  const observability = options.observability ?? EMPTY_OBSERVABILITY;
  const context: ApplicationExtensionContext = Object.freeze({
    container: compiled.container,
    controllers: Object.freeze([...compiled.controllers]),
    commands: Object.freeze([...compiled.commands]),
    observability,
  });
  const entered: ApplicationExtension[] = [];
  let state: 'created' | 'starting' | 'running' | 'stopping' | 'stopped' | 'failed-cleaned' = 'created';
  let initPromise: Promise<void> | undefined;
  let disposePromise: Promise<void> | undefined;

  const stopEntered = async (): Promise<unknown[]> => {
    const errors: unknown[] = [];
    const deadline = Date.now() + graceMs;
    for (let index = entered.length - 1; index >= 0; index -= 1) {
      const extension = entered[index];
      if (extension === undefined) continue;
      try {
        await extension.stop({ graceMs: Math.max(0, deadline - Date.now()) });
      } catch (error) {
        errors.push(error);
      }
    }
    entered.length = 0;
    return errors;
  };

  const shutdownInstances = async (): Promise<unknown[]> => {
    try {
      await runShutdown(instances);
      return [];
    } catch (error) {
      return errorsOf(error);
    }
  };

  const start = async (): Promise<void> => {
    state = 'starting';
    try {
      await runInit(instances);
      for (const extension of extensions) {
        entered.push(extension);
        await extension.start(context);
      }
      state = 'running';
    } catch (startupError) {
      runtime?.beginShutdown();
      await runtime?.waitForLoads();
      const cleanupErrors = [...(await stopEntered()), ...(await shutdownInstances())];
      state = 'failed-cleaned';
      if (cleanupErrors.length === 0) throw startupError;
      throw new AggregateError([startupError, ...cleanupErrors], '@zmdb/app: application startup cleanup failed', {
        cause: startupError,
      });
    }
  };

  const dispose = async (): Promise<void> => {
    runtime?.beginShutdown();
    if (initPromise !== undefined) {
      try {
        await initPromise;
      } catch {
        // Failed initialization performed its own complete cleanup transaction.
        return;
      }
    }
    if (state === 'failed-cleaned' || state === 'stopped') return;

    state = 'stopping';
    await runtime?.waitForLoads();
    const errors = [...(await stopEntered()), ...(await shutdownInstances())];
    state = 'stopped';
    throwObserved(errors, '@zmdb/app: application shutdown failed');
  };

  const application: Application = {
    container: compiled.container,
    lazy: compiled.lazy,
    init: () => {
      if (disposePromise !== undefined) {
        return Promise.reject(new Error('@zmdb/app: application is shutting down'));
      }
      initPromise ??= start();
      return initPromise;
    },
    [Symbol.asyncDispose]: () => {
      disposePromise ??= dispose();
      return disposePromise;
    },
  };

  Object.defineProperty(application, APPLICATION_BRIDGE, {
    value: Object.freeze({
      compiled,
      controllers:
        runtime?.controllers ??
        Object.freeze(compiled.controllers.map(controller => ({ kind: 'eager' as const, controller }))),
    }),
  });
  return application;
}

/** Package-private access for command applications. */
export function applicationBridgeOf(application: Application): ApplicationBridge {
  const carrier: BridgedApplication = application;
  const bridge = carrier[APPLICATION_BRIDGE];
  if (bridge === undefined) {
    throw new Error('@zmdb/app: application omitted its compiled graph');
  }
  return bridge;
}

function compiledApplication(options: ApplicationOptions): CompiledModule | undefined {
  const carrier: ApplicationOptions & CompiledApplicationOptions = options;
  return carrier[COMPILED_APPLICATION];
}

function applicationGrace(value: number): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError('@zmdb/app: graceMs must be a positive integer');
  }
  return value;
}

function validatedExtensions(values: readonly ApplicationExtension[]): readonly ApplicationExtension[] {
  const names = new Set<string>();
  const extensions = [...values];
  for (const extension of extensions) {
    if (extension.name.length === 0) {
      throw new RangeError('@zmdb/app: an extension name cannot be empty');
    }
    if (names.has(extension.name)) {
      throw new Error(`@zmdb/app: duplicate extension name "${extension.name}"`);
    }
    names.add(extension.name);
  }
  return Object.freeze(extensions);
}

function errorsOf(error: unknown): unknown[] {
  return error instanceof AggregateError ? [...error.errors] : [error];
}

function throwObserved(errors: readonly unknown[], message: string): void {
  if (errors.length === 0) return;
  const first = errors[0];
  if (errors.length === 1 && first !== undefined) throw first;
  throw new AggregateError(errors, message);
}
