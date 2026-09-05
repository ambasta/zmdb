# `@zmdb/web` — graph description and the devtools boundary SPEC

> What the compiled module graph can be asked about, where every field of the answer comes from, how it is rendered at a size a human can read, and the structural separation that keeps the tooling out
> of a server process (epic #598, sub-issue #599). Frozen before code.

Lazy semantics, the two-pass compile and the metadata readers this file consumes are `../../../app/src/modules/SPEC.md`'s `## Amendments (lazy modules and the graph's data source, #599)`. The
`modules` and `repl` commands are `../../../zmdb/src/cli/SPEC.md`'s `## Amendments (the module inspector and the REPL, #599)`. This file is the value: its shape, its provenance, its failure reporting
and the subpath it lives behind.

## 1. The argument this has to answer, and it mostly survives

An earlier `tests/api-coverage/mapping.mjs` carried a committed argument against this feature, cited by three rows — `injector/e2e/introspection`, `inspector/e2e/graph-inspector` and `repl/e2e/*`:

> The NestJS REPL and graph inspector are developer tooling that introspects a booted application graph. zmdb resolves its graph at module construction and has no runtime metadata store to browse;
> what a developer needs to see is in the types and in the generated OpenAPI document, both of which exist before the process starts.

Two of its three clauses are not withdrawn. They are the design.

1. **"zmdb resolves its graph at module construction" stays true.** Nothing here introspects a booted application. `describeGraph` takes a module class and re-derives the description from decorator
   metadata — §2 — so it answers the same question before the process starts as after, and `zmdb modules` never constructs anything at all.
2. **"has no runtime metadata store to browse" stays true, and it is the reason for §2's signature.** There is no registry of provider descriptors, no reverse index, and nothing retained by
   `compileModule` beyond its runtime container, controller/command lists, and lazy handles (`../../../app/src/modules/index.ts`). The description is reconstructed, which is what makes the epic's §1
   cost constraint free rather than something to engineer around — §3.

The clause that stops being true is the third. **Provider dependency edges, scopes and the module a token was registered in are in neither the types nor the OpenAPI document**, and no amount of
reading either one answers "why is this a singleton" or "what breaks if I delete this provider". That is the gap, it is real, and `docs-site/content/web-devtools.md` states the reason for it too
strongly: it says there are "no [dependency edges] to record".

There are. `@Inject` records `{ field, token }` into `context.metadata` on every decorated class (`../../../app/src/di/index.ts`) and has done since the DI module shipped. The app-owned `injectionsOf`
reader exposes that slot to this HTTP-aware inspector without retaining a second graph.

The edges exist, unread, in the one place that cannot fall out of sync with the source. §4 reads them.

Those three rows plus `lazy-modules/e2e/*` now cite live tests. `NO_REPL` was deleted when the TTY-only session shipped; the replacement is executable evidence for the intended shape — a CLI over a
local application process with no socket, host or remote-attach protocol. `lazy-modules/e2e/*` likewise moved from "there is nothing to defer" to tests for eager validation and deferred construction.
`yarn verify:api-coverage` checks every cited title.

## 2. The surface, and why it cannot take an `App`

```ts
export interface ModuleNode {
  readonly id: string;
  readonly name: string;
  readonly lazy: boolean;
  readonly imports: readonly string[];
}

export type ProviderNode =
  | { readonly kind: 'value'; readonly id: string; readonly token: string; readonly module: string }
  | {
      readonly kind: 'factory';
      readonly id: string;
      readonly token: string;
      readonly module: string;
      readonly scope: Scope;
      /** `null` when the edges are not knowable — §4. Never absent, never `undefined`. */
      readonly dependencies: readonly string[] | null;
    };

export interface ClassNode {
  readonly id: string;
  readonly name: string;
  readonly module: string;
  readonly routes: readonly { readonly method: HttpMethod; readonly path: string; readonly handler: string }[];
  readonly dependencies: readonly string[];
}

export interface Finding {
  readonly kind: FindingKind;
  readonly severity: 'error' | 'warning';
  readonly message: string;
  /** The id the finding is about. */
  readonly subject: string;
  /** Present only for `cycle`: the module path, first element repeated last. */
  readonly path?: readonly string[];
}

export interface GraphDescription {
  readonly modules: readonly ModuleNode[];
  readonly providers: readonly ProviderNode[];
  readonly controllers: readonly ClassNode[];
  readonly findings: readonly Finding[];
}

export declare function describeGraph(rootModule: ModuleClass): GraphDescription;

export interface GraphFilter {
  readonly module?: string;
  readonly token?: string;
  readonly depth?: number;
  readonly providers?: boolean;
}

export declare function dependentsOf(graph: GraphDescription, id: string): readonly string[];
export declare function renderTree(graph: GraphDescription, filter?: GraphFilter): string;
export declare function renderDot(graph: GraphDescription, filter?: GraphFilter): string;
```

Six corrections to #599's sketch. The first is the one everything else follows from.

**`describeGraph(app: App)` cannot be written.** `App` is `{ container, handle, fetch, init, [Symbol.asyncDispose] }` (`../app/index.ts:14-19`) and holds no root module, no controller list and no
route table; `createApp` destructures `{ container, controllers }` and closes over the controllers without exposing them (`../app/index.ts:27-39`).

The one thing it does expose is the `Container`, whose `#bindings` and `#factories` are private fields (`../../../app/src/di/index.ts`) with `has` and `resolve` as the only readers — so a token cannot
even be enumerated from it, let alone attributed to a module.

An `App`-shaped signature therefore forces one of two things: a new field on `App` holding a description, which is the permanent retention the epic's §1 constraint forbids, or three new accessors on
`Container` that exist only for a development tool. `ModuleClass` is the argument the data is actually reachable from, and taking it has a second effect worth more than the first: the inspector runs
on a graph that does not boot.

**`providers[].dependencies` is `readonly string[] | null`, not `readonly string[]`.** A factory provider is `(container: Container) => T` (`../../../app/src/modules/index.ts`) — an arbitrary function
handed the whole container, which may resolve anything, conditionally, at any depth. Its edges are not derivable by any means short of running it, which is the thing the inspector must not do. So
`null` means "not knowable", `[]` means "knowable and empty", and the two must not collapse.

The distinction is load-bearing at the point of use: reading "nothing depends on `POOL`" off a graph that simply cannot see factory edges is how a provider gets deleted, and it is the single most
likely way this tool causes an outage rather than preventing one.

**`null` rather than `undefined`, deliberately.** `JSON.stringify` drops a property whose value is `undefined`, so the marker would vanish from exactly the output format a script reads and the field
would read as absent — indistinguishable from an older description, and one `?? []` away from the misreading above. `null` survives serialisation.

**`scope` lives only on the `factory` arm.** `ProviderDef` is a union in which `useValue` carries no scope at all (`../../../app/src/modules/index.ts`), because a bound value is not resolved once, it
is bound. Reporting `'singleton'` for it would answer the epic's own example question — "why is this a singleton?" — with a word that does not apply, so the description mirrors the union it describes
and a reader who sees `kind: 'value'` knows there is no factory to have run.

**`routes` is `{ method, path, handler }`, not `readonly string[]`.** `getRoutes` returns all three (`../routing/index.ts:117-121`) and the two the sketch drops are the two that make a shadowing bug
visible: `web-devtools.md`'s hand-written route printout prints method, path _and_ handler, and says registration order is what decides which of two matching routes wins. A path alone cannot express
`GET /users/:id` shadowing `GET /users/me`.

**There is no `exports` field, and this is not an oversight.** `ModuleDef.exports` is declared (`../../../app/src/modules/index.ts`) and `../../../app/src/modules/SPEC.md` records that visibility is
aspirational — `compileModule` does not enforce it. The walk registers every module's providers into one container without consulting it at all (other than the testing override check), whose only
condition is the testing override check at :90), so every token is visible to every module and `exports` is inert data.

