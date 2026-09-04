// @zmdb/web — modules & providers (epic #282, spec ./SPEC.md). @Module records a
// module graph in context.metadata; compileModule validates its declarations,
// constructs eager modules, and retains per-app handles for lazy subtrees.

import '../polyfill.js';
import {
  Container,
  injectionsOf,
  UnresolvedTokenError,
  type Constructor,
  type Scope,
  type Token,
} from '../di/index.js';
import { runInit } from '../lifecycle.js';
import { createLifecycleRecorder, lifecycleInstances } from './lifecycle-instances.js';
import { rememberRuntime, type CompiledRoute } from './runtime.js';

/** A provider binds a token to a value or a factory, with an optional scope. */
export type ProviderDef<T = unknown> =
  | { readonly token: Token<T>; readonly useValue: T }
  | { readonly token: Token<T>; readonly useFactory: (container: Container) => T; readonly scope?: Scope };

/** A module class (nominal — carries its definition in Symbol.metadata). */
export type ModuleClass = abstract new (...args: never[]) => unknown;

/** An inert declaration that defers one imported module's instantiation. */
export interface LazyImport {
  readonly kind: 'lazy';
  readonly module: ModuleClass;
}

/** The `@Module` definition. */
export interface ModuleDef {
  readonly controllers?: readonly Constructor<object>[];
  readonly providers?: readonly ProviderDef[];
  readonly imports?: readonly (ModuleClass | LazyImport)[];
  readonly exports?: readonly Token<unknown>[];
}

export type LazyStatus = 'unloaded' | 'loading' | 'loaded' | 'failed';

export interface LazyModuleHandle {
  readonly name: string;
  readonly status: LazyStatus;
  load(): Promise<void>;
}

/** The result of compiling a module graph. */
export interface CompiledModule {
  readonly container: Container;
  readonly controllers: readonly object[];
  readonly lazy: readonly LazyModuleHandle[];
}

const MODULE = Symbol('zmdb.web.module');

interface ModuleMetadata {
  [MODULE]?: ModuleDef;
}

interface CompilePlan {
  readonly definitions: ReadonlyMap<ModuleClass, ModuleDef>;
  readonly moduleOrder: readonly ModuleClass[];
  readonly eagerModules: ReadonlySet<ModuleClass>;
  readonly providerModules: ReadonlyMap<Token<unknown>, ModuleClass>;
  readonly lazyRoots: readonly ModuleClass[];
  readonly lazyOrders: ReadonlyMap<ModuleClass, readonly ModuleClass[]>;
}

const compilePlans = new WeakMap<ModuleClass, CompilePlan>();

// boundary: our @Module decorator is the only writer of the MODULE slot, so
// viewing the record through ModuleMetadata is sound (ARCHITECTURE.md §2.1).
function moduleView(metadata: DecoratorMetadata): ModuleMetadata {
  return metadata;
}

/** Stage-3 class decorator: record a module definition. */
export function Module(def: ModuleDef) {
  return function <T extends ModuleClass>(_target: T, context: ClassDecoratorContext<T>): void {
    moduleView(context.metadata)[MODULE] = def;
  };
}

/** Declare an import whose instances are constructed on first use. */
export function lazy(module: ModuleClass): LazyImport {
  return { kind: 'lazy', module };
}

/** Read the module declaration written by `@Module`. */
export function moduleDefOf(moduleClass: ModuleClass): ModuleDef | undefined {
  const metadata = moduleClass[Symbol.metadata];
  if (metadata === undefined || metadata === null) {
    return undefined;
  }
  return moduleView(metadata)[MODULE];
}

/**
 * Validate a module graph, construct its eager modules, and retain per-app
 * handles for lazy subtrees. Overrides are registered before construction and
 * remain authoritative when a lazy subtree is loaded later.
 */
