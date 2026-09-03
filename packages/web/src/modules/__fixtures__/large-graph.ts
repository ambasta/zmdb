// The one realistic fixture the graph tests read. Tests freeze for the epic "The module graph as
// a first-class object" (#598 / spec freeze #599); the frozen text is `../SPEC.md`'s
// `## Amendments (lazy modules and the graph's data source, #599)` and `../../devtools/SPEC.md`.
//
// One fixture rather than several toy ones, because a graph description is trivially correct for
// three providers and interesting for thirty: `AppModule` below is seven modules deep with mixed
// scopes, a provider whose only consumer is another provider's factory, two controllers sharing a
// token, a route that shadows another, and one lazily imported subtree. Every variant a finding
// test needs is a separate root exported from the same file so the shapes stay comparable.
//
// `__fixtures__/` is not reachable from any `exports` target, which is what makes it the one place
// under `packages/web/src` where a decorator may be *applied* (ARCHITECTURE.md directive 10 forbids
// that only on a path reachable from an entry point). `vitest.config.ts`'s `stage3Decorators()`
// plugin lowers any `.ts` file containing one, not only `*.spec.ts`, so this file runs under the
// suite unchanged.

import { Inject, createToken, type Container, type Token } from '../../di/index.js';
import { Controller, Delete, Get, Post } from '../../routing/index.js';
import { Module, type ModuleClass, type ModuleDef, type ProviderDef } from '../index.js';

// ---------------------------------------------------------------------------
// The frozen surface, declared locally
// ---------------------------------------------------------------------------
//
// `../SPEC.md` §L2 widens `ModuleDef.imports` from `readonly ModuleClass[]` to
// `readonly (ModuleClass | LazyImport)[]`. Neither `LazyImport` nor the widened `ModuleDef` exists
// in `../index.ts`, so the widening — and only the widening — is declared here, intersected with
// the real `ModuleDef` through `Omit`. Rename a field of the real `ModuleDef` and this file stops
// compiling instead of quietly testing a shape nobody has. All of it goes away in the slice that
// widens `imports` for real.

/** §L2 verbatim: an `imports` entry that defers construction. Discriminated by `kind`, not branded. */
export interface LazyImport {
  readonly kind: 'lazy';
  readonly module: ModuleClass;
}

/** §L2's `ModuleDef`, as the widening over the one that exists. */
export type FrozenModuleDef = Omit<ModuleDef, 'imports'> & {
  readonly imports?: readonly (ModuleClass | LazyImport)[];
};

/**
 * §L2's `lazy(module)`, as a fixture helper rather than a declaration of the real export.
 *
 * The convention this freeze follows does not `declare` a function that does not exist, because a
 * declared stub throws `ReferenceError` and fails identically whether the feature is missing,
 * misnamed or wrong. Nothing has to be declared here: §L2 freezes `lazy()` as returning an inert
 * value with no state at all, so the value is writable directly and the real function under test
 * is `compileModule`, which is handed a graph carrying the marker. The slice that exports `lazy`
 * replaces this with an import.
 */
export function lazyRef(module: ModuleClass): LazyImport {
  return { kind: 'lazy', module };
}

/**
 * `@Module` over the widened definition.
 *
 * boundary: `def` is the shape §L2 freezes and today's `ModuleDef` does not admit a `LazyImport` in
 * `imports`; `ModuleDef` is assignable to `FrozenModuleDef`, so the narrowing assertion is what
 * lets this file compile against a surface that is one slice away. It is the only assertion in the
 * fixture and the tests, and it disappears with the widening. `@Module` itself is the real
 * decorator, so the marker really does reach `context.metadata` — which is the whole point, since
 * `moduleDefOf` is what a description reads it back through.
 */
