// The graph description, as types. Tests freeze for the epic "The module graph as a first-class
// object" (#598 / spec freeze #599); the frozen text is `./SPEC.md` §2 and §10.2.
//
// The type-level half of `devtools.spec.ts`. `node scripts/typecheck.mjs` compiles this file, so a
// signature or shape regression is a build failure.
//
// §10.2 asks for three things, and only one of them can be written as an assertion in the shape it
// is stated. That is worth setting out before the file, because the shape of the file is entirely
// determined by it.
//
// **"`describeGraph(app)` is rejected where `app: App`"** is carried positively as the two facts
// that make the rejection follow: `App` is not assignable to `ModuleClass`, and
// `describeGraph`'s first parameter is exactly `ModuleClass`.
//
// **"reading `scope` off a `ProviderNode` without narrowing `kind` is rejected" likewise.** It is
// carried as `keyof ProviderNode` — `keyof` over a union is the intersection of the members' keys,
// so `'scope' extends keyof ProviderNode` is `false` exactly when the value arm omits `scope`, which
// is the same fact stated as a type rather than as a compiler complaint. The narrowing that *is*
// legal is written out as a function the compiler has to accept, over the locally held union so
// that it means something today.
//
// **"No `as` anywhere in the fixture or the tests" is honoured literally here.** There is none in
// this file. `devtools.spec.ts` reaches the same end with a user-defined type predicate rather than
// an assertion, and `../modules/__fixtures__/large-graph.ts` needs exactly one, named in its own
// comment, to hand `@Module` a definition whose `imports` today's `ModuleDef` does not admit.
import type { Equal, Expect, Extends } from '@zmdb/schema-core';

import type { App } from '../app/index.js';
import type { Scope } from '../di/index.js';
import type { AppModule } from '../modules/__fixtures__/large-graph.js';
import type { ModuleClass } from '../modules/index.js';
import type { HttpMethod } from '../routing/index.js';
import type {
  GraphDescription,
  GraphFilter,
  ProviderNode,
  dependentsOf,
  describeGraph,
  renderDot,
  renderTree,
} from './index.js';

// ---------------------------------------------------------------------------
// The reason `describeGraph(app: App)` is rejected
// ---------------------------------------------------------------------------

// Green, and the most valuable line in the file: it holds today, against the real `App`, and it is
// the whole of §2's first correction as a type. `App` is
// `{ container, handle, fetch, init, [Symbol.asyncDispose] }` — an object type with no construct
// signature — so it is not assignable to `ModuleClass` and never will be without someone adding
// one. If a later slice makes this go red, `describeGraph(app)` has become writable and §2's
// argument has been abandoned, which is exactly the change this line exists to catch.
export type _AppIsNotAModuleClass = Expect<Equal<Extends<App, ModuleClass>, false>>;

// The other half: a module class is accepted. Green today, over the fixture's real root — an
// `@Module`-decorated class with a zero-argument constructor, which is what every caller passes.
// `ModuleClass` is `abstract new (...args: never[]) => unknown`, and `never[]` is what makes a
// concrete zero-argument constructor assignable to it rather than the other way round.
export type _ModuleClassIsAccepted = Expect<Extends<typeof AppModule, ModuleClass>>;

// The signature itself: one parameter, named, and a `GraphDescription` returned synchronously —
// `describeGraph` is not `async`, because §3 freezes the description as derived on demand from
// metadata that is already in memory, and an `await` here would invite an implementation that reads
// a file or boots something. Vacuous today for the reason given at the import; live the moment the
// module exists.
export type _DescribeGraphParams = Expect<Equal<Parameters<typeof describeGraph>, [rootModule: ModuleClass]>>;

export type _DescribeGraphReturns = Expect<Equal<ReturnType<typeof describeGraph>, GraphDescription>>;

// ---------------------------------------------------------------------------
// The frozen `ProviderNode`, held locally
// ---------------------------------------------------------------------------
//
// Held locally as well as imported, so that the key-set and narrowing claims below are made against
// a union that exists rather than against the error type the import resolves to today. The two kinds
// of assertion therefore test different things: the directive on the import tests that the *module*
// is there, and everything from here down tests the *shape* §2 requires of it. `Scope` and
// `HttpMethod` are imported from the modules that own them rather than restated, so a change to
// either breaks this file — which is the point of not redeclaring a whole surface.

