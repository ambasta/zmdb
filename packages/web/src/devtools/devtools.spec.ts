import { describe, expect, it } from 'vitest';

import { createApp } from '../app/index.js';
import { countMetadataReads } from '../bench/index.js';
import type { Scope } from '../di/index.js';
import {
  AmbiguousTokenAppModule,
  AppModule,
  BaseInjectController,
  CycleAppModule,
  DuplicateProviderAppModule,
  EagerDependsOnLazyAppModule,
  MangledModule,
  ShadowedRouteAppModule,
  SubclassedControllerAppModule,
  UnresolvedTokenAppModule,
  WideAppModule,
} from '../modules/__fixtures__/large-graph.js';
import { compileModule, type ModuleClass } from '../modules/index.js';
import type { HttpMethod } from '../routing/index.js';

// The graph description. Tests freeze for the epic "The module graph as a first-class object"
// (#598 / spec freeze #599); the frozen text is `./SPEC.md` §10.
//
// `./` contains this file, `devtools.type-test.ts` and `SPEC.md`, and no code at all: `describeGraph`,
// `dependentsOf`, `renderTree` and `renderDot` do not exist, `packages/web/package.json` has no
// `./devtools` subpath, and `../modules/index.ts` and `../di/index.ts` export neither of the two
// readers §4 says the description is built from. So this file is the whole of §10 written against
// nothing, which forces two decisions that are worth stating rather than discovering later.
//
// **One boundary, and it checks the export before calling it.** Every behavioural assertion goes
// through `devtools()` below, which imports the module at run time and, once that succeeds, reports
// which of the four named exports are missing. Without the second half, the day the module exists
// but `renderDot` is spelled `toDot` these tests would fail with `fn is not a function` — a message
// that says nothing about which of the two things went wrong. This is the concession to the
// convention that a red test's failure be diagnostic: it cannot be diagnostic about behaviour that
// has no implementation, so it is made diagnostic about *why*.
//
// **Two assertions are diagnostic against real code rather than the missing module.** §10.6 reads
// `../di/index.ts`'s metadata slot and is a passing regression for the ownership fix already in the
// tree; the `pushRoute` half of §4 is represented in the fixture consumed by the golden graph. And
// §10.7's asymmetry claim is half-asserted by a green test over the real `compileModule`. Everything
// else records a missing module and cannot do better.
//
// Every recorded actual came from running the code, in `packages/web/src/probe600/p5.spec.ts` — a
// throwaway spec that collected each value into a string and compared it to a sentinel so the
// assertion diff printed them all.

// ---------------------------------------------------------------------------
// The frozen surface, declared locally
// ---------------------------------------------------------------------------
//
// §2 verbatim, with `Scope` and `HttpMethod` imported from the modules that own them rather than
// restated — so a change to either breaks this file, which is the point of not redeclaring a whole
// shape. `FindingKind` is §5's table.

interface ModuleNode {
  readonly id: string;
  readonly name: string;
  readonly lazy: boolean;
  readonly imports: readonly string[];
}

type ProviderNode =
  | { readonly kind: 'value'; readonly id: string; readonly token: string; readonly module: string }
  | {
      readonly kind: 'factory';
      readonly id: string;
      readonly token: string;
      readonly module: string;
      readonly scope: Scope;
      readonly dependencies: readonly string[] | null;
    };

interface RouteNode {
  readonly method: HttpMethod;
  readonly path: string;
  readonly handler: string;
}

interface ClassNode {
  readonly id: string;
  readonly name: string;
  readonly module: string;
  readonly routes: readonly RouteNode[];
  readonly dependencies: readonly string[];
}

type FindingKind =
  | 'cycle'
  | 'unresolved-token'
  | 'eager-depends-on-lazy'
  | 'duplicate-provider'
  | 'shadowed-route'
  | 'duplicate-token-description'
  | 'anonymous-class';

