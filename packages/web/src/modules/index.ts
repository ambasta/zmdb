// @zmdb/web — modules & providers (epic #282, spec ./SPEC.md). @Module records a
// module graph in context.metadata; compileModule walks it (acyclic) into a
// Container + built controllers. Static wiring, no per-request walk, no `as` on
// the consumer surface.

import '../polyfill.ts';
import { Container, type Constructor, type Scope, type Token } from '../di/index.ts';

/** A provider binds a token to a value or a factory, with an optional scope. */
export type ProviderDef<T = unknown> =
  | { readonly token: Token<T>; readonly useValue: T }
  | { readonly token: Token<T>; readonly useFactory: (container: Container) => T; readonly scope?: Scope };

/** A module class (nominal — carries its definition in Symbol.metadata). */
export type ModuleClass = abstract new (...args: never[]) => unknown;

/** The `@Module` definition. */
export interface ModuleDef {
  readonly controllers?: readonly Constructor<object>[];
  readonly providers?: readonly ProviderDef[];
  readonly imports?: readonly ModuleClass[];
  readonly exports?: readonly Token<unknown>[];
}

/** The result of compiling a module graph. */
export interface CompiledModule {
  readonly container: Container;
  readonly controllers: readonly object[];
}

const MODULE = Symbol('zmdb.web.module');

interface ModuleMetadata {
  [MODULE]?: ModuleDef;
}

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

function readModuleDef(moduleClass: ModuleClass): ModuleDef | undefined {
  const metadata = moduleClass[Symbol.metadata];
  if (metadata === undefined || metadata === null) {
    return undefined;
  }
  return moduleView(metadata)[MODULE];
}

/**
 * Compile a module graph rooted at `rootModule` into a Container + built
 * controllers. Registers each module's providers, resolves the acyclic import
 * graph (throws on a cycle), and builds every module's controllers. Optional
 * `overrides` are registered BEFORE any controller is built, so a controller
 * under test injects the override (used by the testing harness).
 */
export function compileModule(rootModule: ModuleClass, overrides: readonly ProviderDef[] = []): CompiledModule {
  const container = new Container();
  const controllers: object[] = [];
  const visited = new Set<ModuleClass>();
  const inProgress = new Set<ModuleClass>();

  // Register overrides first so provider registration/build sees the stubs.
  for (const override of overrides) {
    registerProvider(container, override);
  }

  function visit(moduleClass: ModuleClass): void {
    if (visited.has(moduleClass)) {
      return;
    }
    if (inProgress.has(moduleClass)) {
      throw new Error('@zmdb/web: import cycle detected in the module graph');
    }
    inProgress.add(moduleClass);
    const def = readModuleDef(moduleClass);
    if (def !== undefined) {
      for (const imported of def.imports ?? []) {
        visit(imported);
      }
      for (const provider of def.providers ?? []) {
        if (!isOverridden(overrides, provider)) {
          registerProvider(container, provider);
        }
      }
      for (const Controller of def.controllers ?? []) {
        controllers.push(container.build(Controller));
      }
    }
    inProgress.delete(moduleClass);
    visited.add(moduleClass);
  }

  visit(rootModule);
  return { container, controllers };
}

function isOverridden(overrides: readonly ProviderDef[], provider: ProviderDef): boolean {
  return overrides.some((o) => o.token === provider.token);
}

function registerProvider(container: Container, provider: ProviderDef): void {
  if ('useValue' in provider) {
    container.register(provider.token, provider.useValue);
  } else {
    container.registerFactory(provider.token, provider.useFactory, provider.scope ?? 'singleton');
  }
}
