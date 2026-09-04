import { describe, expect, it } from 'vitest';

import { createApp, type App } from '../app/index.js';
import { countMetadataReads } from '../bench/index.js';
import { compileModule, type CompiledModule } from '../modules/index.js';
import { bodyText } from '../pipeline/index.js';
import {
  AppModule,
  BrokenLazyAppModule,
  CycleAppModule,
  DuplicateProviderAppModule,
  EagerDependsOnLazyAppModule,
  EagerOnlyAppModule,
  EagerThenLazyAppModule,
  LazyThenEagerAppModule,
  SHARED,
  SlowLazyAppModule,
  UnresolvedAfterWarmAppModule,
  factoryCalls,
  hookLog,
  resetFactoryCalls,
  slowGate,
} from './__fixtures__/large-graph.js';

// Lazily imported modules. Tests freeze for the epic "The module graph as a first-class object"
// (#598 / spec freeze #599); the frozen text is `./SPEC.md`'s
// `## Amendments (lazy modules and the graph's data source, #599)`, §L12.
//
// `modules.spec.ts` next door covers the graph that exists: one pass, everything eager, everything
// wired before `createApp` returns. This file covers the one that does not — a subtree marked
// `lazy()` whose providers are constructed on the first request that reaches one of its routes —
// and the four startup refusals §L3 says a two-pass compile makes possible.
//
// These assertions were frozen with `it.fails` in #600 and became ordinary regression tests when
// #601 implemented the surface. The pre-implementation observations remain beside the assertions
// so future changes retain the reason each behavior is load-bearing.
//
// Every recorded actual below came from running the code, in
// `packages/web/src/probe600/{p3,p4}.spec.ts` — a throwaway spec that collected each value into a
// string and compared it to a sentinel so the assertion diff printed them all. The probe is not
// part of this freeze; the numbers it produced are.

// ---------------------------------------------------------------------------
// The frozen surface, read through one boundary each
// ---------------------------------------------------------------------------
//
// §L2's `LazyStatus`, `LazyModuleHandle` and the `lazy` field on `CompiledModule` do not exist.
// The widening is declared here as an *optional* member intersected with the real type, which is
// what lets `lazyHandlesOf` be written with no assertion at all: a value of the real type is
// already assignable to the real type intersected with an optional field. The optionality is the
// only thing that is wrong about it, and it is pinned positively in `lazy.type-test.ts` — where
// `CompiledModule['lazy']` is asserted to be *required*. So nothing here can be satisfied by a
// `lazy?: never`.

/** §L2 verbatim. */
type LazyStatus = 'unloaded' | 'loading' | 'loaded' | 'failed';

/** §L2 verbatim. */
interface LazyModuleHandle {
  readonly name: string;
  readonly status: LazyStatus;
  load(): Promise<void>;
}

/**
 * The handles `compileModule` produces, or `undefined` where the field does not exist.
 *
 * boundary: this is the whole of §L2's addition to `CompiledModule`, and reading it through an
 * optional widening rather than an `as` means a rename of `container` or `controllers` breaks this
 * file. `undefined` is not a value the frozen shape permits — §L2 makes `lazy` required and §L11
 * says it is empty, not absent, for a graph with no `lazy()` imports — so returning it here is how
 * "the field is missing" reaches an assertion as a comparison instead of a `TypeError`.
 */
function lazyHandlesOf(compiled: CompiledModule): readonly LazyModuleHandle[] | undefined {
  const view: CompiledModule & { readonly lazy?: readonly LazyModuleHandle[] } = compiled;
  return view.lazy;
}

/** The same field on `App`, which §L11 adds it to so a `zmdb repl` can load without a request. */
function lazyHandlesOfApp(app: App): readonly LazyModuleHandle[] | undefined {
  const view: App & { readonly lazy?: readonly LazyModuleHandle[] } = app;
  return view.lazy;
}

/**
 * `name:status` for every handle, or a sentence saying why there are none.
 *
 * A string rather than a throw so that a missing field prints as a diff against the expected
 * handle list. `App has no lazy property` in a failure message says which of the two things went
 * wrong — the field, or the contents — which a `TypeError: Cannot read properties of undefined`
 * would not.
 */