interface Finding {
  readonly kind: FindingKind;
  readonly severity: 'error' | 'warning';
  readonly message: string;
  readonly subject: string;
  readonly path?: readonly string[];
}

interface GraphDescription {
  readonly modules: readonly ModuleNode[];
  readonly providers: readonly ProviderNode[];
  readonly controllers: readonly ClassNode[];
  readonly findings: readonly Finding[];
}

interface GraphFilter {
  readonly module?: string;
  readonly token?: string;
  readonly depth?: number;
  readonly providers?: boolean;
}

/** §2's four exports, as the module `./index.ts` has to be. */
interface DevtoolsModule {
  describeGraph(rootModule: ModuleClass): GraphDescription;
  dependentsOf(graph: GraphDescription, id: string): readonly string[];
  renderTree(graph: GraphDescription, filter?: GraphFilter): string;
  renderDot(graph: GraphDescription, filter?: GraphFilter): string;
}

const REQUIRED_EXPORTS: readonly string[] = ['describeGraph', 'dependentsOf', 'renderTree', 'renderDot'];

/**
 * The single boundary: a loaded module record is `DevtoolsModule` if it has the four names.
 *
 * A user-defined type predicate rather than an `as`, which matters here beyond taste — §10.2 asks
 * for "no `as` anywhere in the fixture or the tests", and a predicate is how a value of unknown
 * provenance is narrowed without one. It is exactly as unsound as an assertion would be, and that
 * is what a boundary is; what it buys is that the unsoundness is named, is one function, and checks
 * something (four `in` tests) rather than nothing.
 */
function isDevtoolsModule(loaded: object): loaded is DevtoolsModule {
  return REQUIRED_EXPORTS.every(name => name in loaded);
}

function missingExports(loaded: object): readonly string[] {
  return REQUIRED_EXPORTS.filter(name => !(name in loaded));
}

let loadOutcome: DevtoolsModule | string | undefined;

/**
 * `./index.js`, or a sentence saying why not.
 *
 * The specifier is assembled at run time and this is not incidental. A static
 * `await import('@zmdb/web/devtools')` is resolved by Vite at transform time, and a subpath that is
 * not in the `exports` map makes the *whole spec file* fail to load — `packages/web/src/devtools/
 * devtools.spec.ts (0 test)`, a failed suite rather than a red test, which no `it.fails` can
 * absorb. Joining the segments defeats the static analysis, so the failure arrives at run time
 * where it can be caught. Verified both ways.
 */
async function devtools(): Promise<DevtoolsModule | string> {
  if (loadOutcome !== undefined) {
    return loadOutcome;
  }
  const specifier = ['..', 'devtools', 'index.js'].join('/');
  let loaded: unknown;
  try {
    loaded = await import(specifier);
  } catch (error) {
    loadOutcome = `devtools did not load: ${error instanceof Error ? error.message : String(error)}`;
    return loadOutcome;
  }
  if (typeof loaded !== 'object' || loaded === null) {
    loadOutcome = `devtools loaded as ${typeof loaded}, not a module record`;
    return loadOutcome;
  }
  loadOutcome = isDevtoolsModule(loaded)
    ? loaded
    : `devtools loaded but exports no ${missingExports(loaded).join(', ')}`;
  return loadOutcome;
}

/** A description of `root`, or the sentence explaining why there is none. */
async function describeGraph(root: ModuleClass): Promise<GraphDescription | string> {
  const module = await devtools();
  if (typeof module === 'string') {
    return module;
  }
  // No `try` here: §5 freezes `describeGraph` as never throwing, so a throw *is* a claim being
  // violated and swallowing it into a string would turn the strongest signal this file can get
  // into a mismatched sentence.
  return module.describeGraph(root);
}

