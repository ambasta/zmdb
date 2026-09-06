// Type-level tests for the sqlcommenter surface frozen in ./SPEC.md §2 and §7.5 (#580,
// epic #578). No runtime code: a *compilation* gate run by `node scripts/typecheck.mjs`,
// and therefore by CI. `packages/query-compiler/tsconfig.json` includes `src/**/*.ts`, so
// this file is compiled.
//
// ./SPEC.md §7.5 is explicit that these assertions can only be compile-time ones: *"There
// is no runtime assertion for an arbitrary key because there is no way to pass one."* That
// sentence is the whole reason this file exists. §2 calls rejecting `Record<string, string>`
// "the central decision of this file", and a closed key set has no runtime shadow — an open
// record and a closed one behave identically until the day somebody passes a request id.
//
// NOTE ON THE MISSING IMPORT. Unlike `../../../web/src/health/health.type-test.ts`, this
// file does **not** `import type { Equal, Expect } from '@zmdb/schema-core'`. It cannot:
// `packages/query-compiler/package.json` has no `dependencies` block at all, deliberately,
// because this package sits below `@zmdb/schema-core` in the dependency graph. The two
// helpers are reimplemented in four lines below rather than inverting that edge. If a later
// refactor moves `Equal`/`Expect` into a package this one may depend on, delete them and
// import instead.
import type { CompiledQuery } from '../index.js';
import { serializeComment as serialize, type CommentKey, type CommentPairs } from './index.js';

/** Local `Expect`. See the note above on why this is not the `@zmdb/schema-core` one. */
type Expect<T extends true> = T;
/** Local `Equal`. The bivariance trick, identical to `@zmdb/schema-core`'s. */
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

// `../../../web/src/observability/SPEC.md` §2's `Observability.comments.keys`. The real
// declaration lives in `@zmdb/web`, which this package must not import — `@zmdb/web`
// depends on `@zmdb/query-compiler`, so the edge only goes one way. The alias is restated
// here so that §7.5's "`keys: []` is rejected" is asserted in the package that owns
// `CommentKey`; `../../../web/src/observability/observability.type-test.ts` asserts the same
// property against the real `Observability`, and the duplication is on purpose: the two
// would diverge silently if only one existed.
type CommentKeys = readonly [CommentKey, ...CommentKey[]];

// Every negative assertion in this file is written as a ONE-LINE declaration, deliberately,
// and kept under `.oxfmtrc.json`'s `printWidth` of 120. `@ts-expect-error` suppresses errors
// reported on the single following line, and TypeScript reports different error kinds in
// different places: a *missing* required property lands on the declaration's identifier
// (TS2741) while an unassignable or excess property lands on that property. A one-line
// declaration puts every candidate position on the covered line — and if `yarn fmt` wraps
// the literal, the directive stops covering the error and the assertion becomes a
// `TS2578: Unused '@ts-expect-error' directive`. The width is load-bearing, not cosmetic.

// --- §7.5, first half: `keys: []` is rejected ------------------------------
//
// §2 of the observability spec: the sketch's `{ enabled: boolean; keys: readonly
// CommentKey[] }` has three ways to spell "off" — absent, `enabled: false`, and `keys: []` —
// and two of them are spellings nobody tests. A non-empty tuple deletes the third.

export const oneKey: CommentKeys = ['traceparent'];
export const allKeys: CommentKeys = ['action', 'controller', 'framework', 'route', 'traceparent'];
// @ts-expect-error — the empty array is the third spelling of "off"; a non-empty tuple makes it a compile error (§7.5).
export const noKeys: CommentKeys = [];
// @ts-expect-error — and a `readonly CommentKey[]` is not assignable to the tuple, so a widened field cannot slip back in.
export const widenedKeys: CommentKeys = [] as readonly CommentKey[];

// --- §7.5, second half: a key outside the five is rejected -----------------
//
// §5 names the two that matter. A request id is "the highest-cardinality thing available",
// which is the one that kills the plan cache; `application` and `db_driver` are real
// sqlcommenter keys this spec deliberately omits (§2), so they are the ones a reader who
// knows sqlcommenter and not this file would reach for.

// @ts-expect-error — `request_id` is what an open key set is for, and it is the thing §5 refuses.
export const requestIdKey: CommentKeys = ['request_id'];
// @ts-expect-error — `application` is a real sqlcommenter key; §2 omits it in favour of `application_name` on the connection.
export const applicationKey: CommentKeys = ['application'];
// @ts-expect-error — `db_driver` is the other omitted sqlcommenter key; `framework` covers what it is for (§2).
export const dbDriverKey: CommentKeys = ['db_driver'];
// @ts-expect-error — `method` is what `sql-comments.md`'s example tags today, and it is outside the five (§2).
export const methodKey: CommentKeys = ['method'];