function lazyReport(app: App): readonly string[] | string {
  const handles = lazyHandlesOfApp(app);
  if (handles === undefined) {
    return 'App has no lazy property';
  }
  return handles.map(handle => `${handle.name}:${handle.status}`);
}

/** The outcome of `handle.load()` for one module, as a string: `loaded`, an error, or why not. */
async function loadModule(app: App, name: string): Promise<string> {
  const handles = lazyHandlesOfApp(app);
  const handle = handles?.find(candidate => candidate.name === name);
  if (handle === undefined) {
    return `no handle named ${name}; App.lazy is ${String(handles)}`;
  }
  try {
    await handle.load();
    return 'loaded';
  } catch (error) {
    return error instanceof Error ? `${error.name}: ${error.message}` : `threw ${String(error)}`;
  }
}

/** What `createApp` produced, or the exception it produced, as a string. */
function bootstrap(root: Parameters<typeof createApp>[0]): App | string {
  try {
    return createApp(root);
  } catch (error) {
    return error instanceof Error ? `${error.name}: ${error.message}` : `threw ${String(error)}`;
  }
}

/** `method path -> status` for a fixed probe list, which is the closest thing to a route count. */
const probePaths: readonly (readonly [string, string])[] = [
  ['GET', '/health'],
  ['GET', '/users/me'],
  ['GET', '/users/1'],
  ['POST', '/users'],
  ['GET', '/invoices/1'],
  ['GET', '/search'],
  ['GET', '/admin'],
  ['DELETE', '/admin/1'],
];

async function reachableRoutes(app: App): Promise<readonly string[]> {
  const seen: string[] = [];
  for (const [method, path] of probePaths) {
    const response = await app.handle({ method, path, headers: {} });
    if (response.status !== 404) {
      seen.push(`${method} ${path}`);
    }
  }
  return seen;
}