Publishing it in a description, and worse drawing it as a boundary in a diagram, would document a guarantee the runtime does not provide. #599 does not fix that divergence — it is a change to
resolution semantics with consequences for every existing app — but the inspector refuses to launder it. When it is fixed, `exports` becomes a describable edge.

`commands` remains absent from the HTTP-aware graph description. Commands are app-owned and have no route projection; adding them to this surface is a separate contract change rather than a side
effect of moving the module graph.

Ids are namespaced strings — `module:UsersModule`, `provider:USERS_REPOSITORY`, `controller:UsersModule.UsersController` — so one flat id space serves every edge, a DOT node id is unambiguous without
a per-kind prefix invented by the renderer, and two classes of the same name in different modules do not collide.

A token whose description is not unique gets a `#<n>` suffix in declaration order **and** a finding (§5): `createToken` derives no identity from its description (`../../../app/src/di/index.ts`), so
two calls with the same string are two different tokens, and every output that names one is ambiguous.

That is the same failure `web-devtools.md` describes from the other end, where a token described `'token'` produces a useless `UnresolvedTokenError`.

## 3. Reconstructed on demand, which makes the cost constraint free

The epic's §1 constraint is that the metadata the inspector needs must not be retained at runtime unless asked for. The current implementation satisfies this without a special mechanism. Building the
description during compilation and attaching it to `CompiledModule` would be easier, but it would retain the graph.

