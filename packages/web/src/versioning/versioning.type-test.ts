// The versioning surface, as types. Tests freeze for the epic "OpenAPI security schemes and API
// versioning" (#572 / spec freeze #573); the frozen text is `./SPEC.md` §2, and the list this file
// answers is its §8 item 1.
//
// `node scripts/typecheck.mjs` compiles this file, so a frozen claim written plainly is a build
// failure rather than a red test; `@ts-expect-error` over the claim is the `it.fails` of
// `./negotiation.spec.ts`. This file carries most of what #574 can say about versioning at all,
// because `./index.ts` does not exist and a `.spec.ts` importing a missing module fails to collect
// rather than to assert — see `./negotiation.spec.ts` for that argument and for the §8 items it
// forces #576 to write.
//
// Two measured facts about the compiler shape everything below, and the second one surprised me:
//
//  1. A missing *module* behaves like a missing named export. `Equal<MissingType, Frozen>` is `false`
//     and needs a directive; the single TS2307 on the import line is absorbed by one directive and
//     TS2578 fires the day the module and all four names exist.
//  2. A missing *value* is different from a missing *type*. `typeof MissingValue` is `any`, and
//     `@zmdb/schema-core`'s `Equal` answers `true` for `Equal<any, X>` — so a claim about
//     `typeof Version` is vacuous today and gets no directive, while a claim about the type
//     `VersionStrategy` is red today and gets one. Verified both ways round: the directive'd
//     spellings of the `typeof` claims reported TS2578. `Parameters` and `ReturnType` do not rescue
//     them either; `any` survives both.
//
// So the claims below come in three kinds, and each one says which it is: red-and-retiring (a
// directive), binding-on-arrival (no directive, vacuous until the module lands, which is where every
// `typeof` claim is), and green-against-the-frozen-text (no directive, true today, and what checks
// that §2's own text says what §8 item 1 requires it to say).
import type { Equal, Expect, Extends } from '@zmdb/schema-core';

import type { createRouter, GuardRegistry, Router } from '../pipeline/index.js';
// @ts-expect-error frozen (SPEC.md 2): this module is #576's to create.
import type { Version, VersionNeutral, versionsOf, VersionStrategy } from './index.js';

// ---------------------------------------------------------------------------
// §2, held locally
// ---------------------------------------------------------------------------

type FrozenPathStrategy = { readonly kind: 'path'; readonly prefix: string };
type FrozenHeaderStrategy = { readonly kind: 'header'; readonly name: string; readonly default: string };
type FrozenMediaTypeStrategy = { readonly kind: 'media-type'; readonly key: string; readonly default: string };

/** §2 verbatim. One strategy, not an array of them (§3). */
type FrozenVersionStrategy = FrozenPathStrategy | FrozenHeaderStrategy | FrozenMediaTypeStrategy;

type SomeClass = abstract new (...args: never[]) => unknown;
type SomeMethod = (...args: never[]) => unknown;

/** §2 verbatim: an overloaded interface, and not `MethodDecorator | ClassDecorator`. */
interface FrozenVersionDecorator {
  <T extends SomeClass>(target: T, context: ClassDecoratorContext<T>): void;
  (target: SomeMethod, context: ClassMethodDecoratorContext): void;
}

type FrozenVersion = (...versions: readonly [string, ...string[]]) => FrozenVersionDecorator;
type FrozenVersionNeutral = () => FrozenVersionDecorator;
type FrozenVersionsOf = (controller: SomeClass, handlerName: string) => readonly string[] | 'neutral' | undefined;

/** §2: the existing guard option plus `versioning`, as a parameter list. */
type FrozenRouterParams = [
  options?: {
    readonly guardRegistry?: GuardRegistry;
    readonly versioning?: FrozenVersionStrategy;
  },
];

// ---------------------------------------------------------------------------
// Red today, and retiring with #576
// ---------------------------------------------------------------------------

// @ts-expect-error frozen (SPEC.md 2): the strategy union is exported from `./index.ts`.
export type _StrategyShape = Expect<Equal<VersionStrategy, FrozenVersionStrategy>>;

// `Router` gains the strategy at construction, not per registration (§2), and `createRouter` is the
// existing exported function whose option bag has to grow — so this is the one assertion in the
// file that is about code which already exists. `Parameters` and not an `Extends`: the current
// guard-only option bag is assignable to several wider optional shapes, so an assignability claim
// here would pass today and pin nothing.
//
// The alias is not decoration: rule one of the type-level idiom is that the directive goes on the
// line the compiler reports, and written inline this assertion wraps at `printWidth: 120` with the
// TS2344 landing on the inner `Equal` line and TS2578 on the directive. Measured, both.
//
// @ts-expect-error frozen (SPEC.md 2): `createRouter` takes an optional `versioning` strategy.
export type _CreateRouterTakesTheStrategy = Expect<Equal<Parameters<typeof createRouter>, FrozenRouterParams>>;

