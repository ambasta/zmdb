# `@zmdb/web` — modules & providers SPEC

> `@Module` + a provider graph over the DI Container (epic #282). Frozen before
> code.

## Contract

### `@Module({ controllers?, providers?, imports?, exports? })`

A Stage-3 **class** decorator recording a module definition in `context.metadata`:

- **`providers`**: `readonly ProviderDef[]` — each `{ token, useValue }` (a bound
  value) or `{ token, useFactory }` (a factory `(c: Container) => T`), optionally
  `{ scope: 'singleton' | 'transient' }` (default `singleton`).
- **`controllers`**: `readonly Constructor[]` built through the container.
- **`imports`**: other `@Module` classes, or `lazy(ModuleClass)` declarations.
- **`exports`**: the declared subset intended for importers. Visibility remains
  aspirational; the current shared container does not enforce it (see §L10).

### `compileModule(RootModuleClass): CompiledModule`

Walk the module graph (acyclic) and:

- validate the complete graph before constructing anything, including lazy
  edges, unresolved injections, cycles and duplicate provider tokens,
- create one `Container`, register eager providers and build eager controllers,
- retain per-app handles that instantiate lazy subtrees on first use,
- expose `{ container, controllers, lazy }`.
- **Singleton** providers resolve once and cache; **transient** re-run the factory
  on each `resolve`. Detect and throw on an **import cycle**.

## Invariants

- Static declarations are validated and cached at compile time. A lazy load
  consumes its cached subtree order; there is **no per-request graph walk or
  reflection**.
- **No `as`/`any`/`!` on the consumer surface.** Provider token typing carries T.
- Builds on `@zmdb/web/di` — the Container remains the single registry.

## Acceptance

- A root module with providers + controllers + an imported module compiles: its
  controllers are built and their injected providers resolve (incl. from imports
  it exports).
- A transient provider yields a fresh value per resolve; a singleton is cached.
- An import cycle throws.
- No consumer-surface `as`; suite + typecheck green.

## Pending: a `commands` key

`ModuleDef` gains `readonly commands?: readonly Constructor<object>[]` and `CompiledModule` gains
`readonly commands: readonly object[]`, built the same way and in the same walk as `controllers`. Additive,
with no behaviour change for a module that does not use it. The reasoning is in `../cli/SPEC.md` §6: a
command class listed in `controllers` would be built correctly and then registered as a route source, and a
command class listed nowhere is never built at all, so its `@Inject` fields throw.

`runInit`/`runShutdown` take both lists for the same reason — a command whose repository needs
`onModuleInit` would otherwise get an uninitialised one.

## Out of scope

App bootstrap/lifecycle (epic #292), guards/pipes (#287).

## Amendments (lazy modules and the graph's data source, #599)

Deferring part of the module graph until a request needs it, and exposing the readers a graph
description is built from (epic #598, sub-issue #599). The description itself — its shape, its
provenance and the subpath it lives behind — is `../devtools/SPEC.md`. The `modules` and `repl`
commands are `../../../zmdb/src/cli/SPEC.md`'s `## Amendments (the module inspector and the REPL,
#599)`. Frozen before code.

### L1. Lazy defers side effects, not bytes — and what happens to the invariant at :32-33

`lazy(module)` takes a **module class**, not a thunk. So by the time an application declares a
lazy import, the module's file has been imported, its decorators have run and its metadata is on
the class. **Nothing about the import cost is deferred.** What is deferred is:

1. constructing the module's providers, which is where a connection pool is opened;
2. running its `useFactory` functions, which is where a client handshakes;
3. building its controllers, which is where their `@Inject` fields resolve;
4. its `onModuleInit` and `onApplicationBootstrap` hooks, which is where a warmup happens.

That is the whole of the win, and it is worth having: an application whose admin module opens a
second pool and warms a cache pays for both at startup today even in a process that never serves
an admin route. It is not the win `docs-site/content/web-lazy-modules.md` implies when it talks
about cold start, and that page has to change (§DOCS).

The deferred-import arm — `lazy(() => import('./heavy.module.js'))` — is a **non-goal**, for a
reason that is structural rather than a matter of appetite. #599's own architecture constraint
is that a lazy module is "validated at startup", and a module inside an unevaluated `import()`
has no metadata to validate: its `imports`, its providers and its controllers' `@Inject` fields
do not exist until the file is evaluated. Supporting it would mean either awaiting every dynamic
import during `createApp` — which defers nothing and is a slower startup than today, because it
serialises imports the loader would have done in parallel — or abandoning startup validation for
those subtrees, which is the one thing the epic says not to do. The cold-start goal it aims at is
already reachable, and already documented: a dynamic `import()` inside a `useFactory`
(`web-lazy-modules.md:39-49`).

`## Invariants`' first bullet (:32-33) currently reads "Static wiring at compile time
(module-graph walk), cached — **no per-request graph walk, no reflection.**" As written, that
forbids this feature. It is amended to three claims, which are what it was protecting:

1. **No reflection, ever.** Unchanged and absolute. A lazy module's wiring is read from the same
   decorator metadata, written at class-definition time.
2. **No graph walk on any request.** The complete declarations and each lazy subtree's
   construction order are cached at startup. In an application with no lazy imports,
   `registerDeferred` is never called and the eager instantiation path has no added `await`.
   This is the cost model the epic asks for, and it is a property of the code path rather than a
   benchmark result.
3. **The route table is still fixed after startup** — §L4 is the reason this survives, and it is
   the constraint that determines the design rather than following from it.

### L2. The surface, and four corrections to #599's sketch

```ts
/** Declare an import whose module is compiled on first use rather than at startup. */
export declare function lazy(module: ModuleClass): LazyImport;

export interface LazyImport {
  readonly kind: 'lazy';
  readonly module: ModuleClass;
}

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
  /** Idempotent. Resolves when this module is wired and initialized; rejects terminally — §L7. */
  load(): Promise<void>;
}

export interface CompiledModule {
  readonly container: Container;
  readonly controllers: readonly object[];
  readonly lazy: readonly LazyModuleHandle[];
}
```

`LazyImport` is discriminated by `kind` rather than by a branded symbol, so an `imports` entry is
narrowed with `typeof entry === 'function'` — no `as`, no `in`, and the marker is inspectable and
serialisable for `describeGraph`. Verified: the whole block above, plus that narrowing, compiles
under `--strict --exactOptionalPropertyTypes`.

**`lazy`, not `LazyModule`.** In this package a capitalised export is a decorator — `Module`,
`Inject`, `Controller`, `Get`, `Version`, `Command` — and a lowercase one is a function:
`compileModule`, `createToken`, `createApp`, `getRoutes`, `createRouter`. `LazyModule(Heavy)` in
an `imports` array reads as a decorator being called, in the one position where a reader is
already scanning for class names.

**`LazyModuleRef` with `load()` and `loaded` on the value `lazy()` returns is a cross-app state
bug, and this is the correction that matters most.** `imports: [LazyModule(Heavy)]` evaluates
once, when the module file is imported, so the object holding `loaded` and its cached promise is
shared by every application compiled from that module class. Two `createApp` calls from one root
module is not hypothetical — it is what `docs-site/content/web-multiple-servers.md` documents and
what every test file that builds an app per `it()` does. The second app would observe
`loaded: true` for a module it never wired, and resolve tokens out of the _first_ app's container
or throw, depending on which. So `lazy()` returns an inert **declaration** with no state at all,
and load state lives per-app on `CompiledModule.lazy`. Test isolation is not a nice property
here; a framework whose module declarations accumulate state across apps cannot be tested at all.

**`load(): Promise<void>`, not `Promise<CompiledModule>`.** There is exactly one `Container` for
the entire graph — `compileModule` constructs it once at :66 and every module registers into it —
so there is no second `CompiledModule` for a lazy subtree to be. Returning one would mean either
a nested container, which double-constructs the shared singletons the parent already holds (the
precise cost `web-lazy-modules.md` warns about in its two-apps workaround), or a fabricated
object whose `container` is the parent's and whose `controllers` is a subset, which invites
exactly the misreading that this is a separate graph. `void` says the thing that is true: the
load's effect is on the app you already have.

**`status: LazyStatus`, not `loaded: boolean`.** A boolean cannot distinguish "not started" from
"in flight", which is the state a concurrency assertion has to observe (§L8), nor from
"terminally failed", which is the state that changes what a subsequent request gets (§L7). A
boolean would force every caller that cares to infer those from a side channel.

### L3. What startup validates, and the residue it cannot

Validation stays eager and total. `compileModule` walks lazy subtrees for **declarations** while
constructing nothing, so these are refused at `createApp` rather than on the request that first
touches a lazy module:

| refused at startup                                           | how it is known                                                |
| ------------------------------------------------------------ | -------------------------------------------------------------- |
| an `@Inject` token no module in the graph registers          | the union of every module's `providers` vs. every `INJECTIONS` |
| an import cycle, lazy edges included                         | the existing `inProgress` check (:69, :80), with a path — §L10 |
| two modules registering the same token                       | comparing declarations rather than watching `#bindings.set`    |
| an eager class injecting a token only a lazy module provides | the eager set from pass one vs. the lazy set from pass two     |

The last row is the one worth arguing. Without it, that application starts, and then the _first_
request to an eager controller fails inside a field initialiser with a bare
`UnresolvedTokenError` naming the token but not the reason — and the reason is a `lazy()` wrapper
in a module the reader is not looking at. Refused at startup, the message names both classes and
the token, and the fix is obvious: unwrap the `lazy()`. This is also why laziness cannot be a
per-import property. **A module reachable by any eager path is eager**, even where another module
imports it lazily; lazy means "a subtree nothing eager reaches".

That forces a **two-pass compile**, which is a real change to the walk at :65-101 and not an
addition to it. Pass one follows only eager edges from the root and computes the eager set; pass
two takes the lazy edges out of every module in that set and assigns each unreached subtree to a
handle. One pass cannot do it: reaching `SharedModule` through a `lazy()` edge before reaching it
eagerly, or after, would decide whether it is lazy — so laziness would depend on the order of an
`imports` array, and moving one line in an unrelated module would move a pool open from startup
into the first request. Order-dependent wiring is the failure this project rejects in its
guards-versus-middleware ordering, and it is worse here because there is nothing to read that
reveals it.

The residue cannot be validated at startup by any means, and pretending otherwise is worse than
naming it:

| not knowable until the load runs                   | why                                    |
| -------------------------------------------------- | -------------------------------------- |
| a `useFactory` that throws                         | running it is the thing being deferred |
| a constructor or field initializer that throws     | same                                   |
| an `onModuleInit` that rejects                     | same                                   |
| a token resolved dynamically inside a factory body | undecidable — `../devtools/SPEC.md` §2 |

So the guarantee is stated exactly: **a lazy module's wiring is validated at startup; its
execution is not.** An application that wants execution validated at startup should not make that
module lazy, which is the honest trade and the reason the default stays eager.

### L4. Routes register eagerly, and the handler is a trampoline

**Every route of a lazy module is registered at startup, from the controller class.** This is
forced, and by two independent things.

The first is reachability. If routes appeared only after a load, nothing would ever trigger the
load — the request to `/admin/users` would 404, so the module stays unloaded, so the route never
appears. The only escapes are a second dispatch mechanism (a catch-all that consults a table of
maybe-routes, which is a per-request graph walk in the shape :32-33 exists to forbid) or an
`app.register()` the application calls after startup, which is `web-lazy-modules.md`'s own
suggestion and which it correctly notes costs "the route table no longer being fixed after
`init()` — which is currently a property worth something". It also does not solve the trigger
problem: something still has to decide when.

The second is that the data is already available from the class. `getRoutes` takes the controller
**class** (`../routing/index.ts:106`) and reads `Symbol.metadata` off it; only the final bind of
the handler needs an instance (`../pipeline/index.ts:258-269`, which reads the method off the
instance). So a route's method, path and handler name are all knowable at startup for a
controller that has never been constructed. Eager registration is not a workaround here; it is
reading the data where it lives.

The router therefore gains one method, additively:

```ts
registerDeferred(controller: Constructor<object>, instance: () => Promise<object>): void;
```

`register`'s signature and every existing call site are untouched, which matters because
`../pipeline/SPEC.md`'s `## Amendments (streaming responses, #565)` is frozen against the current
one. Routes registered this way bind a handler that awaits `instance()` and then invokes the
named method on what it returns — the same final step `readHandler` performs, one `await` later.
The router may replace that handler with the ordinary bound one after the first successful load;
what is frozen is that **no route is added or removed after startup**, so the table's contents,
its order and its shadowing are decided at `createApp` exactly as they are today. Registration
order for a lazy module's routes is its position in the graph walk, so a shadowing conflict
between a lazy and an eager controller resolves identically whether or not the module ever loads.

The observable cost is one microtask on requests to a lazy module's routes, and nothing at all
elsewhere: `registerDeferred` is never called by an application with no lazy imports.

### L5. Wiring a lazy subtree is one synchronous region

Inside a load, registration and construction must happen in a single synchronous region — no
`await` between the first `container.register` and the last `container.build`.

This is not style. `../di/index.ts:50` holds a module-scope `currentContainer`, set and restored
around `new Ctor()` by `withActiveContainer` (:55-63), and it is what `@Inject`'s field
initializer reads (:81-88). The save/restore is safe only because the region between them cannot
interleave; an `await` inside it lets a concurrent load, or a concurrent `createApp` in the same
process, observe or clobber the wrong container. The existing code is correct because
`compileModule` is entirely synchronous, and a lazy load is the first place in this package where
that could stop being true.

So a load is: resolve the subtree's declarations (already done at startup), register its
providers, build its controllers, all synchronously; **then** await hooks (§L6). `load()` returns
a promise because of the hooks and because a caller awaits it, not because the wiring is async.
A consequence worth stating: a `useFactory` remains synchronous, exactly as it is today, and lazy
modules do not create an async-provider path. `web-lazy-modules.md:39-49` is right that "the
container has no async resolution", and this does not change that — a provider needing async
setup still resolves to a client that connects in `onModuleInit`.

### L6. The triggering request waits

| behaviour                        | frozen                                                          |
| -------------------------------- | --------------------------------------------------------------- |
| the request that triggers a load | waits for the load, then is handled normally                    |
| a 503 while loading              | no                                                              |
| a background or eager pre-load   | no                                                              |
| a framework timeout on a load    | no                                                              |
| `onModuleInit`                   | runs, on that module's instances, before the request is handled |
| `onApplicationBootstrap`         | runs too, immediately after                                     |

The request waits because the alternative is a 503 for a request that was going to succeed. A
client that retries turns one slow request into two, and a client that does not has been told the
service is unavailable when it is merely cold. This is a latency spike on one request per lazy
module per process, and it is the cost the application opted into by writing `lazy()`.

No framework timeout, because there is no safe thing to do when it fires. Abandoning a load
leaves a container with some of a module's providers registered and some of its controllers built
— the half-built graph `mapping.mjs:873-879` objects to — and there is no rollback (§L7). An
application that needs a bounded wait puts it where the deadline is known, on the client or in a
proxy; a framework timeout would be a number the framework invented, and the only correct value
depends on the pool it is opening.

`runInit` is reused unchanged over just that module's instances, which means both hooks run:
`onModuleInit` for all of them, then `onApplicationBootstrap` for all of them
(`../lifecycle.ts:39-46`). Skipping `onApplicationBootstrap` because "the application already
bootstrapped" is refused — a hook that silently does not run is the failure mode this project
rejects everywhere, and a warmup written in that hook would go missing precisely in the module
whose warmup was expensive enough to defer. The honest consequence is a semantic shift, stated
rather than hidden: `../lifecycle.ts:34-38` promises that a bootstrap hook "can rely on every
module having been initialized", and for a lazily loaded module that becomes **every instance of
this module**, because the eager graph's hooks ran at startup and no other lazy module's have to
run first.

### L7. A failed load is terminal, and this answers the poisoned-promise question

If any part of a load throws — a factory, a constructor, a field initializer, a hook — the
handle's `status` becomes `failed`, the triggering request gets that error, and **every later
request to that module gets the same error**. `failed` is absorbing; `load()` never retries.

That is not a policy choice among several. `Container` has no transaction: `register` and
`registerFactory` are `Map.set` (`../di/index.ts:108-115`), there is no `unregister`, and adding
one would not help — an instance built before the failure may already be held by a controller
that was built successfully, and evicting a binding cannot un-build it. A nested container
double-constructs the parent's singletons. And a factory that ran had its side effect: a socket
is open, and it is not tracked anywhere, because nothing asked it to be. A retry over that state
is a second pool on top of a leaked first one.

So #599's demand that a failure "not poison the promise forever" is engaged directly rather than
accommodated. The pathology it names is real, and it is the pathology of caching a **retryable**
failure. With `lazy(ModuleClass)` there is no import step, therefore no transient
module-resolution failure, therefore nothing retryable in the load itself — every failure mode
left is application code that threw, and re-running it is how the second pool gets opened. The
freeze is the mechanism that makes the pathology inexpressible, not a policy layered over it.

Two mechanical points follow. The settled failure is stored as an **error value** and rethrown
from each `load()` call, not as a retained rejected promise: a rejected promise nobody awaits —
and `registerDeferred`'s trampoline can produce one on a request that is abandoned — is an
unhandled rejection, which by default terminates the process. And the rule for a future
deferred-import arm is written down now while the reasoning is at hand: an `import()` that fails
_is_ retryable, its promise must be dropped rather than cached, and it must be distinguished from
a wiring failure, which is not.

The consequence for #600: its title `does not cache a failed load, and retries per the specified
policy` describes the opposite of what is frozen. The specified policy is no retry, and the
assertion is that the _same_ error is delivered on the second request and that no factory ran
twice. The title has to change before `mapping.mjs` cites it, or the test freeze commits to a
behaviour this file rejects.

### L8. Concurrency: one promise, one load

Ten simultaneous requests to a lazy module's routes trigger one load. The handle stores the
in-flight promise on the transition to `loading` and every later caller awaits that same promise,
which is the standard shape and the one `web-lazy-modules.md` already reaches for in its
promise-caching note. Node's single-threaded event loop makes the check-and-set safe with no
lock: the synchronous region in §L5 cannot interleave, and the only `await` is the hooks.

Every waiter sees the same outcome, success or failure. In particular ten waiters on a failed
load get ten copies of one error rather than ten attempts — which is the same statement as §L7,
and the reason `loading` has to be a distinct state rather than an implementation detail.

### L9. Shutdown

A module that never loaded has no instances, so its `onShutdown` never runs. Constructing one in
order to shut it down would open the pool it is about to close — the exact inversion — so this is
stated as a guarantee rather than left as an accident: **`onShutdown` runs only on instances that
exist.**

A loaded module's instances are appended to the single ordered instance list that
`CompiledModule.controllers` and the provider registry feed, so `runShutdown`'s reverse iteration
(`../lifecycle.ts:48-54`) tears them down before the eager providers they depend on, which is the
same guarantee an eager module gets and for the same reason.

`[Symbol.asyncDispose]` refuses a **new** load — `'@zmdb/web: application is shutting down'`,
delivered to the request that triggered it — and **awaits an in-flight one** before running
`onShutdown`. Abandoning an in-flight load is the worse of the two: the region in §L5 does not
yield, so what is abandoned is the hooks, leaving a module that finishes initializing after
shutdown completed, holding a connection whose `onShutdown` has already run or will never run.
Waiting is bounded by one load. This makes shutdown the one place a load can be observed by
something other than the request that triggered it.

### L10. Where the graph description's data comes from, and one divergence to record

`../devtools/SPEC.md` builds its description from decorator metadata, and needs two readers this
module already has in unexported form:

```ts
/** `readModuleDef` at :50, exported. `undefined` for a class with no `@Module`. */
export declare function moduleDefOf(module: ModuleClass): ModuleDef | undefined;
```

plus `injectionsOf` from `../di/index.ts`, which reads the `INJECTIONS` slot `Inject` writes and
which nothing in the repository reads today. `../devtools/SPEC.md` §4 records the
prototype-aliasing bug that writer used to have — `existing.push(request)` mutated the _base_
class's array for a decorated field on a subclass, verified by running compiler output — and the
own-property fix, which was a prerequisite for the description being accurate for any subclassed
class and which landed with #607.

The cycle message becomes the path, which needs no new bookkeeping: `inProgress` is a `Set`
(:69), `Set` iteration is insertion-ordered, and at the moment `inProgress.has(moduleClass)` is
true (:80) the path is that set from the repeated module onward plus the repeated module again.
Frozen text: `@zmdb/web: import cycle in the module graph: AppModule -> BillingModule ->
UsersModule -> BillingModule`. `moduleClass.name` needs no assertion — verified to compile
against `ModuleClass`'s bare construct signature under `--strict`.

**One divergence between this file and the code has to be recorded, because a graph description
would otherwise publish it as a guarantee.** `### compileModule` says providers are registered
"respecting `imports`/`exports` visibility" (:23-24) and `@Module`'s contract says `imports` are
"other `@Module` classes whose **exports** are visible here" (:16-17). `compileModule` does not
implement that: it registers every visited module's providers into the one container without
consulting `exports` at all (:89-93, whose only condition is the testing override check at :90),
and `def.exports` is never read anywhere in the file. Every token is visible to every
module, and `exports` is inert. #599 does not fix it — changing resolution semantics affects
every existing application and belongs to its own freeze — so the two sentences above are
**aspirational and marked as such**, `describeGraph` does not report `exports`, and no diagram
draws it as a boundary. Documenting an unenforced boundary is worse than documenting none,
because a reader who trusts it writes code whose correctness depends on it.

### L11. Two amendments this forces in sibling specs

**`../pipeline/SPEC.md`, `### Route registration` (:8-16)** gains one bullet, and nothing else in
that file changes:

> - **`router.registerDeferred(controllerClass, instance)`** — read the routes via
>   `getRoutes(controllerClass)` at register time, exactly as `register` does, and bind each to a
>   handler that awaits `instance()` and invokes the method on the result. For a lazily imported
>   module's controllers (`../modules/SPEC.md` §L4). No route is added or removed after startup.

**`../app/SPEC.md`** needs `App` to carry the handles, so that a `zmdb repl` session can load a
module without synthesising a request, and its bootstrap invariant needs the §L1 wording:

> - **`lazy: readonly LazyModuleHandle[]`** — the lazily imported modules and their load state,
>   from `compileModule` (`../modules/SPEC.md` §L2). Empty for a graph with no `lazy()` imports.

and the invariant at :34-35 ("Everything (DI graph, routes) wired **at bootstrap**") becomes
routes wired at bootstrap always, and the DI graph at bootstrap except for lazily imported
subtrees, whose _declarations_ are still validated there. `../testing/SPEC.md` needs no change:
`TestApp` exposes neither `container` nor `lazy`, and `createTestApp`'s overrides apply to the
whole graph because they are registered ahead of every module (:72-74) and re-checked per provider
by `isOverridden` (:90) regardless of when that provider is registered — so an override still wins
inside a lazy load, which is what makes a lazy module testable.

### L12. What #600 has to assert

1. Compile-time, in a `*.type-test.ts`: `imports: [lazy(Heavy), Other]` type-checks; an
   `imports` entry is narrowed by `typeof entry === 'function'` with no `as`; `load()` is
   `Promise<void>` and assigning its result to `CompiledModule` is rejected.
2. Two `createApp` calls from one root module each report `status: 'unloaded'`, and loading in the
   first leaves the second `'unloaded'` — the assertion that fails against #599's `LazyModuleRef`.
3. A lazy module's providers are not constructed by `createApp`: a `useFactory` spy has zero calls
   after `init()` resolves, and one after a request to that module's route.
4. `getRoutes` aside, the route table is complete at startup: a request to a lazy module's route
   returns its handler's response rather than a 404, and the count of registered routes is the
   same whether or not any load has happened.
5. An application with no `lazy()` imports registers zero deferred routes, and the per-request
   metadata read count from `countMetadataReads` (`../bench/index.ts:20`) is unchanged from
   today's — the §L1 cost claim, asserted where it can be measured.
6. Each row of §L3's first table throws from `createApp`, before any provider is constructed; the
   eager-depends-on-lazy message names both module classes and the token.
7. `imports: [lazy(Shared)]` in one module and `imports: [Shared]` in another compiles `Shared`
   eagerly, and the result does not depend on the order of the root module's `imports`.
8. `onModuleInit` **and** `onApplicationBootstrap` both run on a lazily loaded module's
   instances, in that order, before the triggering request's response is produced.
9. A factory that throws makes `status` `'failed'`; a second request receives the same error, and
   the factory ran exactly once. This replaces #600's `does not cache a failed load, and retries
per the specified policy`, which asserts the opposite of §L7 and has to be retitled.
10. Ten concurrent requests to a lazy module trigger one load — the factory spy has one call —
    and all ten get a successful response; the same fixture with a throwing factory yields ten
    identical errors and still one call.
11. A never-loaded module's `onShutdown` does not run; a loaded module's runs before the eager
    provider it injects. `[Symbol.asyncDispose]` during an in-flight load waits for it, and a
    request arriving after dispose began gets the shutting-down error rather than a load.
12. `moduleDefOf` and `injectionsOf` are exported and reachable from `@zmdb/web/modules` and
    `@zmdb/web/di` — checked by `yarn verify:exports`, not by an import in a test.

### Non-goals (rejected in this amendment)

- **`lazy(() => import('./m.js'))`, the deferred-import arm** (§L1) — unvalidatable at startup,
  and the cold start it targets is already reachable with a dynamic import inside a `useFactory`.
- **Per-import laziness, where the same module is lazy from one importer and eager from another**
  (§L3). It makes wiring depend on `imports` array order.
- **A lazy module getting its own `Container`** (§L2) — double-constructed shared singletons.
- **Async providers, or an async `useFactory`** (§L5). Unchanged: a provider needing a connection
  opens it in `onModuleInit`.
- **`503` while loading, a background pre-load, or a framework load timeout** (§L6).
- **Retrying a failed load, or any `retry`/`backoff` option** (§L7). There is nothing retryable to
  retry, and the state a retry would run over cannot be rolled back.
- **Adding or removing a route after startup, and any `app.register()`** (§L4) — which is what
  `web-lazy-modules.md` proposes today.
- **Unloading a module, or any `dispose()` on a handle** (§L9). Nothing tracks which held
  references would dangle, and the container cannot evict an instance somebody holds.
- **Reporting or enforcing `exports`** (§L10) — declared, unimplemented, and recorded as such
  rather than laundered.
- **A `lazy` flag on `@Module` itself.** Laziness is a property of an edge in the importer, not of
  a module: the same module can be reached eagerly, and §L3's rule needs the edge to decide.