export function compileModule(rootModule: ModuleClass, overrides: readonly ProviderDef[] = []): CompiledModule {
  const plan = compilePlans.get(rootModule) ?? buildCompilePlan(rootModule);
  validateInjections(plan, overrides);

  const container = new Container();
  const controllers: object[] = [];
  const recordInstance = createLifecycleRecorder(container);
  for (const override of overrides) {
    registerProvider(container, override, recordInstance);
  }

  // Preserve the original eager path: imports are in post-order, and each
  // module registers its providers immediately before building its controllers.
  if (plan.lazyRoots.length === 0) {
    for (const moduleClass of plan.moduleOrder) {
      instantiateEagerModule(moduleClass, plan.definitions, container, controllers, overrides, recordInstance);
    }
    return { container, controllers, lazy: [] };
  }

  const controllerInstances = new Map<ModuleClass, Map<Constructor<object>, object>>();
  const instantiated = new Set<ModuleClass>();
  const pendingLoads = new Set<Promise<void>>();
  let shuttingDown = false;

  const instantiateModules = (order: readonly ModuleClass[]): object[] => {
    const firstInstance = lifecycleInstances(container).length;
    for (const moduleClass of order) {
      if (instantiated.has(moduleClass)) {
        continue;
      }
      instantiated.add(moduleClass);
      const def = plan.definitions.get(moduleClass);
      for (const provider of def?.providers ?? []) {
        if (!isOverridden(overrides, provider)) {
          registerProvider(container, provider, recordInstance);
        }
      }
      const instances = new Map<Constructor<object>, object>();
      controllerInstances.set(moduleClass, instances);
      for (const Controller of def?.controllers ?? []) {
        const instance = container.build(Controller);
        recordInstance(instance);
        instances.set(Controller, instance);
        controllers.push(instance);
      }
    }
    return lifecycleInstances(container).slice(firstInstance);
  };

  const eagerOrder = plan.moduleOrder.filter(module => plan.eagerModules.has(module));
  instantiateModules(eagerOrder);

  const lazyHandles: LazyModuleHandle[] = [];
  const handleByModule = new Map<ModuleClass, LazyModuleHandle>();

  const createLazyHandle = (name: string, wire: () => object[]): LazyModuleHandle => {
    let status: LazyStatus = 'unloaded';
    let inFlight: Promise<void> | undefined;
    let failure: unknown;

    return {
      name,
      get status(): LazyStatus {
        return status;
      },
      load(): Promise<void> {
        if (status === 'loaded') {
          return Promise.resolve();
        }
        if (status === 'failed') {
          return Promise.reject(failure);
        }
        if (shuttingDown) {
          return Promise.reject(new Error('@zmdb/web: application is shutting down'));
        }
        if (inFlight !== undefined) {
          return inFlight;
        }

        status = 'loading';
        let instances: object[];
        try {
          instances = wire();
        } catch (error) {
          failure = error;
          status = 'failed';
          return Promise.reject(error);
        }

        const load = runInit(instances).then(
          () => {
            status = 'loaded';
          },
          error => {
            failure = error;
            status = 'failed';
            throw error;
          },
        );
        inFlight = load;
        pendingLoads.add(load);
        void load.then(
          () => {
            inFlight = undefined;
            pendingLoads.delete(load);
          },
          () => {
            inFlight = undefined;
            pendingLoads.delete(load);
          },
        );
        return load;
      },
    };
  };

  for (const root of plan.lazyRoots) {
    const loadOrder = plan.lazyOrders.get(root) ?? [];
    const handle = createLazyHandle(root.name, () => instantiateModules(loadOrder));
    lazyHandles.push(handle);
    for (const moduleClass of loadOrder) {
      if (!handleByModule.has(moduleClass)) {
        handleByModule.set(moduleClass, handle);
      }
    }
  }

  const routes: CompiledRoute[] = [];
  for (const moduleClass of plan.moduleOrder) {
    const def = plan.definitions.get(moduleClass);
    if (def === undefined) {
      continue;
    }
    if (plan.eagerModules.has(moduleClass)) {
      const instances = controllerInstances.get(moduleClass);
      for (const Controller of def.controllers ?? []) {
        const instance = instances?.get(Controller);
        if (instance !== undefined) {
          routes.push({ kind: 'eager', controller: instance });
        }
      }
      continue;
    }
    const handle = handleByModule.get(moduleClass);
    if (handle === undefined) {
      continue;
    }
    for (const Controller of def.controllers ?? []) {
      routes.push({
        kind: 'deferred',
        controller: Controller,
        instance: async (): Promise<object> => {
          await handle.load();
          const instance = controllerInstances.get(moduleClass)?.get(Controller);
          if (instance === undefined) {
            throw new Error(`@zmdb/web: lazy controller ${Controller.name} was not constructed`);
          }
          return instance;
        },
      });
    }
  }

  const compiled: CompiledModule = { container, controllers, lazy: lazyHandles };
  rememberRuntime(compiled, {
    routes,
    beginShutdown: () => {
      shuttingDown = true;
    },
    waitForLoads: async () => {
      await Promise.allSettled(pendingLoads);
    },
  });
  return compiled;
}