export const pairsOk: CommentPairs = { route: '/users/:id', controller: 'UsersController' };
export const pairsEmpty: CommentPairs = {};
// @ts-expect-error — the serializer's argument is keyed by `CommentKey`, so there is no path from a caller to comment text (§2).
export const pairsRequestId: CommentPairs = { request_id: 'abc' };
// @ts-expect-error — values are strings: a number would reach the tag without passing `encode` (§3).
export const pairsNumber: CommentPairs = { route: 42 };
export const serialized: string = serialize({ traceparent: '00-abc-def-01' });

// THE EXACT LIMIT OF §2'S CLAIM, recorded because it is narrower than the sentence.
//
// §2 says "there is no path from a caller to comment text at all — step 10's 'no
// caller-supplied string reaches the comment unencoded' is a property of the type rather
// than a rule a reviewer enforces". Verified with `tsc`: that is true of a *fresh object
// literal* (`pairsRequestId` above is TS2353, an excess-property error) and NOT true of a
// value whose declared type has a string index signature. The line below COMPILES:
// `Record<string, string>` is assignable to `Readonly<Partial<Record<CommentKey, string>>>`,
// because every optional member is satisfied by the index signature and excess-property
// checking only applies to fresh literals.
//
// It is asserted positively rather than with `@ts-expect-error` because it compiles today
// and an `@ts-expect-error` here would be a TS2578. The type still carries the property that
// matters — an arbitrary key cannot be *written* at a call site — but the guarantee is
// "no accidental key", not "no path". The shipped decorators source values from an explicit
// closed callback and a runtime-selected key map, not from an open record. If a caller launders
// one directly into the serializer, §3's `encode` still runs on both the key and the value,
// which is the reason §3 encodes keys it says cannot need it.
declare const openRecord: Record<string, string>;
export const serializedOpen: string = serialize(openRecord);

export type _CommentKeyIsClosed = Expect<
  Equal<CommentKey, 'traceparent' | 'controller' | 'action' | 'route' | 'framework'>
>;
// The tuple's *element* type is what a "just make it compile" fix widens, and the negative
// above would still fail for the empty case while quietly admitting `string`. Pin both.
export type _KeysIsNonEmptyTuple = Expect<Equal<CommentKeys, readonly [CommentKey, ...CommentKey[]]>>;
export type _PairsValuesAreStrings = Expect<Equal<CommentPairs[CommentKey], string | undefined>>;

// --- §6/§7.7: the comment is rendered, not stored --------------------------
//
// §6: the tag is applied by the driver decorator at execute time and is **not** a field on
// `CompiledQuery`. `./comments.spec.ts` asserts the runtime half (a tagged execute leaves the
// compiled query deep-equal to its untagged self). This is the half that survives a
// well-meaning refactor: the moment `CompiledQuery` grows a `comment` field, the shape every
// existing `toEqual` in this repository compares has changed, and §6's whole argument —
// "a compiled query can be cached and reused across requests that would tag it differently" —
// is gone. `../index.ts:77-80` is the interface; these lines are the fence around it.
export type _CompiledQueryKeysToday = Expect<
  Equal<keyof CompiledQuery, 'text' | 'parameters' | 'operation' | 'isWrite' | 'returnsRows' | 'telemetry'>
>;

declare const today: CompiledQuery;

// `../../../web/src/observability/SPEC.md` §5 adds exactly one optional field. "Optional"
// there is justified as *additive* — "a field nothing reads is a field that changes the shape
// every existing `toEqual` compares" — so the claim to check is that today's two-key value is
// still assignable once the field exists. This is the only assertion in this file that comes
// from the observability spec rather than this one; it lives here because `CompiledQuery`
// lives here, and #580's file list does not name a second query-compiler test file.
type FrozenCompiledQuery = CompiledQuery;
export const additive: FrozenCompiledQuery = today;
export const withTelemetry: FrozenCompiledQuery = {
  text: 'SELECT 1',
  parameters: [],
  telemetry: { system: 'postgresql', operation: 'SELECT', collection: 'users' },
};
// @ts-expect-error — `telemetry: undefined` is not an absent `telemetry` under exactOptionalPropertyTypes; §5 means absent.
export const undefTelemetry: FrozenCompiledQuery = { text: 'SELECT 1', parameters: [], telemetry: undefined };
// @ts-expect-error — there is no `comment` field, and §6 is the reason: a per-request value in a per-route cached object.
export const storedComment: FrozenCompiledQuery = { text: 'SELECT 1', parameters: [], comment: "route='%2Fx'" };