// The return type does not move: a versioned router is a `Router`, so every existing caller of
// `createRouter()` keeps compiling and `../pipeline/pipeline.spec.ts` needs no edit. Green today, and
// it is the assertion that goes red if the strategy is taken by a *new* factory returning a wider
// type, which would fork the router surface in two.
export type _CreateRouterStillReturnsARouter = Expect<Equal<ReturnType<typeof createRouter>, Router>>;

// ---------------------------------------------------------------------------
// Binding on arrival: vacuous while the module is missing, load-bearing after
// ---------------------------------------------------------------------------
//
// Every claim in this block is `Equal<typeof SomethingMissing, …>`, which is `Equal<any, …>` and
// therefore `true` today. They carry no information now — existence is carried by the directive on
// the import — and they are what makes #576 unable to land a `Version` that compiles but is spelled
// wrong. #573's sketch spells both decorators `MethodDecorator | ClassDecorator`, which is
// uncallable as either half (TS1238 plus TS1241 at every application site, per §2), and a union like
// that fails in the *application's* file rather than in the framework's: these lines move that
// failure here.

// §8 item 1's first claim lives here rather than in a directive'd `Parameters<typeof Version>`, and
// the reason is a measurement that contradicted what I expected. I predicted `Parameters<any>` would
// be `unknown[]` and the arity claim would therefore be red today; it is not — the directive reported
// TS2578, so `Equal<Parameters<typeof Version>, [string, ...string[]]>` is already `true`. A missing
// value is `any` all the way down, including through `Parameters` and `ReturnType`, so *no* claim
// about `Version` itself can be red before the module exists. `_VersionListIsNonEmpty` below carries
// the tuple against §2's own text instead, and this line pins it against the export on arrival.
export type _VersionSignature = Expect<Equal<typeof Version, FrozenVersion>>;

export type _VersionNeutralSignature = Expect<Equal<typeof VersionNeutral, FrozenVersionNeutral>>;

export type _VersionsOfSignature = Expect<Equal<typeof versionsOf, FrozenVersionsOf>>;

// ---------------------------------------------------------------------------
// Green against the frozen text: what §2 has to say for §8 item 1 to hold
// ---------------------------------------------------------------------------

// §8 item 1's second claim: the decorator applies to a class *and* to a method. Asserted against the
// frozen interface rather than the import, because the import is `any` and `Extends<any, X>` is
// vacuously true — the trap that made the first draft of `../openapi/security.type-test.ts` report
// TS2578 on two lines. If §2's overloaded interface is ever simplified to one signature, one of these
// two goes red without any application having to be written.
export type _AppliesToAClass = Expect<
  Extends<FrozenVersionDecorator, <T extends SomeClass>(target: T, context: ClassDecoratorContext<T>) => void>
>;

export type _AppliesToAMethod = Expect<
  Extends<FrozenVersionDecorator, (target: SomeMethod, context: ClassMethodDecoratorContext) => void>
>;

// §8 item 1's first claim, held against §2's own text: the version list is a non-empty tuple, so
// `@Version()` does not compile and a route that serves no version cannot be written.
export type _VersionListIsNonEmpty = Expect<Equal<Parameters<FrozenVersion>, [string, ...string[]]>>;

// §8 item 1's third claim, and §4's asymmetry carried by the type rather than by a paragraph:
// `default` is required on the two strategies that resolve a missing version and absent from the one
// that cannot have a missing version. `string` and not `string | undefined`, which is what an
// optional `default?` reads as under `exactOptionalPropertyTypes` — the spelling that would make the
// most hostile configuration (refuse every request that omits a header the API invented) the one you
// get by leaving something out.
export type _HeaderDefaultIsRequired = Expect<Equal<FrozenHeaderStrategy['default'], string>>;

export type _MediaTypeDefaultIsRequired = Expect<Equal<FrozenMediaTypeStrategy['default'], string>>;

export type _PathStrategyHasNoDefault = Expect<Equal<keyof FrozenPathStrategy, 'kind' | 'prefix'>>;

// Three kinds and no fourth: §"Non-goals" rejects a query-parameter strategy and a custom extractor,
// and both would arrive as another arm here.
export type _ThreeKinds = Expect<Equal<FrozenVersionStrategy['kind'], 'path' | 'header' | 'media-type'>>;

// `versionsOf` distinguishes three answers, and `undefined` is the one §6 turns into a registration
// error. A `readonly string[]` alone could not: "serves every version" and "nobody thought about it"
// would both be the empty array, which is the collapse §6 exists to prevent.
export type _NeutralIsItsOwnAnswer = Expect<
  Equal<ReturnType<FrozenVersionsOf>, readonly string[] | 'neutral' | undefined>
>;