`compileModule` returns runtime values — the container, controller/command instances, and lazy handles — but its traversal sets and per-module definitions are function-local and unreachable the moment
it returns. So there is no description to discard and no traversal to keep.

Everything the description needs is on the classes themselves — `ROUTES`/`PREFIX` in the routing metadata (`../routing/index.ts`), `MODULE` in the module metadata
(`../../../app/src/modules/index.ts`), and `INJECTIONS` in the DI metadata (`../../../app/src/di/index.ts`) — each written once at class-definition time and retained by the class for the process's
lifetime whether or not anybody ever describes anything. **The inspector adds zero retained bytes because it reads data that is already there and throws its own answer away.**

That resolves #599's step 5 question ("the eager path may discard what it does not need") by observing that the eager path discards nothing, because it never accumulated anything.

And it corrects the assertion #600 currently proposes, `does not retain graph metadata when the description was never requested`, which cannot be measured as written: the metadata belongs to the
class, not to the app, so it is retained in both arms of the experiment.

The measurable claim is that **nothing reads it until asked**, and `countMetadataReads` from `../bench/index.ts:20` already measures exactly that — §11.4.

The cost of reconstruction is one walk of the module classes per call, which is the cost of the startup walk, on a tool a human invoked. It is not on any request path.

The important distinction is that **a description describes the program, not a process.** It does not know about `compileModule`'s testing overrides, and it does not know whether a lazy module has
loaded. Lazy _status_ is per-app state and lives on `CompiledModule.lazy`'s handles (`../../../app/src/modules/SPEC.md`'s amendment §L2); `ModuleNode.lazy` is the declaration. Conflating the two would
make the CLI's output depend on whether a request had arrived, in a CLI that has no process to ask.

## 4. Where every field comes from