type FrozenValueProvider = {
  readonly kind: 'value';
  readonly id: string;
  readonly token: string;
  readonly module: string;
};

type FrozenFactoryProvider = {
  readonly kind: 'factory';
  readonly id: string;
  readonly token: string;
  readonly module: string;
  readonly scope: Scope;
  readonly dependencies: readonly string[] | null;
};

/** §2 verbatim: two arms, discriminated by `kind`, and the value arm has no `scope` at all. */
type FrozenProviderNode = FrozenValueProvider | FrozenFactoryProvider;

export type _ProviderNodeShape = Expect<Equal<ProviderNode, FrozenProviderNode>>;

// ---------------------------------------------------------------------------
// §10.2's second claim, carried positively
// ---------------------------------------------------------------------------

// `keyof` over a union is the intersection of its members' keys, so this is "`scope` is not readable
// without narrowing `kind`" stated as a type. It holds today over the local union, and it is the
// assertion that goes red if anyone flattens the two arms into one interface with `scope?: Scope` —
// the shape §2 rejects, because an optional `scope` on a value provider reads as "the default" when
// the truth is that the concept does not apply.
export type _ScopeNeedsNarrowing = Expect<Equal<Extends<'scope', keyof FrozenProviderNode>, false>>;

// The keys that *are* readable off an un-narrowed node, spelled out. Green today. Stated as the
// whole key set rather than as four `Extends` assertions because the claim is that there are no
// others: a fifth common field added later (a `lazy` flag, a source location) breaks this line and
// has to be argued for rather than appearing.
export type _CommonKeys = Expect<Equal<keyof FrozenProviderNode, 'kind' | 'id' | 'token' | 'module'>>;

// The value arm, positively: no `scope`, and nothing else either.
export type _ValueArmKeys = Expect<Equal<keyof FrozenValueProvider, 'kind' | 'id' | 'token' | 'module'>>;

// The factory arm's `scope` is `Scope` itself and not a copy of its members, so adding a third
// scope to `../di/index.ts` does not silently leave the description behind.
export type _FactoryScope = Expect<Equal<FrozenFactoryProvider['scope'], Scope>>;

// §2's third correction and §10.3's assertion, as a type: `null`, never absent, never `undefined`.
// `Equal` is the right tool rather than `Extends` because it is precisely the collapse of
// `| null` into `| undefined` — the one that `JSON.stringify` erases — that this has to reject, and
// `exactOptionalPropertyTypes` is on, so an optional declaration would produce a different answer
// here rather than the same one.
export type _DependenciesMarker = Expect<Equal<FrozenFactoryProvider['dependencies'], readonly string[] | null>>;

/**
 * The narrowing §10.2 says is legal, written as code the compiler has to accept.
 *
 * A comparison of types cannot express "this read compiles" — it is a claim about control-flow
 * analysis — so it is written as the function a renderer has to contain, and the assertion is that
 * this file compiles. The `scope` read is inside the `kind === 'factory'` arm and assigns to an
 * explicitly annotated local, which is what makes the narrowing load-bearing: widen the arm and the
 * assignment is an error. There is no `as` in here, which is the point of §10.2's last sentence.
 */
export function scopeOf(node: FrozenProviderNode): Scope | 'n/a' {
  if (node.kind === 'factory') {
    const scope: Scope = node.scope;
    return scope;
  }
  return 'n/a';
}

/**
 * The `null` marker read the same way: `null` and `[]` are distinguishable, and the compiler makes
 * you distinguish them. `?? []` is the one line §2 says causes the outage, so the honest read is a
 * `=== null` test that produces a different *kind* of answer, not a defaulted array.
 */
export function edgesOf(node: FrozenProviderNode): readonly string[] | 'unknown' {
  if (node.kind === 'value') {
    return [];
  }
  return node.dependencies === null ? 'unknown' : node.dependencies;
}