/** `renderDot`'s output, or the sentence explaining why there is none, or the refusal it raised. */
async function renderDot(graph: GraphDescription | string, filter?: GraphFilter): Promise<string> {
  const module = await devtools();
  if (typeof module === 'string') {
    return module;
  }
  if (typeof graph === 'string') {
    return graph;
  }
  // §8 freezes a *refusal* for an unfiltered provider graph above fifty nodes, so unlike
  // `describeGraph` a throw here is expected behaviour and has to be comparable as a value.
  try {
    return filter === undefined ? module.renderDot(graph) : module.renderDot(graph, filter);
  } catch (error) {
    return `refused: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function dependentsOf(graph: GraphDescription | string, id: string): Promise<readonly string[] | string> {
  const module = await devtools();
  if (typeof module === 'string') {
    return module;
  }
  if (typeof graph === 'string') {
    return graph;
  }
  return module.dependentsOf(graph, id);
}

/**
 * A description with every node list sorted by `id`, for comparison against a golden value.
 *
 * §2 freezes the shapes and §7 freezes the *route* order inside a controller, but nothing in the
 * file freezes the order of `modules`, `providers` or `controllers` — so a golden that compares
 * them positionally would freeze, by accident, whichever walk order the first implementation
 * happened to have. Sorting is the honest reading; route order is asserted unsorted in its own test.
 */
function sortById(graph: GraphDescription | string): GraphDescription | string {
  if (typeof graph === 'string') {
    return graph;
  }
  const byId = (left: { readonly id: string }, right: { readonly id: string }): number =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  return {
    modules: graph.modules.toSorted(byId),
    providers: graph.providers.toSorted(byId),
    controllers: graph.controllers.toSorted(byId),
    findings: graph.findings,
  };
}

/** `kind/severity` for each finding, sorted, which is what §10.7 compares. */
function findingKinds(graph: GraphDescription | string): readonly string[] | string {
  if (typeof graph === 'string') {
    return graph;
  }
  return graph.findings.map(finding => `${finding.kind}/${finding.severity}`).toSorted();
}

/**
 * The `INJECTIONS` slot as `field=token` strings, read straight off the class metadata.
 *
 * This is the one reader in this file that does not go through `./index.js`, because §10.6's claim
 * is about `../di/index.ts:78` and not about a module that does not exist. The slot is found by
 * symbol *description* rather than by importing the symbol, which `../di/index.ts` does not export;
 * the property is then read with an ordinary get, which follows the prototype chain — exactly what
 * `injectionsOf` reading `metadata[INJECTIONS]` would do, so this measures the bug rather than an
 * artefact of how the test looks.
 */
function injectionFieldsOf(ctor: ModuleClass): readonly string[] | string {
  const metadata: unknown = Reflect.get(ctor, Symbol.metadata);
  if (typeof metadata !== 'object' || metadata === null) {
    return `no Symbol.metadata on ${ctor.name}`;
  }
  let slot: symbol | undefined;
  for (let current: object | null = metadata; current !== null; current = Object.getPrototypeOf(current)) {
    slot = Object.getOwnPropertySymbols(current).find(symbol => symbol.description === 'zmdb.web.di.injections');
    if (slot !== undefined) {
      break;
    }
  }
  if (slot === undefined) {
    return `no injections slot reachable from ${ctor.name}`;
  }
  const entries: unknown = Reflect.get(metadata, slot);
  if (!Array.isArray(entries)) {
    return `injections slot on ${ctor.name} holds ${typeof entries}`;
  }
  return entries.map((entry: unknown) => {
    const record: { field?: unknown; token?: unknown } = Object(entry);
    const token: { description?: unknown } = Object(record.token);
    return `${String(record.field)}=${String(token.description)}`;
  });
}

// ---------------------------------------------------------------------------
// The golden description
// ---------------------------------------------------------------------------
//
// §4's provenance table, row by row, over `AppModule`. Four fields in here are a *reading* of §2
// rather than a quotation of it, and they are listed in `NOTES.md` as decisions the implementation
// slice has to confirm or the spec has to settle: `providers[].module` and `controllers[].module`
// as `module:X` ids rather than bare names (§2 says "one flat id space serves every edge", and
// these are edges); `ModuleNode.imports` likewise; and `findings: []` for a graph whose only
// oddity is a route pattern that shadows another at match time but not by string equality, which
// §5's `shadowed-route` row defines as "the same method and path".
//
// `AdminModule` is present with `lazy: true` and its providers and controller described, because
// §3 says a description describes the program and not a process, and §L3 says startup walks lazy
// subtrees for declarations. A description that omitted them would be a description of what has
// loaded, which is the conflation §3 refuses.

const goldenAppGraph: GraphDescription = {
  modules: [
    { id: 'module:AdminModule', name: 'AdminModule', lazy: true, imports: [] },
    {
      id: 'module:AppModule',
      name: 'AppModule',
      lazy: false,
      imports: ['module:UsersModule', 'module:BillingModule', 'module:SearchModule', 'module:AdminModule'],
    },
    { id: 'module:BillingModule', name: 'BillingModule', lazy: false, imports: ['module:DataModule'] },
    { id: 'module:CoreModule', name: 'CoreModule', lazy: false, imports: [] },
    { id: 'module:DataModule', name: 'DataModule', lazy: false, imports: ['module:CoreModule'] },
    { id: 'module:SearchModule', name: 'SearchModule', lazy: false, imports: ['module:CoreModule'] },
    { id: 'module:UsersModule', name: 'UsersModule', lazy: false, imports: ['module:DataModule'] },
  ],
  providers: [
    {
      kind: 'factory',
      id: 'provider:ADMIN_POOL',
      token: 'ADMIN_POOL',
      module: 'module:AdminModule',
      scope: 'singleton',
      dependencies: null,
    },
    {
      kind: 'factory',
      id: 'provider:CLOCK',
      token: 'CLOCK',
      module: 'module:CoreModule',
      scope: 'singleton',
      dependencies: null,
    },
    // No `scope` key at all, not `scope: undefined`: §2 says a bound value is not resolved once, it
    // is bound, and reporting `'singleton'` would answer the epic's own "why is this a singleton?"
    // with a word that does not apply. `toEqual` treats a missing key and an `undefined` one as
    // equal, so §10.1's "carrying no `scope`" is asserted separately below with `toStrictEqual`.
    { kind: 'value', id: 'provider:CONFIG', token: 'CONFIG', module: 'module:CoreModule' },
    {
      kind: 'factory',
      id: 'provider:INVOICES',
      token: 'INVOICES',
      module: 'module:BillingModule',
      scope: 'singleton',
      dependencies: null,
    },
    {
      kind: 'factory',
      id: 'provider:POOL',
      token: 'POOL',
      module: 'module:DataModule',
      scope: 'singleton',
      dependencies: null,
    },
    {
      kind: 'factory',
      id: 'provider:REQUEST_ID',
      token: 'REQUEST_ID',
      module: 'module:CoreModule',
      scope: 'transient',
      dependencies: null,
    },
    {
      kind: 'factory',
      id: 'provider:SEARCH_INDEX',
      token: 'SEARCH_INDEX',
      module: 'module:SearchModule',
      scope: 'transient',
      dependencies: null,
    },
    {
      kind: 'factory',
      id: 'provider:USERS_REPOSITORY',
      token: 'USERS_REPOSITORY',
      module: 'module:DataModule',
      scope: 'singleton',
      dependencies: null,
    },
    { kind: 'value', id: 'provider:user cache #1', token: 'user cache #1', module: 'module:CoreModule' },
  ],
  controllers: [
    {
      id: 'controller:AdminModule.AdminController',
      name: 'AdminController',
      module: 'module:AdminModule',
      routes: [
        { method: 'GET', path: '/admin', handler: 'list' },
        { method: 'DELETE', path: '/admin/:id', handler: 'remove' },
      ],
      dependencies: ['provider:ADMIN_POOL'],
    },
    {
      id: 'controller:AppModule.HealthController',
      name: 'HealthController',
      module: 'module:AppModule',
      routes: [{ method: 'GET', path: '/health', handler: 'check' }],
      dependencies: ['provider:CLOCK'],
    },
    {
      id: 'controller:BillingModule.BillingController',
      name: 'BillingController',
      module: 'module:BillingModule',
      routes: [{ method: 'GET', path: '/invoices/:id', handler: 'byId' }],
      dependencies: ['provider:USERS_REPOSITORY', 'provider:INVOICES'],
    },
    {
      id: 'controller:SearchModule.SearchController',
      name: 'SearchController',
      module: 'module:SearchModule',
      routes: [{ method: 'GET', path: '/search', handler: 'query' }],
      dependencies: ['provider:SEARCH_INDEX'],
    },
    {
      id: 'controller:UsersModule.UsersController',
      name: 'UsersController',
      module: 'module:UsersModule',
      routes: [
        { method: 'GET', path: '/users/:id', handler: 'byId' },
        { method: 'GET', path: '/users/me', handler: 'me' },
        { method: 'POST', path: '/users', handler: 'create' },
      ],
      dependencies: ['provider:USERS_REPOSITORY', 'provider:CONFIG'],
    },
  ],
  findings: [],
};

describe('describeGraph (frozen: devtools/SPEC.md 10)', () => {
  // §10.1. One golden over the whole description, because a graph description is trivially correct
  // for three providers and interesting for thirty: every row of §4's provenance table is exercised
  // once here, including the two that are only interesting in combination — a `value` provider with
  // no `scope` key next to a `factory` one with `scope` and `dependencies: null`.
  //
  // actual today, and for every assertion in this file that goes through the boundary:
  //   devtools did not load: Cannot find module '/packages/web/src/devtools/index.js' imported from
  //   <abs>/packages/web/src/devtools/devtools.spec.ts
  // The `imported from` tail is an absolute path, so it is not asserted. This is a weaker recorded
  // actual than the convention asks for and there is no stronger one available: the directory holds
  // `SPEC.md` and these two test files.
  it.fails('describes the large fixture graph', async () => {
    expect(sortById(await describeGraph(AppModule))).toEqual(goldenAppGraph);
  });

  // §10.1's `kind: 'value'` clause, which the golden above cannot carry on its own: `toEqual`
  // treats `{ kind: 'value' }` and `{ kind: 'value', scope: undefined }` as equal, so an
  // implementation that spread `scope` in unconditionally would pass the golden and fail here.
  // `toStrictEqual` is the assertion that distinguishes an absent key from an `undefined` one.
  //
  // actual today: `devtools did not load: Cannot find module ...`, so the filter finds nothing and
  // `undefined` is compared against the value node.
  it.fails('gives a value provider no scope key at all', async () => {
    const graph = await describeGraph(AppModule);
    const config = typeof graph === 'string' ? graph : graph.providers.find(node => node.id === 'provider:CONFIG');
    expect(config).toStrictEqual({
      kind: 'value',
      id: 'provider:CONFIG',
      token: 'CONFIG',
      module: 'module:CoreModule',
    });
  });

  // §10.3. `null` rather than `undefined`, and the reason is one property of `JSON.stringify`:
  // a property whose value is `undefined` is dropped, so the marker would vanish from exactly the
  // output format a script reads and `?? []` away from "nothing depends on POOL" — which §2 calls
  // the single most likely way this tool causes an outage rather than preventing one. Asserted on
  // the serialised bytes, because that is where the difference lives.
  //
  // actual today: the description is the load-failure sentence, whose JSON contains no
  // `"dependencies"` at all.
  it.fails('serialises an opaque factory dependency list as null', async () => {
    const graph = await describeGraph(AppModule);
    expect(JSON.stringify(graph)).toContain('"dependencies":null');
  });

  // §10.4, which replaces #600's `does not retain graph metadata when the description was never
  // requested` — a claim §3 shows cannot be measured as written, because the metadata belongs to
  // the class in both arms of the experiment. The measurable claim is that nothing reads it until
  // asked, and `countMetadataReads` (`../bench/index.ts:20`) measures exactly that.
  //
  // The counter is installed **after** `createApp` returns, and that placement is the assertion:
  // installed before, it reports 1, because `compileModule`'s `readModuleDef` reads
  // `AppModule[Symbol.metadata]` once during the startup walk. §10.4's wording — "between
  // `createApp` and the first `describeGraph` call ... reports zero reads" — is only true of the
  // interval, not of the bootstrap, and this is the reading that makes it a true statement. Both
  // placements were probed.
  //
  // actual today: zero reads in the interval, which is the first half passing for the right reason,
  // and zero after the call as well, because there is no call — the load fails before any metadata
  // is touched. So the second `expect` is what fails.
  it.fails('reads no module metadata until a description is asked for, and some after', async () => {
    const app = createApp(AppModule);
    await app.init();
    const counter = countMetadataReads(AppModule);
    const quiet = counter.count();
    await describeGraph(AppModule);
    const afterDescribe = counter.count();
    counter.restore();
    expect(quiet, 'between createApp returning and the first describeGraph call').toBe(0);
    expect(afterDescribe, 'after one describeGraph call').toBeGreaterThan(0);
  });

  // §10.5, and §8's reverse-edge query. `USERS_REPOSITORY` is injected by two controllers, so both
  // come back; `POOL`'s only consumer is `USERS_REPOSITORY`'s factory *body*, which is opaque, so
  // `dependentsOf` must not answer "nothing" — §2 calls reading "nothing depends on POOL" off a
  // graph that cannot see factory edges the way a provider gets deleted. §8 freezes the shape of
  // the honest answer: the unknown-edge node is reported explicitly rather than omitted.
  //
  // §2 and §8 do not say what `dependentsOf` returns for that case beyond "reported explicitly" —
  // the tree spelling `provider:POOL (edges unknown)` is given for `renderTree`, not for this
  // function's `readonly string[]`. This asserts the id plus the marker suffix, which is the only
  // reading that makes the two sentences consistent, and `NOTES.md` records that it is a reading.
  //
  // actual today: `devtools did not load: Cannot find module ...` for both calls.
  it.fails('reports both consumers of a shared token and marks an unknowable factory edge', async () => {
    const graph = await describeGraph(AppModule);
    expect(await dependentsOf(graph, 'provider:USERS_REPOSITORY')).toEqual([
      'controller:UsersModule.UsersController',
      'controller:BillingModule.BillingController',
    ]);
    expect(await dependentsOf(graph, 'provider:POOL')).toEqual(['provider:USERS_REPOSITORY (edges unknown)']);
  });

  // §10.6, asserted against real metadata rather than the missing devtools module.
  //
  // A stage-3 subclass metadata object inherits the base record. The writer therefore has to make
  // an own copy before appending a subclass injection; otherwise the base owns the subclass field.
  // That defect was fixed before this freeze landed, and this passing test keeps the graph reader
  // from reintroducing it when it becomes the first public consumer of the slot.
  //
  // measured today:
  //   base -> ["config=CONFIG"]
  //   unrelated module -> no injections slot
  it('attributes an injected field to the class that declares it', () => {
    expect(injectionFieldsOf(BaseInjectController), 'the base class').toEqual(['config=CONFIG']);
    expect(injectionFieldsOf(SubclassedControllerAppModule), 'a module has no injections').toBe(
      'no injections slot reachable from SubclassedControllerAppModule',
    );
  });

  // §10.7's finding table, one row at a time, each on the variant that provokes it. `kind` and
  // `severity` together, because §5 makes severity the CLI's exit code (`error` exits 1, a lone
  // `warning` exits 0) — so a finding with the right kind and the wrong severity turns
  // `zmdb modules` in CI into either a no-op or a failure on a cosmetic token description.
  //
  // actual today: every one of these is the load-failure sentence.
  it.fails('reports each finding kind on a fixture that provokes it', async () => {
    expect(findingKinds(await describeGraph(CycleAppModule)), 'cycle').toEqual(['cycle/error']);
    expect(findingKinds(await describeGraph(UnresolvedTokenAppModule)), 'unresolved token').toEqual([
      'unresolved-token/error',
    ]);
    expect(findingKinds(await describeGraph(EagerDependsOnLazyAppModule)), 'eager depends on lazy').toEqual([
      'eager-depends-on-lazy/error',
    ]);
    expect(findingKinds(await describeGraph(DuplicateProviderAppModule)), 'duplicate provider').toEqual([
      'duplicate-provider/error',
    ]);
    expect(findingKinds(await describeGraph(ShadowedRouteAppModule)), 'shadowed route').toEqual([
      'shadowed-route/error',
    ]);
    expect(findingKinds(await describeGraph(AmbiguousTokenAppModule)), 'duplicate description').toEqual([
      'duplicate-token-description/warning',
      'duplicate-token-description/warning',
    ]);
    expect(findingKinds(await describeGraph(MangledModule)), 'anonymous class').toEqual(['anonymous-class/warning']);
  });

  // §10.7's asymmetry: `describeGraph` **returns** a complete description plus one finding for a
  // graph with a cycle, where `compileModule` throws. §5's argument is that the inspector is the
  // tool you reach for *because* the application will not boot, so a diagnostic that fails on the
  // input it exists to explain is useless.
  //
  // actual today: the load-failure sentence, so `modules` cannot be counted. The `compileModule`
  // half of the asymmetry is pinned green below.
  it.fails('describes a cyclic graph completely rather than throwing', async () => {
    const graph = await describeGraph(CycleAppModule);
    expect(typeof graph, 'a description, not a sentence about why there is none').toBe('object');
    if (typeof graph !== 'string') {
      expect(graph.modules.map(node => node.id).toSorted()).toEqual([
        'module:CycleAppModule',
        'module:CycleBillingModule',
        'module:CycleUsersModule',
      ]);
      expect(graph.findings).toHaveLength(1);
    }
  });

  // §10.8. The `path` on the `cycle` finding, first element repeated last, so the closing edge is
  // visible rather than inferred. §6 shows this needs no new bookkeeping: `inProgress` is a `Set`
  // and `Set` iteration is insertion-ordered, so at the moment `inProgress.has(moduleClass)` is
  // true the path is that set from the repeated module onward plus the repeated module again.
  //
  // The message half of §10.8 — the frozen `A -> B -> C -> A` sentence out of `compileModule` — is
  // asserted in `../modules/lazy.spec.ts` ('names the cycle path in the import cycle message'),
  // where it fails on a comparison of two real strings. It is not duplicated here.
  //
  // actual today: the load-failure sentence, so there is no finding to read `path` off.
  it.fails('carries the cycle path on the finding, first element repeated last', async () => {
    const graph = await describeGraph(CycleAppModule);
    const finding = typeof graph === 'string' ? undefined : graph.findings[0];
    expect(finding?.kind).toBe('cycle');
    expect(finding?.path).toEqual([
      'module:CycleAppModule',
      'module:CycleBillingModule',
      'module:CycleUsersModule',
      'module:CycleAppModule',
    ]);
  });

  // §10.9. DOT rather than Mermaid because the labels here are route paths, token descriptions and
  // class names, which contain `/`, `:`, `#`, `-` and spaces — and DOT has one quoting rule
  // (`"…"` with `\"`) that covers every byte, where Mermaid's node-id grammar rejects or mangles
  // several and the escaping differs between node shapes. Asserted by the quoting rule rather than
  // by spawning graphviz, which is what §10.9 asks for: the fixture's `user cache #1` token has a
  // space and a `#`, and `/users/:id` has slashes and a colon.
  //
  // actual today: the load-failure sentence, which contains neither quoted form.
  it.fails('quotes every DOT label so a path and a token description survive', async () => {
    const dot = await renderDot(await describeGraph(AppModule), { providers: true });
    expect(dot, 'a token description with a space and a hash').toContain('"provider:user cache #1"');
    expect(dot, 'a route path with slashes and a colon').toContain('/users/:id');
    for (const line of dot.split('\n')) {
      const identifiers = line.match(/(?:^|\s|->\s*)([A-Za-z_][\w:]*)/g) ?? [];
      expect(
        identifiers.filter(text => text.includes(':')),
        `unquoted id in ${line}`,
      ).toEqual([]);
    }
  });

  // §10.10, and §8's argument that the filtering is the feature rather than an option on it: a
  // diagram of 200 providers is unreadable, and an unreadable diagram is indistinguishable from a
  // broken one. Above fifty provider nodes with no `module` and no `token`, the answer is a refusal
  // that names the count and lists the modules to filter by — the same judgement `../static/SPEC.md`
  // §5 makes about directory listings. `WideAppModule` has sixty-nine provider nodes: sixty from
  // `WideModule` plus `UsersModule`'s transitive nine.
  //
  // actual today: `renderDot` returns the load-failure sentence for all three calls, so the refusal
  // assertion fails on the message and the two positive ones on their content.
  it.fails('refuses an unfiltered provider diagram above fifty nodes and emits a filtered one', async () => {
    const graph = await describeGraph(WideAppModule);
    const refused = await renderDot(graph, { providers: true });
    expect(refused, 'names the count').toMatch(/refused: .*69/);
    expect(refused, 'lists a module to filter by').toContain('WideModule');

    const filtered = await renderDot(graph, { providers: true, module: 'UsersModule' });
    expect(filtered, 'a filtered diagram is emitted').toContain('digraph');
    expect(filtered, 'and does not reach WideModule').not.toContain('bulk.0');

    const shallow = await renderDot(graph, { providers: true, module: 'UsersModule', depth: 1 });
    expect(shallow.split('\n').length, 'depth 1 is smaller than the default depth 2').toBeLessThan(
      filtered.split('\n').length,
    );
  });

  // ---------------------------------------------------------------------------
  // Green: the halves of §10 that hold today
  // ---------------------------------------------------------------------------

  // §10.7's other half. `compileModule` throws on a cycle, and it has to keep throwing: §5 frames
  // the asymmetry as deliberate, and the obvious wrong way to make `describeGraph` return findings
  // for a cyclic graph is to move the cycle detection out of the walk and have both callers read a
  // finding list — at which point an application with a cycle boots and fails later. Green today,
  // and the implementation slice is exactly the change that can break it.
  it('still refuses to compile a cyclic graph that a description would describe', () => {
    expect(() => compileModule(CycleAppModule)).toThrow(/import cycle/);
  });

  // §2's `describeGraph(rootModule: ModuleClass)`, from the runtime side: the inspector runs on a
  // graph that does not boot, which is the second effect §2 says is worth more than the first.
  // `EagerDependsOnLazyAppModule` is a root `createApp` refuses; a description of it is the whole
  // point of the tool. Green in the sense that matters — the fixture really is unbootable — and it
  // pins the fixture rather than the feature, so that the day `describeGraph` lands over it the
  // red test above is testing what it claims to.
  it('has a fixture root that createApp refuses, which is what a description is for', () => {
    expect(() => createApp(EagerDependsOnLazyAppModule)).toThrow(/ADMIN_POOL/);
  });
});