| field                        | source                                                        | knowable?                 |
| ---------------------------- | ------------------------------------------------------------- | ------------------------- |
| `modules[].name`             | `moduleClass.name`                                            | yes, unless anonymous     |
| `modules[].imports`          | `ModuleDef.imports`, via a new `moduleDefOf`                  | yes                       |
| `modules[].lazy`             | the `lazy()` marker on the importing module's `imports` entry | yes                       |
| `providers[].token`          | `Token.description` (`../../../app/src/di/index.ts`)          | yes                       |
| `providers[].module`         | which `ModuleDef.providers` list it appeared in               | yes                       |
| `providers[].kind`/`scope`   | the `ProviderDef` arm and its `scope ?? 'singleton'`          | yes                       |
| `providers[].dependencies`   | nothing — a factory body is opaque                            | **no**, always `null`     |
| `controllers[].routes`       | `getRoutes(ctor)` (`../routing/index.ts:106`)                 | yes                       |
| `controllers[].dependencies` | `INJECTIONS` on the class metadata, via a new `injectionsOf`  | yes, for `@Inject` fields |

Two readers have to be exported for this, and both are one line of new code over functions that already exist:

```ts
// @zmdb/app/modules — public module metadata reader.
export declare function moduleDefOf(module: ModuleClass): ModuleDef | undefined;

// @zmdb/app/di — reads the slot `Inject` writes.
export declare function injectionsOf(ctor: abstract new (...args: never[]) => unknown): readonly { readonly field: string | symbol; readonly token: Token<unknown> }[];
```

`moduleClass.name` is readable without an assertion even though `ModuleClass` is a bare construct signature — verified: `const n: string = M.name` compiles under
`--strict --exactOptionalPropertyTypes` for `type ModuleClass = abstract new (...args: never[]) => unknown`. An anonymous class or a mangled production build yields `''` or a mangled name, which is a
`warning`-severity finding and the reason the machine-readable form is the contract while the text tree is a convenience.

**`injectionsOf` could not have shipped on top of the slot as it was originally written, and that was a verified bug rather than a suspicion.** `Inject`'s writer did `existing.push(request)`, and a
stage-3 `context.metadata` object is created with the base class's metadata as its prototype, so for a decorated field on a subclass `existing` was _the base class's array_. Verified by compiling a
two-class fixture with `tsc --target es2022` and reading the result:

```
base own: 1 ["base.a","derived.b"]
derived:  ["base.a","derived.b"]
same object? false   proto chain? true   derived own slot? false
```

The base class ended up owning its subclass's injection. Nothing noticed, because nothing reads the slot; the inspector is its first reader, and it would have attributed a subclass's dependency to the
class it extends.

**This is fixed** (#607): the write is own-property-first — it copies the inherited list on the first own write, then pushes — so `injectionsOf(Base)` gets the base's fields and
`injectionsOf(Derived)` both, which is the semantics a reader expects.

The prerequisite for the accuracy assertion in §11.6 is therefore already met, and `di.spec.ts` asserts the ownership directly rather than through a reader that does not exist yet.

`pushRoute` (`../routing/index.ts`) had the same aliasing shape and is _read_ today, by `Router.register` (`../pipeline/index.ts:180`), so a controller subclassing a controller was already affected in
production. It is fixed in the same change, with the inheritance semantics now written down in `../routing/SPEC.md`: inherited routes then own, a redeclared handler renaming rather than duplicating,
and a base whose table does not change when a subclass is evaluated.

## 5. Findings, not exceptions

`describeGraph` **never throws.** Every problem it can see is a `Finding` in the returned value.

That is the opposite of `compileModule`, which throws on a cycle and lets `UnresolvedTokenError` out of a field initialiser (`../../../app/src/modules/index.ts`, `../../../app/src/di/index.ts`), and
the asymmetry is deliberate: the inspector is the tool you reach for **because** the application will not boot, and a diagnostic that fails on the input it exists to explain is useless. A cycle
throwing out of `describeGraph` would produce, for `zmdb modules`, exactly the message `web-devtools.md` already complains about, in the one command whose job is to say more than that.

| kind                          | severity | meaning                                                                           |
| ----------------------------- | -------- | --------------------------------------------------------------------------------- |
| `cycle`                       | error    | An import cycle, with `path` — §6.                                                |
| `unresolved-token`            | error    | An `@Inject` field whose token no module in the graph registers.                  |
| `eager-depends-on-lazy`       | error    | An eager class injects a token only a lazy module provides — amendment §L3.       |
| `duplicate-provider`          | error    | Two modules register the same token; `compileModule` refuses the graph.           |
| `shadowed-route`              | error    | Two controllers register the same method and path; the first wins.                |
| `duplicate-token-description` | warning  | Two distinct tokens share a description, so every output naming one is ambiguous. |
| `anonymous-class`             | warning  | A module, controller or provider whose `name` is empty or mangled.                |

`shadowed-route` is the check `web-devtools.md` writes by hand and then says to promote into a test. It is promoted into the tool instead, which is strictly better: the page's version compares a
hand-maintained `CONTROLLERS` array, and the tool compares what the module graph actually registers.

Severity is what the CLI's exit code reads (`../../../zmdb/src/cli/SPEC.md`'s amendment §R3): any `error` exits 1, a `warning` alone exits 0. A single exit code for every finding would make
`zmdb modules` in CI fail on a cosmetic token description, and per-finding exit codes are the thing that file's §7 already rejects.