function buildCompilePlan(rootModule: ModuleClass): CompilePlan {
  const definitions = new Map<ModuleClass, ModuleDef>();
  const moduleOrder: ModuleClass[] = [];
  const visiting = new Set<ModuleClass>();
  const visited = new Set<ModuleClass>();
  const eagerModules = new Set<ModuleClass>();
  const providerModules = new Map<Token<unknown>, ModuleClass>();

  const collect = (moduleClass: ModuleClass): void => {
    if (visited.has(moduleClass)) {
      return;
    }
    if (visiting.has(moduleClass)) {
      const path = [...visiting];
      const repeatedAt = path.indexOf(moduleClass);
      const cycle = [...path.slice(repeatedAt), moduleClass].map(module => module.name).join(' -> ');
      throw new Error(`@zmdb/web: import cycle in the module graph: ${cycle}`);
    }
    visiting.add(moduleClass);
    const def = moduleDefOf(moduleClass);
    if (def !== undefined) {
      definitions.set(moduleClass, def);
      for (const imported of def.imports ?? []) {
        collect(typeof imported === 'function' ? imported : imported.module);
      }
    }
    visiting.delete(moduleClass);
    visited.add(moduleClass);
    moduleOrder.push(moduleClass);
  };

  const markEager = (moduleClass: ModuleClass): void => {
    if (eagerModules.has(moduleClass)) {
      return;
    }
    eagerModules.add(moduleClass);
    for (const imported of definitions.get(moduleClass)?.imports ?? []) {
      if (typeof imported === 'function') {
        markEager(imported);
      }
    }
  };

  collect(rootModule);
  markEager(rootModule);

  for (const moduleClass of moduleOrder) {
    for (const provider of definitions.get(moduleClass)?.providers ?? []) {
      const previous = providerModules.get(provider.token);
      if (previous !== undefined && previous !== moduleClass) {
        throw new Error(
          `@zmdb/web: duplicate provider token "${provider.token.description}" in ${previous.name} and ${moduleClass.name}`,
        );
      }
      providerModules.set(provider.token, moduleClass);
    }
  }

  const lazyRoots: ModuleClass[] = [];
  const seenLazyRoots = new Set<ModuleClass>();
  for (const moduleClass of moduleOrder) {
    if (!eagerModules.has(moduleClass)) {
      continue;
    }
    for (const imported of definitions.get(moduleClass)?.imports ?? []) {
      if (typeof imported !== 'function' && !eagerModules.has(imported.module) && !seenLazyRoots.has(imported.module)) {
        seenLazyRoots.add(imported.module);
        lazyRoots.push(imported.module);
      }
    }
  }

  const lazyOrders = new Map<ModuleClass, readonly ModuleClass[]>();
  for (const root of lazyRoots) {
    lazyOrders.set(root, lazySubtreeOrder(root, definitions, moduleOrder, eagerModules));
  }

  const plan: CompilePlan = {
    definitions,
    moduleOrder,
    eagerModules,
    providerModules,
    lazyRoots,
    lazyOrders,
  };
  compilePlans.set(rootModule, plan);
  return plan;
}

function validateInjections(plan: CompilePlan, overrides: readonly ProviderDef[]): void {
  for (const moduleClass of plan.moduleOrder) {
    for (const Controller of plan.definitions.get(moduleClass)?.controllers ?? []) {
      for (const injection of injectionsOf(Controller)) {
        if (overrides.some(override => override.token === injection.token)) {
          continue;
        }
        const providerModule = plan.providerModules.get(injection.token);
        if (providerModule === undefined) {
          throw new UnresolvedTokenError(injection.token.description);
        }
        if (plan.eagerModules.has(moduleClass) && !plan.eagerModules.has(providerModule)) {
          throw new Error(
            `@zmdb/web: eager class ${Controller.name} injects lazy-only token ` +
              `"${injection.token.description}" from ${providerModule.name}; import ${providerModule.name} eagerly`,
          );
        }
      }
    }
  }
}

function lazySubtreeOrder(
  root: ModuleClass,
  definitions: ReadonlyMap<ModuleClass, ModuleDef>,
  moduleOrder: readonly ModuleClass[],
  eagerModules: ReadonlySet<ModuleClass>,
): readonly ModuleClass[] {
  const reachable = new Set<ModuleClass>();
  const visit = (moduleClass: ModuleClass): void => {
    if (reachable.has(moduleClass) || eagerModules.has(moduleClass)) {
      return;
    }
    reachable.add(moduleClass);
    for (const imported of definitions.get(moduleClass)?.imports ?? []) {
      visit(typeof imported === 'function' ? imported : imported.module);
    }
  };
  visit(root);
  return moduleOrder.filter(module => reachable.has(module));
}

function instantiateEagerModule(
  moduleClass: ModuleClass,
  definitions: ReadonlyMap<ModuleClass, ModuleDef>,
  container: Container,
  controllers: object[],
  overrides: readonly ProviderDef[],
  recordInstance: (value: unknown) => void,
): void {
  const def = definitions.get(moduleClass);
  for (const provider of def?.providers ?? []) {
    if (!isOverridden(overrides, provider)) {
      registerProvider(container, provider, recordInstance);
    }
  }
  for (const Controller of def?.controllers ?? []) {
    const controller = container.build(Controller);
    recordInstance(controller);
    controllers.push(controller);
  }
}

function isOverridden(overrides: readonly ProviderDef[], provider: ProviderDef): boolean {
  return overrides.some(override => override.token === provider.token);
}

function registerProvider(container: Container, provider: ProviderDef, recordInstance: (value: unknown) => void): void {
  if ('useValue' in provider) {
    container.register(provider.token, provider.useValue);
    recordInstance(provider.useValue);
  } else {
    container.registerFactory(
      provider.token,
      c => {
        const value = provider.useFactory(c);
        recordInstance(value);
        return value;
      },
      provider.scope ?? 'singleton',
    );
  }
}