describe('lazily imported modules (frozen: modules/SPEC.md L12)', () => {
  // §L12.2. The correction to #599's `LazyModuleRef` that §L2 calls "the one that matters most":
  // load state is per-app, so two apps from one root module cannot see each other's. The fixture
  // makes this real rather than notional — `AppModule` is a module-scope class and `lazyRef` runs
  // once at import time, so anything stateful in the value `lazy()` returns is shared by both apps
  // and by every other test file in this suite.
  //
  // Before #601 both calls reported `App has no lazy property`, and the load reported
  //   `no handle named AdminModule; App.lazy is undefined`
  // — `createApp` returns the object literal at `../app/index.ts:33-39`, which has four members and
  // no `lazy`. So the cross-app bug is not present today for the reason that there is no state at
  // all yet; this test is what stops the fix reintroducing it.
  it('gives each app from one root module its own unloaded handle', async () => {
    const first = createApp(AppModule);
    const second = createApp(AppModule);
    expect(lazyReport(first), 'first app before any load').toEqual(['AdminModule:unloaded']);
    expect(lazyReport(second), 'second app before any load').toEqual(['AdminModule:unloaded']);

    expect(await loadModule(first, 'AdminModule')).toBe('loaded');
    expect(lazyReport(first), 'first app after loading').toEqual(['AdminModule:loaded']);
    expect(lazyReport(second), 'second app after the first loaded').toEqual(['AdminModule:unloaded']);
  });

  // §L12.5 second half, and §L11's "empty for a graph with no `lazy()` imports". Absent and empty
  // are different: a `zmdb modules` printout iterating `app.lazy` has to work for every app, and
  // `undefined` there is a crash in the inspector rather than an application with no lazy modules.
  //
  // Before #601 this was `undefined` for both roots — the field did not exist, so the distinction the
  // spec draws cannot be drawn.
  it('reports an empty handle list for a graph with no lazy imports', () => {
    expect(lazyHandlesOf(compileModule(EagerOnlyAppModule)), 'no lazy() anywhere').toEqual([]);
    expect(lazyHandlesOf(compileModule(AppModule)), 'one lazy() import').toHaveLength(1);
  });

  // §L12.3. The whole point of the feature, as a countable claim: the deferred pool is not opened
  // by `createApp`, and it is opened by the first request that needs it. `factoryCalls` is the
  // fixture's spy; `ADMIN_POOL`'s factory is reached only by building `AdminController`.
  //
  // Before #601 there were zero calls after `init()` for the wrong reason, and
  // still zero after the request, because `GET /admin` is a 404. `compileModule`'s `visit`
  // (`./index.ts:76-100`) calls `readModuleDef` on the `{ kind: 'lazy', module }` object, gets
  // `undefined` from `Symbol.metadata`, and falls straight through the `if (def !== undefined)` at
  // :85. So a `lazy()` marker today is not an error and not a deferral: it silently deletes the
  // subtree. That is the single most important recorded actual in this file.
  it('constructs a lazy module provider on the first request to its route, not at startup', async () => {
    resetFactoryCalls();
    const app = createApp(AppModule);
    await app.init();
    expect(
      factoryCalls.filter(call => call === 'ADMIN_POOL'),
      'after init()',
    ).toHaveLength(0);

    await app.handle({ method: 'GET', path: '/admin', headers: {} });
    expect(
      factoryCalls.filter(call => call === 'ADMIN_POOL'),
      'after one request',
    ).toHaveLength(1);
  });

  // §L12.4 first half, and the reachability argument in §L4: if routes appeared only after a load,
  // nothing would ever trigger the load. So the route is registered at startup from the controller
  // *class*, and the handler is a trampoline that awaits the load.
  //
  // Before #601 this was 404 `{"error":"no route for GET /admin"}` — the exact deadlock §L4 describes,
  // reached because the subtree was dropped rather than deferred.
  it('answers a lazy module route rather than 404', async () => {
    resetFactoryCalls();
    const app = createApp(AppModule);
    await app.init();
    const response = await app.handle({ method: 'GET', path: '/admin', headers: {} });
    expect(response.status).toBe(200);
    expect(await bodyText(response)).toBe('"admin"');
  });

  // §L12.4 second half: "the count of registered routes is the same whether or not any load has
  // happened". `Router` exposes `register` and `handle` and nothing that counts, so the count is
  // measured the only way a consumer can measure it — the set of probe paths that do not 404 —
  // which is a weaker claim than the spec's and is the honest one to freeze. §L4's "no route is
  // added or removed after startup" is exactly this set being stable.
  //
  // Before #601 the route set was identical before and after, at
  //   ["GET /health","GET /users/me","GET /users/1","POST /users","GET /invoices/1","GET /search"]
  // — stable, and missing both of `AdminModule`'s routes. The stability half passes today and the
  // membership half is what fails, which is why both are asserted here and not in two tests.
  it('registers a lazy module route table that does not change across a load', async () => {
    resetFactoryCalls();
    const app = createApp(AppModule);
    await app.init();
    const before = await reachableRoutes(app);
    expect(before, 'before any load').toContain('GET /admin');
    expect(before, 'before any load').toContain('DELETE /admin/1');

    expect(await loadModule(app, 'AdminModule')).toBe('loaded');
    expect(await reachableRoutes(app), 'after loading').toEqual(before);
  });

  // §L12.6, first row of §L3's table, and the half of it that is false today. The refusal already
  // happens — `container.build` throws from a field initializer during `compileModule` — but not
  // "before any provider is constructed": `WarmModule` is visited first, its `HealthController` is
  // built, and `CLOCK`'s factory runs. Two-pass compile makes the declaration check possible
  // before any `build`, which is the difference between a refusal and a half-built graph.
  //
  // Before #601 the throw was right —
  //   UnresolvedTokenError: @zmdb/web: no provider registered for token "NEVER_REGISTERED"
  // — and `factoryCalls` is `["CLOCK"]`, so one provider was constructed before the refusal.
  it('refuses an unresolvable token before constructing any provider', () => {
    resetFactoryCalls();
    expect(bootstrap(UnresolvedAfterWarmAppModule)).toMatch(/no provider registered for token "NEVER_REGISTERED"/);
    expect(factoryCalls, 'providers constructed before the refusal').toEqual([]);
  });

  // §L12.6, second row, and §L10's frozen message. `inProgress` is a `Set` and `Set` iteration is
  // insertion-ordered, so at the moment the check at `./index.ts:80` fires the path is already in
  // hand: the set from the repeated module onward, plus the repeated module again. Nothing has to
  // be recorded that is not recorded — which is what makes the current message a choice rather
  // than a limitation.
  //
  // The `->` in the frozen text is matched as ASCII, and the assertion is on the whole sentence
  // rather than a fragment because the ordering *is* the claim.
  //
  // Before #601 this was `@zmdb/web: import cycle detected in the module graph` — no path, no module
  // names, and the same string for every cycle in every application. This is the one assertion in
  // this file that is diagnostic against code that fully exists: it fails on a comparison of two
  // real messages, so the day the path lands it says whether the order is right.
  it('names the cycle path in the import cycle message', () => {
    expect(bootstrap(CycleAppModule)).toBe(
      'Error: @zmdb/web: import cycle in the module graph: ' +
        'CycleAppModule -> CycleBillingModule -> CycleUsersModule -> CycleAppModule',
    );
  });

  // §L12.6, third row. Two modules registering `CONFIG` is compared as *declarations*, which is
  // the only way to catch it: watching `#bindings.set` cannot distinguish a duplicate from a
  // deliberate testing override, because `createTestApp` registers its overrides through the same
  // `Map.set` (`./index.ts:72-74`).
  //
  // Before #601 `createApp` returned an `App`. The later registration silently won at
  // `../di/index.ts:108-111`, so `CONFIG` resolves to `{ url: 'second' }` and the application that
  // meant `first` starts and is wrong. No message exists to assert a fragment of, so the assertion
  // is that a refusal happens at all plus the two module names it has to carry.
  it('refuses two modules registering the same token, naming both', () => {
    const result = bootstrap(DuplicateProviderAppModule);
    expect(typeof result, 'a refusal is a string here, an App is not').toBe('string');
    expect(result).toMatch(/CONFIG/);
    expect(result).toMatch(/FirstConfigModule/);
    expect(result).toMatch(/SecondConfigModule/);
  });

  // §L12.6, fourth row, and §L3's "the one worth arguing". Without it the application starts and
  // the first request to an eager controller dies in a field initializer naming a token but not
  // the reason, and the reason is a `lazy()` wrapper in a module the reader is not looking at.
  //
  // Before #601:
  //   UnresolvedTokenError: @zmdb/web: no provider registered for token "ADMIN_POOL"
  // — thrown from `createApp`, so the timing is already right, and naming neither
  // `EagerNeedsAdminController` nor `AdminModule`. The refusal is indistinguishable from a token
  // nobody registered anywhere, which is the failure §L3 predicts almost word for word.
  it('refuses an eager class injecting a lazy-only token, naming both classes and the token', () => {
    const result = bootstrap(EagerDependsOnLazyAppModule);
    expect(result).toMatch(/ADMIN_POOL/);
    expect(result).toMatch(/EagerNeedsAdminController/);
    expect(result).toMatch(/AdminModule/);
    expect(result).toMatch(/lazy/);
  });

  // §L12.7. `SharedModule` is imported lazily by one module and eagerly by another, and §L3 makes
  // it eager: "a module reachable by any eager path is eager". The claim under test is the one the
  // two-pass compile exists for — that this does not depend on `imports` array order — so both
  // orders are asserted, and the handle list has to be empty in both because nothing is lazy.
  //
  // Before #601 this was `undefined` for both because there was no field. The order-independence half is
  // pinned separately, green, below.
  it('gives no handle to a module that any eager path reaches, in either import order', () => {
    expect(lazyHandlesOf(compileModule(LazyThenEagerAppModule)), 'lazy edge first').toEqual([]);
    expect(lazyHandlesOf(compileModule(EagerThenLazyAppModule)), 'eager edge first').toEqual([]);
  });

  // §L12.8. Both hooks, in that order, on the loaded module's instances, before the response. §L6
  // refuses skipping `onApplicationBootstrap` on the grounds that "the application already
  // bootstrapped", and this is where that refusal is checked: the ordering assertion below would
  // pass with only `onModuleInit` running if the bootstrap entry were absent, so the entry is
  // asserted present and then ordered.
  //
  // Before #601 `hookLog` was
  //   ["HealthController.onModuleInit","HealthController.onApplicationBootstrap"]
  // both after `init()` and after the request — no `AdminController` entries at all, because the
  // controller is never constructed and `GET /admin` is a 404.
  it('runs both lifecycle hooks on a loaded module before the triggering response', async () => {
    resetFactoryCalls();
    const app = createApp(AppModule);
    await app.init();
    expect(hookLog, 'after init(), before any load').toEqual([
      'HealthController.onModuleInit',
      'HealthController.onApplicationBootstrap',
    ]);

    const response = await app.handle({ method: 'GET', path: '/admin', headers: {} });
    expect(response.status).toBe(200);
    expect(hookLog.slice(2)).toEqual([
      'AdminController.onModuleInit',
      'AdminController.onApplicationBootstrap',
      'AdminController.list',
    ]);
  });

  // §L12.9, and the assertion that replaces #600's own title. §L7 freezes a failed load as
  // terminal: `status` becomes `failed`, the error is stored as a *value* and rethrown, and
  // `load()` never retries — so the second request gets the same error and no factory ran twice.
  // #600's `does not cache a failed load, and retries per the specified policy` asserts the
  // opposite; §L7 says so explicitly and asks for the retitle. This test carries the frozen
  // behaviour, not the title's.
  //
  // Before #601 both requests were 404 `{"error":"no route for GET /broken"}`, `BROKEN_POOL` had
  // zero calls, and `lazyReport` is `App has no lazy property`. For contrast, the same module
  // compiled eagerly — `compileModule(BrokenModule)` — throws `fixture: the pool could not be
  // opened` from `createApp`, which is what makes the deferral observable at all.
  it('delivers the same error to every request after a failed load, running the factory once', async () => {
    resetFactoryCalls();
    const app = createApp(BrokenLazyAppModule);
    await app.init();

    const first = await app.handle({ method: 'GET', path: '/broken', headers: {} });
    const second = await app.handle({ method: 'GET', path: '/broken', headers: {} });
    expect(first.status, 'first request').toBe(500);
    expect(second, 'second request is byte-identical to the first').toEqual(first);
    expect(await bodyText(first)).toContain('the pool could not be opened');
    expect(
      factoryCalls.filter(call => call === 'BROKEN_POOL'),
      'factory calls',
    ).toHaveLength(1);
    expect(lazyReport(app)).toEqual(['BrokenModule:failed']);
  });

  // §L12.10 and §L8. Ten simultaneous requests, one load. The handle stores the in-flight promise
  // on the transition to `loading` and every later caller awaits that same one; Node's event loop
  // makes the check-and-set safe with no lock precisely because §L5's region does not yield.
  //
  // Before #601 this produced ten 404s and zero factory calls.
  it('triggers one load for ten concurrent requests to a lazy module', async () => {
    resetFactoryCalls();
    const app = createApp(AppModule);
    await app.init();

    const responses = await Promise.all(
      Array.from({ length: 10 }, () => app.handle({ method: 'GET', path: '/admin', headers: {} })),
    );
    expect(responses.map(response => response.status)).toEqual(Array.from({ length: 10 }, () => 200));
    expect(
      factoryCalls.filter(call => call === 'ADMIN_POOL'),
      'factory calls',
    ).toHaveLength(1);
  });

  // §L12.10 second half. The same fixture with a throwing factory: ten identical errors, still one
  // call. This is the same statement as §L7 and the reason `loading` has to be a distinct state
  // rather than an implementation detail — nine of these ten waiters observe the handle while it
  // is neither `unloaded` nor settled.
  //
  // Before #601 this produced ten identical 404s and zero factory calls. "Ten identical responses" therefore
  // passes today for the wrong reason, which is why the factory count and the status are asserted
  // in the same test.
  it('gives ten concurrent waiters one error from one failed load', async () => {
    resetFactoryCalls();
    const app = createApp(BrokenLazyAppModule);
    await app.init();

    const responses = await Promise.all(
      Array.from({ length: 10 }, () => app.handle({ method: 'GET', path: '/broken', headers: {} })),
    );
    expect(new Set(responses.map(response => JSON.stringify(response))).size, 'distinct responses').toBe(1);
    expect(responses[0]?.status).toBe(500);
    expect(
      factoryCalls.filter(call => call === 'BROKEN_POOL'),
      'factory calls',
    ).toHaveLength(1);
    expect(lazyReport(app)).toEqual(['BrokenModule:failed']);
  });

  // §L12.11, second clause. A loaded module's instances join the ordered instance list, so
  // `runShutdown`'s reverse iteration (`../lifecycle.ts:48-54`) tears them down before the eager
  // instances they were loaded after. `HealthController` stands in for "the eager provider it
  // injects" because providers get no hooks at all today — see the note in `NOTES.md`; asserting
  // the ordering over controllers is the strongest form of this claim the current lifecycle
  // supports, and it is the form that catches a load appending to the wrong end of the list.
  //
  // Before #601 `hookLog` after dispose was
  //   ["HealthController.onModuleInit","HealthController.onApplicationBootstrap","HealthController.onShutdown"]
  // — no `AdminController.onShutdown`, because nothing was ever loaded.
  it('tears a loaded module down before the eager instances it was loaded after', async () => {
    resetFactoryCalls();
    const app = createApp(AppModule);
    await app.init();
    expect(await loadModule(app, 'AdminModule')).toBe('loaded');
    await app[Symbol.asyncDispose]();

    const admin = hookLog.indexOf('AdminController.onShutdown');
    const health = hookLog.indexOf('HealthController.onShutdown');
    expect(admin, 'the loaded module shut down').toBeGreaterThanOrEqual(0);
    expect(admin, 'loaded module before eager instance').toBeLessThan(health);
  });

  // §L12.11, third clause. Dispose awaits an in-flight load rather than abandoning it: §L5's
  // region does not yield, so what abandonment would strand is the hooks, leaving a module that
  // finishes initializing after shutdown completed and holds a connection whose `onShutdown` has
  // already run or never will. And a request arriving after dispose began gets the shutting-down
  // error rather than starting a load nothing will ever close.
  //
  // The gate is in `SlowController.onModuleInit`, the only place §L5 permits a load to suspend.
  //
  // Before #601 `GET /slow` returned 404 immediately and `hookLog` never gained a `SlowController`
  // entry, and dispose has nothing to wait for — so all three assertions below are unreachable
  // for want of the trampoline that would put a load in flight.
  it('awaits an in-flight load on dispose and refuses a new one', async () => {
    resetFactoryCalls();
    const app = createApp(SlowLazyAppModule);
    await app.init();

    const triggering = app.handle({ method: 'GET', path: '/slow', headers: {} });
    await Promise.resolve();
    expect(lazyReport(app), 'while the hook is gated').toEqual(['SlowModule:loading']);

    const disposing = app[Symbol.asyncDispose]();
    const late = await app.handle({ method: 'GET', path: '/slow', headers: {} });
    expect(await bodyText(late), 'a request arriving after dispose began').toContain('application is shutting down');

    slowGate.open();
    expect((await triggering).status, 'the triggering request still succeeds').toBe(200);
    await disposing;
    expect(hookLog).toContain('SlowController.onModuleInit:exit');
  });

  // ---------------------------------------------------------------------------
  // Green: what holds today and what the implementation slice could break
  // ---------------------------------------------------------------------------

  // §L12.7's order-independence half, asserted where it can be asserted today. `SharedModule` is
  // reached eagerly through `EagerImporterModule` in both orders, so `SHARED` is registered in
  // both — and it is green for the reason that today's single pass ignores the lazy edge entirely.
  // It is here because the two-pass compile §L3 mandates is exactly the change that can break it:
  // a pass that assigns a subtree to a handle on first *encounter* rather than after computing the
  // whole eager set makes this fail for one of the two orders and not the other, and that is the
  // failure §L3 calls "order-dependent wiring, and there is nothing to read that reveals it".
  it('registers a module reached by any eager path regardless of import order', () => {
    expect(compileModule(LazyThenEagerAppModule).container.has(SHARED), 'lazy edge first').toBe(true);
    expect(compileModule(EagerThenLazyAppModule).container.has(SHARED), 'eager edge first').toBe(true);
  });

  // §L12.5's cost claim, asserted where §L1 says it can be measured. `countMetadataReads`
  // (`../bench/index.ts:20`) replaces the own `Symbol.metadata` descriptor with a counting getter,
  // and a request to an application with no `lazy()` imports reads it zero times — the per-request
  // path consults no decorator metadata at all, which is the invariant `../pipeline/SPEC.md:32-33`
  // exists to protect. Green, and the slice that adds a trampoline is the one that can break it:
  // a `registerDeferred` that resolves the controller's routes per request rather than at register
  // time turns this from 0 into one read per request for every application in the repository.
  it('reads no decorator metadata per request in an application with no lazy imports', async () => {
    const app = createApp(EagerOnlyAppModule);
    await app.init();
    const counter = countMetadataReads(EagerOnlyAppModule);
    await app.handle({ method: 'GET', path: '/health', headers: {} });
    const reads = counter.count();
    counter.restore();
    expect(reads).toBe(0);
  });

  // §L12.11's first clause: a module that never loaded has no instances, so its `onShutdown` never
  // runs. Constructing one in order to shut it down would open the pool it is about to close.
  //
  // This was green vacuously before #601; it now guards the implemented lifecycle and catches
  // the obvious wrong fix for the red test above it: making shutdown walk the handle list and
  // build each module's controllers so that it has something to call `onShutdown` on.
  it('does not run onShutdown for a module that never loaded', async () => {
    resetFactoryCalls();
    const app = createApp(AppModule);
    await app.init();
    await app[Symbol.asyncDispose]();
    expect(hookLog).not.toContain('AdminController.onShutdown');
    expect(hookLog, 'the eager instance still shuts down').toContain('HealthController.onShutdown');
  });

  // §L4's "the table's contents, its order and its shadowing are decided at `createApp` exactly as
  // they are today". `UsersController` declares `GET /users/:id` before `GET /users/me`, so the
  // parameter route shadows the literal one and `/users/me` answers `"byId"`. That is arguably a
  // wart, and it is deliberately not being fixed here — it is pinned because registration order is
  // what a lazy module's routes now take part in, and a two-pass compile that visits lazy edges in
  // a different order from the eager walk would silently move a shadowing conflict.
  it('resolves route shadowing by declaration order, which a lazy module joins', async () => {
    const app = createApp(AppModule);
    await app.init();
    const response = await app.handle({ method: 'GET', path: '/users/me', headers: {} });
    expect(response.status).toBe(200);
    expect(await bodyText(response), 'GET /users/:id was declared first').toBe('"byId"');
  });
});