## 6. A cycle without its path is a puzzle

`compileModule` now names the cycle path:

```
@zmdb/app: import cycle in the module graph: AppModule -> BillingModule -> UsersModule -> BillingModule
```

first element repeated last, so the closing edge is visible rather than inferred. The `Finding` carries the same list in `path`.

**This needs no new bookkeeping.** The app module walk's `inProgress` value is a `Set<ModuleClass>` (`../../../app/src/modules/index.ts`) and `Set` iteration is insertion-ordered, so at the moment
`inProgress.has(moduleClass)` is true (`:80`) the path is that set from the repeated module onward, plus the repeated module again. An implementation that adds a parallel array is adding a second copy
of the truth to the one function whose correctness this depends on.

The same path makes the cycle a `warning`-free `error` finding rather than a throw in `describeGraph`: the walk that finds it is the walk that describes everything else, so a described graph with a
cycle is a complete description plus one finding, not a partial one.

## 7. Three output formats, and the diagram is DOT

`renderTree` and `renderDot` are pure functions of a `GraphDescription`, and the machine-readable form _is_ the description — `JSON.stringify` of the value, emitted by the CLI under the global
`--json` flag. That ordering matters more than the formats: because every renderer is a pure function of one serialisable value, a fourth format costs a function and no spec change, and a consumer
that needs something else can render it themselves without the package growing a template option.

The text tree is the modules, each with its providers and controllers indented beneath it, and `web-devtools.md` is right that this printout is the most useful diagnostic in the framework — so route
lines keep its column shape (`method` padded, `path` padded, `Class.handler`) and registration order, because order is the shadowing information.

**The diagram format is DOT, not Mermaid.** Mermaid is more convenient in the one place it renders, and it loses on the thing that decides: the labels here are route paths, token descriptions and
class names, which contain `/`, `:`, `#`, `-`, spaces and occasionally unicode.

Mermaid's node-id and label grammar rejects or mangles several of those, and the escaping differs between node shapes, so a generator would emit invalid diagram source for a perfectly valid
application — a failure that surfaces as a blank panel in somebody else's renderer, with no error anywhere.

DOT has one quoting rule (`"…"` with `\"`) that covers every byte, its layout engine was written for graphs of this size, and `dot -Tsvg` runs locally with no network and no renderer to be at the
mercy of. A Mermaid emitter can be added later from the same description if somebody wants one pasted into a README.

## 8. A graph of realistic size, decided up front

A diagram of 200 providers is unreadable, and an unreadable diagram is indistinguishable from a broken one. So the filtering is the feature, not an option on it:

| filter      | means                                                                                |
| ----------- | ------------------------------------------------------------------------------------ |
| default     | modules and their import edges only. No provider nodes.                              |
| `providers` | include provider and controller nodes.                                               |
| `module: N` | `N`, what it imports transitively, and the providers and controllers declared in it. |
| `token: D`  | the node with that description, its dependencies and its dependents.                 |
| `depth: n`  | bounds the transitive closure of `module`/`token` to `n` edges. Default 2.           |