export function FrozenModule(def: FrozenModuleDef) {
  return Module(def as ModuleDef);
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

export const CONFIG = createToken<{ readonly url: string }>('CONFIG');
export const CLOCK = createToken<{ now(): number }>('CLOCK');
export const REQUEST_ID = createToken<{ readonly id: number }>('REQUEST_ID');
/** A space and a `#` in one description — `../../devtools/SPEC.md` §11.9's DOT quoting case. */
export const USER_CACHE = createToken<Map<string, string>>('user cache #1');
export const POOL = createToken<{ readonly dsn: string }>('POOL');
export const USERS_REPOSITORY = createToken<{ find(id: string): string }>('USERS_REPOSITORY');
export const INVOICES = createToken<{ total(): number }>('INVOICES');
export const SEARCH_INDEX = createToken<{ readonly size: number }>('SEARCH_INDEX');
export const ADMIN_POOL = createToken<{ readonly dsn: string }>('ADMIN_POOL');

/** Every factory call the fixture makes, so a test can say which ran and how often. */
export const factoryCalls: string[] = [];

/** Every lifecycle hook the fixture runs, in order, so a test can say which ran and when. */
export const hookLog: string[] = [];

export function resetFactoryCalls(): void {
  factoryCalls.length = 0;
  hookLog.length = 0;
}

/** A promise a test resolves by hand, so a load can be held in flight across an `await`. */
export function gate(): { readonly promise: Promise<void>; open(): void } {
  let open = (): void => {};
  const promise = new Promise<void>(resolve => {
    open = resolve;
  });
  return { promise, open: () => open() };
}

// ---------------------------------------------------------------------------
// The application graph
// ---------------------------------------------------------------------------

@Module({
  providers: [
    { token: CONFIG, useValue: { url: 'postgres://localhost/app' } },
    {
      token: CLOCK,
      useFactory: () => {
        factoryCalls.push('CLOCK');
        return { now: () => 0 };
      },
    },
    {
      token: REQUEST_ID,
      useFactory: () => {
        factoryCalls.push('REQUEST_ID');
        return { id: factoryCalls.length };
      },
      scope: 'transient',
    },
    { token: USER_CACHE, useValue: new Map<string, string>() },
  ],
  exports: [CONFIG, CLOCK],
})
export class CoreModule {}

@Module({
  imports: [CoreModule],
  providers: [
    {
      token: POOL,
      useFactory: (container: Container) => {
        factoryCalls.push('POOL');
        return { dsn: container.resolve(CONFIG).url };
      },
    },
    {
      // The edge no description can see: `USERS_REPOSITORY` resolves `POOL` inside the factory
      // body, so `POOL`'s only consumer is opaque (`../../devtools/SPEC.md` §2, §11.5).
      token: USERS_REPOSITORY,
      useFactory: (container: Container) => {
        factoryCalls.push('USERS_REPOSITORY');
        const pool = container.resolve(POOL);
        return { find: (id: string) => `${pool.dsn}#${id}` };
      },
    },
  ],
  exports: [USERS_REPOSITORY],
})
export class DataModule {}

@Controller('/users')
export class UsersController {
  @Inject(USERS_REPOSITORY)
  repository!: { find(id: string): string };

  @Inject(CONFIG)
  config!: { readonly url: string };

  // `/users/:id` is declared before `/users/me`, so it shadows it under first-match routing —
  // the case `docs-site/content/web-devtools.md` says a route printout makes visible.
  @Get('/:id')
  byId(): string {
    return 'byId';
  }

  @Get('/me')
  me(): string {
    return 'me';
  }

  @Post('/')
  create(): string {
    return 'created';
  }
}

@Module({ imports: [DataModule], controllers: [UsersController] })
export class UsersModule {}

@Controller('/invoices')
export class BillingController {
  // The second consumer of `USERS_REPOSITORY`, which is what `dependentsOf` has to report both of.
  @Inject(USERS_REPOSITORY)
  repository!: { find(id: string): string };

  @Inject(INVOICES)
  invoices!: { total(): number };

  @Get('/:id')
  byId(): string {
    return 'invoice';
  }
}

@Module({
  imports: [DataModule],
  providers: [
    {
      token: INVOICES,
      useFactory: () => {
        factoryCalls.push('INVOICES');
        return { total: () => 0 };
      },
    },
  ],
  controllers: [BillingController],
})
export class BillingModule {}

@Controller('/search')
export class SearchController {
  @Inject(SEARCH_INDEX)
  index!: { readonly size: number };

  @Get('/')
  query(): string {
    return 'search';
  }
}

@Module({
  imports: [CoreModule],
  providers: [
    {
      token: SEARCH_INDEX,
      useFactory: () => {
        factoryCalls.push('SEARCH_INDEX');
        return { size: 0 };
      },
      scope: 'transient',
    },
  ],
  controllers: [SearchController],
})
export class SearchModule {}

/** The lazily imported module's controller. It carries all three hooks, for §L12.8 and §L12.11. */
@Controller('/admin')
export class AdminController {
  @Inject(ADMIN_POOL)
  pool!: { readonly dsn: string };

  onModuleInit(): void {
    hookLog.push('AdminController.onModuleInit');
  }

  onApplicationBootstrap(): void {
    hookLog.push('AdminController.onApplicationBootstrap');
  }

  onShutdown(): void {
    hookLog.push('AdminController.onShutdown');
  }

  @Get('/')
  list(): string {
    hookLog.push('AdminController.list');
    return 'admin';
  }

  @Delete('/:id')
  remove(): string {
    return 'removed';
  }
}

@Module({
  providers: [
    {
      token: ADMIN_POOL,
      useFactory: () => {
        factoryCalls.push('ADMIN_POOL');
        return { dsn: 'postgres://localhost/admin' };
      },
    },
  ],
  controllers: [AdminController],
})
export class AdminModule {}

/** The eager controller the lazy one has to tear down before (§L12.11). */
@Controller('/health')
export class HealthController {
  @Inject(CLOCK)
  clock!: { now(): number };

  onModuleInit(): void {
    hookLog.push('HealthController.onModuleInit');
  }

  onApplicationBootstrap(): void {
    hookLog.push('HealthController.onApplicationBootstrap');
  }

  onShutdown(): void {
    hookLog.push('HealthController.onShutdown');
  }

  @Get('/')
  check(): string {
    return 'ok';
  }
}

/** The fixture root: three eager subtrees, one lazy one, and a controller of its own. */
@FrozenModule({
  imports: [UsersModule, BillingModule, SearchModule, lazyRef(AdminModule)],
  controllers: [HealthController],
})
export class AppModule {}

// ---------------------------------------------------------------------------
// Variants, one per finding and one per lazy rule
// ---------------------------------------------------------------------------

/**
 * A real three-module cycle.
 *
 * The closing edge is pushed after all three classes exist because it cannot be written any other
 * way: a decorator expression is evaluated before its class binding is initialised, so
 * `imports: [CycleAppModule]` on the module `CycleAppModule` transitively imports is a
 * `ReferenceError` at definition time. `def.imports` holds this array by reference, so mutating it
 * afterwards is what a cycle across two files looks like from `compileModule`'s side — except for
 * one difference recorded in the tests: a genuine ESM import cycle leaves `undefined` in the array
 * instead, which is a different failure.
 */
const closingEdge: ModuleClass[] = [];

@Module({ imports: closingEdge })
export class CycleUsersModule {}

@Module({ imports: [CycleUsersModule] })
export class CycleBillingModule {}

@Module({ imports: [CycleBillingModule] })
export class CycleAppModule {}

closingEdge.push(CycleAppModule);

/** The ESM shape of the same mistake: the forward reference is `undefined` at decoration time. */
const undefinedEdge: readonly ModuleClass[] = [undefined as unknown as ModuleClass];

@Module({ imports: undefinedEdge })
export class UninitialisedImportModule {}

/** Two controllers registering `GET /reports/:id`. The first declared wins; §5's `shadowed-route`. */
@Controller('/reports')
export class ReportsController {
  @Get('/:id')
  byId(): string {
    return 'first';
  }
}

@Controller('/reports')
export class ArchivedReportsController {
  @Get('/:id')
  byId(): string {
    return 'second';
  }
}

@Module({ controllers: [ReportsController, ArchivedReportsController] })
export class ShadowedRouteAppModule {}

/** Two modules registering `CONFIG`. The later silently wins at `#bindings.set`; §5's `duplicate-provider`. */
@Module({ providers: [{ token: CONFIG, useValue: { url: 'first' } }] })
export class FirstConfigModule {}

@Module({ providers: [{ token: CONFIG, useValue: { url: 'second' } }] })
export class SecondConfigModule {}

@Module({ imports: [FirstConfigModule, SecondConfigModule] })
export class DuplicateProviderAppModule {}

/** Two distinct tokens with one description. `createToken` derives no identity from it; §5's warning. */
export const DB_PRIMARY = createToken<string>('db');
export const DB_REPLICA = createToken<string>('db');

@Module({
  providers: [
    { token: DB_PRIMARY, useValue: 'primary' },
    { token: DB_REPLICA, useValue: 'replica' },
  ],
})
export class AmbiguousTokenAppModule {}

/** A controller injecting a token no module registers; §5's `unresolved-token`. */
export const NEVER_REGISTERED = createToken<string>('NEVER_REGISTERED');

@Controller('/missing')
export class NeedsMissingController {
  @Inject(NEVER_REGISTERED)
  missing!: string;

  @Get('/')
  read(): string {
    return this.missing;
  }
}

@Module({ controllers: [NeedsMissingController] })
export class UnresolvedTokenAppModule {}

/**
 * The unresolved-token variant with a provider that *would* run first, so a test can say whether
 * anything was constructed before the refusal (§L12.6: "before any provider is constructed").
 */
@Module({
  imports: [CoreModule],
  controllers: [HealthController],
})
export class WarmModule {}

@Module({ imports: [WarmModule, UnresolvedTokenAppModule] })
export class UnresolvedAfterWarmAppModule {}

/** An eager controller injecting a token only the lazily imported module provides; §L3's last row. */
@Controller('/eager')
export class EagerNeedsAdminController {
  @Inject(ADMIN_POOL)
  pool!: { readonly dsn: string };

  @Get('/')
  read(): string {
    return this.pool.dsn;
  }
}

@FrozenModule({
  imports: [lazyRef(AdminModule)],
  controllers: [EagerNeedsAdminController],
})
export class EagerDependsOnLazyAppModule {}

/** `Shared` reached lazily from one importer and eagerly from another; §L3 makes it eager. */
export const SHARED = createToken<{ readonly n: number }>('SHARED');

@Module({
  providers: [
    {
      token: SHARED,
      useFactory: () => {
        factoryCalls.push('SHARED');
        return { n: 1 };
      },
    },
  ],
})
export class SharedModule {}

@FrozenModule({ imports: [lazyRef(SharedModule)] })
export class LazyImporterModule {}

@Module({ imports: [SharedModule] })
export class EagerImporterModule {}

@Module({ imports: [LazyImporterModule, EagerImporterModule] })
export class LazyThenEagerAppModule {}

@Module({ imports: [EagerImporterModule, LazyImporterModule] })
export class EagerThenLazyAppModule {}

/**
 * A lazy subtree whose `useFactory` throws — §L7's terminal failure, §L12.9 and §L12.10.
 *
 * The throw is in a factory rather than a constructor because a factory is the case §L7 argues
 * from (the socket that is already open when the next line throws), and because `factoryCalls`
 * makes "ran exactly once" a countable claim rather than an inference.
 */
export const BROKEN_POOL = createToken<{ readonly dsn: string }>('BROKEN_POOL');

@Controller('/broken')
export class BrokenController {
  @Inject(BROKEN_POOL)
  pool!: { readonly dsn: string };

  @Get('/')
  read(): string {
    return this.pool.dsn;
  }
}

@Module({
  providers: [
    {
      token: BROKEN_POOL,
      useFactory: () => {
        factoryCalls.push('BROKEN_POOL');
        throw new Error('fixture: the pool could not be opened');
      },
    },
  ],
  controllers: [BrokenController],
})
export class BrokenModule {}

@FrozenModule({ imports: [CoreModule, lazyRef(BrokenModule)], controllers: [HealthController] })
export class BrokenLazyAppModule {}

/**
 * A lazy subtree whose load cannot finish until a test opens the gate, so `status` can be observed
 * at `'loading'` and `[Symbol.asyncDispose]` can be called mid-load (§L8, §L12.11).
 *
 * The gate is in `onModuleInit` and not in the factory on purpose: §L5 freezes wiring as one
 * synchronous region with the hooks as the only `await`, so a hook is the only place a load is
 * legitimately suspendable. A gate in a `useFactory` would be testing a shape the spec forbids.
 */
export const slowGate = gate();

@Controller('/slow')
export class SlowController {
  async onModuleInit(): Promise<void> {
    hookLog.push('SlowController.onModuleInit:enter');
    await slowGate.promise;
    hookLog.push('SlowController.onModuleInit:exit');
  }

  @Get('/')
  read(): string {
    return 'slow';
  }
}

@Module({ controllers: [SlowController] })
export class SlowModule {}

@FrozenModule({ imports: [CoreModule, lazyRef(SlowModule)], controllers: [HealthController] })
export class SlowLazyAppModule {}

/** A root with no `lazy()` anywhere, for the "costs nothing when unused" half of §L12.5. */
@Module({ imports: [UsersModule, BillingModule, SearchModule], controllers: [HealthController] })
export class EagerOnlyAppModule {}

/** A module whose `name` is empty, standing in for a minified build; §5's `anonymous-class` warning. */
@Module({})
export class MangledModule {}

Object.defineProperty(MangledModule, 'name', { value: '' });

/**
 * Sixty value providers from one array, which is the fixture `--providers` has to refuse
 * unfiltered (`../../devtools/SPEC.md` §8's fifty-node threshold). Providers are data, so the
 * count needs no sixty class declarations.
 */
export const bulkTokens: readonly Token<number>[] = Array.from({ length: 60 }, (_, index) =>
  createToken<number>(`bulk.${index}`),
);

const bulkProviders: readonly ProviderDef[] = bulkTokens.map((token, index) => ({ token, useValue: index }));

@Module({ providers: bulkProviders })
export class WideModule {}

@Module({ imports: [WideModule, UsersModule] })
export class WideAppModule {}

/** A controller subclassing a controller — `../../devtools/SPEC.md` §4's prototype-aliasing case. */
@Controller('/base')
export class BaseInjectController {
  @Inject(CONFIG)
  config!: { readonly url: string };

  @Get('/a')
  a(): string {
    return 'a';
  }
}

export class DerivedInjectController extends BaseInjectController {
  @Inject(CLOCK)
  clock!: { now(): number };

  @Get('/b')
  b(): string {
    return 'b';
  }
}

@Module({ imports: [CoreModule], controllers: [BaseInjectController, DerivedInjectController] })
export class SubclassedControllerAppModule {}