// ---------------------------------------------------------------------------
// The rest of §2's surface
// ---------------------------------------------------------------------------
//
// One assertion per export, each red on its own directive, so the file reports which of the four
// functions is missing or misshapen rather than that "devtools does not typecheck". The answers are
// held in local aliases where the whole assertion would otherwise reflow past `printWidth: 120`:
// `oxfmt` splits a longer `Expect<...>` across three lines, which moves the error off the line the
// directive sits above and reports TS2578 and TS2344 at once.

type FrozenDependentsOf = (graph: GraphDescription, id: string) => readonly string[];

// `readonly string[]`, not `readonly ProviderNode[]` and not a `Map`: §8 freezes reverse edges as
// derivable rather than materialised, so what comes back is known ids plus the explicit opaque-
// factory sentinel. Returning nodes would be a second copy of the truth.
export type _DependentsOfSignature = Expect<Equal<typeof dependentsOf, FrozenDependentsOf>>;

type FrozenRenderer = (graph: GraphDescription, filter?: GraphFilter) => string;

// Both renderers take the description and an optional filter, and both return a string — not a
// stream, not a `Buffer`, and not a value that has to be awaited. §7's argument is that the output
// is a document a human pipes somewhere, and `string` is what makes `renderDot(...)` composable
// with `renderTree(...)` in one CLI switch. One identical answer type for both, so a slice that
// gives the two renderers different filter parameters breaks here rather than in a CLI flag.
export type _RenderTreeSignature = Expect<Equal<typeof renderTree, FrozenRenderer>>;

export type _RenderDotSignature = Expect<Equal<typeof renderDot, FrozenRenderer>>;

// `filter` is optional — §8's default projection is what an absent filter selects, so
// `renderDot(graph)` has to be a legal call. Written as the parameter tuple rather than as
// `Parameters<...>[1]` because the optionality of the *parameter* and the optionality of its
// *fields* are two different claims, and the tuple is the only form that states the first. The
// tuple is held in an alias so the assertion fits `printWidth: 120` on one line.
type RendererParams = Parameters<typeof renderDot>;

// TypeScript 7 includes `undefined` explicitly in an optional parameter tuple
// under exact optional property types. Assert the two slots and the 1-or-2
// length directly instead of relying on tuple identity.
export type _FilterIsOptional = Expect<Equal<RendererParams['length'], 1 | 2>>;

export type _RendererGraphParameter = Expect<Equal<RendererParams[0], GraphDescription>>;

export type _RendererFilterParameter = Expect<Equal<RendererParams[1], GraphFilter | undefined>>;

// The frozen `GraphFilter`, held locally, so the second claim can be made today: four fields, all
// optional, and no fifth. §8's table is the whole of it — a `findings: boolean` or a `format` field
// added here would be a new projection with no frozen behaviour.
type FrozenGraphFilter = {
  readonly module?: string;
  readonly token?: string;
  readonly depth?: number;
  readonly providers?: boolean;
};

export type _GraphFilterShape = Expect<Equal<GraphFilter, FrozenGraphFilter>>;

// ---------------------------------------------------------------------------
// `ClassNode.routes`, which is where `HttpMethod` earns its import
// ---------------------------------------------------------------------------
//
// `routes[].method` is `HttpMethod` and not `string`. This matters more than it looks: `getRoutes`
// (`../routing/index.ts:106-121`) returns `{ method, path, handlerName }`, so a description that
// typed `method` as `string` would compile against that reader forever and silently accept a
// seventh verb that the router cannot dispatch. Held locally to pin the exact exported field names.
type FrozenRouteNode = { readonly method: HttpMethod; readonly path: string; readonly handler: string };

// `handler`, not `handlerName`. §2 renames the field on the way out of `getRoutes`, and this is the
// line that says so — green today, and the one place the rename is written down as a type.
export type _RouteNodeKeys = Expect<Equal<keyof FrozenRouteNode, 'method' | 'path' | 'handler'>>;

export type _RouteMethodIsHttpMethod = Expect<Equal<FrozenRouteNode['method'], HttpMethod>>;