**The default granularity is the module graph, and that is the whole large-graph answer.** Twenty modules with import edges is a picture; two hundred providers is a hairball. Choosing the readable
projection as the default is better than a node cap, because a cap produces a diagram that is silently missing things, and it is better than emitting everything and letting the user regret it after
`dot` has run for forty seconds.

`providers` with no `module` and no `token` on a graph above **fifty** provider nodes is refused — exit 2 from the CLI, naming the count and listing the module names to filter by. Refusing rather than
emitting is the same judgement `../static/SPEC.md` §5 makes about directory listings and `../../../zmdb/src/cli/SPEC.md` §11 makes about a prompt without a TTY: when the only useful next step is a
flag, say so now instead of producing something the user has to learn to distrust.

`dependentsOf(graph, id)` is the reverse-edge query — the epic's "what depends on this?" and the one that answers "can I change this?". It is a function over the description rather than a field in it,
because reverse edges are derivable, and materialising them would double the JSON and create a second place the same truth lives. Its answer is **complete for `@Inject` edges and incomplete for
factory edges by construction** (§4).

There is no reliable way to name which opaque factory consumes a token: doing so would require running or parsing the body, both rejected in §2. So every provider query on a graph containing an opaque
factory appends the explicit sentinel `<factory dependencies unknown>`. Factory nodes are dashed in DOT and labelled `dependencies unknown` in the text tree. A silent omission here is the deletion
described in §2.

## 9. `./devtools`, and four barriers rather than a convention

DoD 6 of the epic asks that nothing in this path be importable into a production request path "enforced, not documented". Four things enforce it, and they are independent:

1. **A separate subpath.** `packages/web/package.json` gains `"./devtools": "./src/devtools/index.ts"`. Nothing under `src/devtools/` is re-exported from `src/index.ts`, from `../app/index.ts`, or
   from `packages/zmdb/src/web.ts` — and that last one is where this rule gets broken first, because that file's stated habit is to enumerate every public symbol (`packages/zmdb/src/web.ts:1-2`).
   `lazy` and the two metadata readers are re-exported there; `describeGraph` and the renderers are not.