describe('the graph readers a description is built from (frozen: modules/SPEC.md L12.12)', () => {
  // §L12.12 asks for `moduleDefOf` and `injectionsOf` to be "reachable from `@zmdb/web/modules`
  // and `@zmdb/web/di` — checked by `yarn verify:exports`, not by an import in a test". That gate
  // reads the `exports` map and the entry point's re-exports; it does not check that a *name*
  // exists. So this asserts the narrower thing a test can assert well: that the two functions are
  // exported from the modules that would have to export them. Both modules exist, so the failure
  // is a missing property on a real namespace and not a resolution error.
  //
  // The module record is read with `Object.keys` rather than a named import, which would be a
  // compile error today and would take `node scripts/typecheck.mjs` down with it rather than
  // producing a red test; rather than `import * as`, which `import/no-namespace` forbids; and
  // rather than a `typeof import(...)` widening, which `consistent-type-imports` forbids. It is
  // also the most diagnostic of the three, because the failure message prints the export list that
  // does exist next to the name that does not.
  //
  // Before #601 both were `undefined`. `readModuleDef` existed at `./index.ts:50` and was not
  // exported; `../di/index.ts` has no reader for the `INJECTIONS` slot at all — §L10 notes that
  // nothing in the repository reads it.
  it('exports moduleDefOf from the modules entry and injectionsOf from the di entry', async () => {
    expect(Object.keys(await import('./index.js')), 'modules/index.ts').toContain('moduleDefOf');
    expect(Object.keys(await import('../di/index.js')), 'di/index.ts').toContain('injectionsOf');
  });
});