2. **The REPL is not in this package at all.** It is a `zmdb` CLI command (`../../../zmdb/src/cli/SPEC.md`'s amendment §R4) behind `./cli` and `bin:zmdb`, which the canonical architecture policy marks
   as tooling entries, so it is not present in an ordinary application export to be reached. `@zmdb/web` exports no function that starts a REPL, and `node:repl` appears nowhere under
   `packages/web/src`.
3. **A gate.** `yarn verify:runtime-reachability` walks every export and executable through relative and workspace imports, with tooling ownership supplied only by the architecture policy.
   `@zmdb/web#./devtools`, `zmdb#./cli` and `zmdb#bin:zmdb` are the intended tooling entries; an ordinary entry reaching `src/devtools/` or `node:repl` fails with the shortest chain. The historical
   `yarn verify:devtools-boundary` command remains a compatibility wrapper over the generic verifier. The reverse direction is allowed and must be: `src/devtools/` imports public `@zmdb/app/modules`,
   `@zmdb/app/di`, and `../routing`, which is the point.
4. **No TTY, no REPL.** The runtime refusal, specified in that same amendment, so that even `zmdb repl` spawned from a request handler declines.

The failure mode all four exist to prevent is one line in a controller — `import { describeGraph } from '@zmdb/web/devtools'` behind a `/__graph` route — which ships the inspector into production and
serves a document naming every token, every route pattern and every module. That is a route-table oracle, refused for the same reason `../versioning/SPEC.md` §5 declines to enumerate versions in a
`404` body. The graph is not secret, and it is also not something to hand out.

## 10. What #600 has to assert

1. `describeGraph` over the large fixture returns a description whose `modules`, `providers` and `controllers` match a golden value, including `kind: 'value'` carrying no `scope` and `kind: 'factory'`
   carrying `dependencies: null`.
2. Compile-time, in a `*.type-test.ts`: `describeGraph(app)` is rejected where `app: App`, and accepted for a `ModuleClass`; reading `scope` off a `ProviderNode` without narrowing `kind` is rejected.
   No `as` anywhere in the fixture or the tests.
3. `JSON.stringify` of a description containing an opaque factory contains `"dependencies":null` — the assertion that fails if the marker is `undefined`.
4. Between `createApp` and the first `describeGraph` call, `countMetadataReads` (`../bench/index.ts:20`) on a module class reports **zero** reads, and a non-zero count after it. This replaces #600's
   `does not retain graph metadata when the description was never requested`, which cannot pass as titled — the metadata is owned by the class in both arms. The title has to change with it, before
   `mapping.mjs` cites it.
5. `dependentsOf` over a token injected by two controllers returns both plus the opaque-factory sentinel, and a provider with no known consumer still returns that sentinel rather than the unsafe claim
   that it has no dependents.
6. `injectionsOf(Base)` returns only the base class's fields when a subclass adds one (§4).
7. Each row of §5, by `kind` and `severity`, on a fixture variant that provokes it; and `describeGraph` over a fixture with a cycle **returns** rather than throws, while `compileModule` over the same
   fixture still throws.
8. The cycle message and the `path` are `A -> B -> C -> A` for a three-module cycle, first element repeated last, asserted on the string.
9. `renderDot` of a description whose route path contains `/` and whose token description contains a space and a `#` produces output that `dot` parses — asserted by the quoting rule rather than by
   spawning graphviz.
10. `renderDot` with `providers: true` and no filter over a fixture with more than fifty provider nodes refuses; with `module` set it emits, and the node count is bounded by `depth`.
11. The boundary gate fails on a planted `import '@zmdb/web/devtools'` in `../app/index.ts` and passes on the tree as committed — the enforcement asserted as enforcement, not as a convention.

## Non-goals (rejected)

- **`describeGraph(app: App)`, and any `App` or `Container` accessor added to support it** (§2).
- **Reporting `exports` as a visibility boundary** (§2) — it is declared and unenforced, and a diagram is the worst place to imply otherwise.
- **Guessing factory dependencies**, by parsing a function body, by a proxy container that records `resolve` calls, or by running the factory (§2, §4). The first two are reflection, the third is the
  instantiation the description exists to avoid.
- **A description field on `CompiledModule`, or building one during the compile** (§3) — the permanent retention the epic's §1 forbids, for a tool a human invokes.
- **Lazy load status inside `GraphDescription`** (§3) — a description of a program, not a snapshot of a process.
- **Materialised reverse edges** (§8) — derivable, and a second copy of the truth.
- **Mermaid as the frozen diagram format** (§7). It can be added later from the same value.
- **A node cap instead of a default projection** (§8) — a capped diagram is silently wrong.
- **Throwing from `describeGraph`** (§5).
- **A web UI, or any HTTP surface for the description** (§9) — the epic's own non-goal, and §9's route-table-oracle argument is why it is not a small one.
- **Serving the description from the application at all**, behind a flag, a guard or a development-only check (§9). The gate is what makes the absence checkable.
- **Hot module replacement** — the epic's non-goal, and nothing here moves toward it.

## Package ownership amendment (#645)

The graph inspector remains `@zmdb/web/devtools`: `RouteNode`, route shadowing and controller route projections make this an HTTP-aware tool. It consumes `moduleDefOf`, `injectionsOf` and the module
types from public `@zmdb/app` entries, so the permitted dependency remains `web -> app`.

App retains no inspector state, and app does not import this entry. The production-root reachability barrier and on-demand reconstruction invariant remain unchanged.
