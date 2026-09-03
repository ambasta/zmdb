// Lazily imported modules, as types. Tests freeze for the epic "The module graph as a first-class
// object" (#598 / spec freeze #599); the frozen text is `./SPEC.md` §L2 and §L12.1.
//
// The type-level half of `lazy.spec.ts`. `node scripts/typecheck.mjs` compiles this file, so a
// frozen claim written plainly is a build failure rather than a red test; `@ts-expect-error` over
// the claim is the `it.fails` of the type level. Each directive absorbs exactly one of today's
// errors and reports TS2578 the day the claim comes true, so the implementation slice cannot land
// without editing this file. See `../di/di.type-test.ts` for the house style and
// `../../../query-compiler/src/schema-objects/expression-indexes.type-test.ts` for the placement
// rule: the directive goes on the line the compiler reports, one assertion per line.
import type { Equal, Expect } from '@zmdb/schema-core';

// One import statement, not two, and `import type` even for `lazy`. A second `from './index.js'`
// would violate this repository's `import/no-duplicates` rule; and `lazy` appears here only inside
// `typeof`, which makes `consistent-type-imports` require the type-only form. `import type` of a
// value is exactly what `typeof lazy` needs.
//
// One directive per specifier, inside the braces, because that is where the compiler reports the
// error — TS2305 is raised on the specifier's own line once `oxfmt` has reflowed this list past
// `printWidth: 120`, and a directive above the `import` keyword would cover only the first line. It
// is also the better shape: each of the four names retires on its own, so a slice that lands
// `lazy` and `LazyImport` but not the handle types leaves exactly two directives behind.
import type {
  CompiledModule,
  // @ts-expect-error frozen (SPEC.md L2): `LazyImport` is exported from this module.
  LazyImport,
  // @ts-expect-error frozen (SPEC.md L2): `LazyModuleHandle` is exported from this module.
  LazyModuleHandle,
  // @ts-expect-error frozen (SPEC.md L2): `LazyStatus` is exported from this module.
  LazyStatus,
  ModuleClass,
  ModuleDef,
  // @ts-expect-error frozen (SPEC.md L2): `lazy` is exported from this module.
  lazy,
} from './index.js';

// ---------------------------------------------------------------------------
// The frozen shapes, held locally
// ---------------------------------------------------------------------------
//
// Held locally as well as imported because the imports above resolve to error types today, and an
// error type satisfies any `Equal` the compiler is asked for — so the two kinds of assertion test
// different things: the import tests the *name*, and these test the *shape* it has to have.

/** §L2 verbatim. Discriminated by `kind`, not branded, so `typeof entry === 'function'` narrows. */
type FrozenLazyImport = { readonly kind: 'lazy'; readonly module: ModuleClass };

/** §L2 verbatim, and in this order — `unloaded` first, because that is what a fresh app reports. */
type FrozenLazyStatus = 'unloaded' | 'loading' | 'loaded' | 'failed';

// The imported names have the frozen shapes. Each of these retires together with the directive on
// its import: while the export is missing the import is TS2305 and the comparison is `false`, and
// the slice that adds the export clears both at once.
//
// @ts-expect-error frozen (SPEC.md L2): the absorbed import is an error type, so this is false today.
export type _LazyImportShape = Expect<Equal<LazyImport, FrozenLazyImport>>;

// @ts-expect-error frozen (SPEC.md L2): `LazyStatus` has four members and no more.
export type _LazyStatusUnion = Expect<Equal<LazyStatus, FrozenLazyStatus>>;

/** §L2 verbatim. `load` is a method, not a readonly property holding a function. */
type FrozenHandle = {
  readonly name: string;
  readonly status: FrozenLazyStatus;
  load(): Promise<void>;
};

// @ts-expect-error frozen (SPEC.md L2): `LazyModuleHandle` is `{ name, status, load }` and nothing else.
export type _HandleShape = Expect<Equal<LazyModuleHandle, FrozenHandle>>;

// `load(): Promise<void>`, not `Promise<CompiledModule>`. §L2's argument is that there is exactly
// one `Container` for the whole graph, so there is no second `CompiledModule` for a lazy subtree
// to be, and returning one invites the misreading that it is a separate graph.
//
// §L12.1 asks additionally that "assigning `load()`'s result to `CompiledModule` is rejected".
// That cannot be written as a compile-time assertion: `@ts-expect-error` over an assignment that
// is *already* an error today would report TS2578 the moment the export lands correctly, so it
// asserts nothing about the frozen type and everything about today's absence. The claim is carried
// positively instead — pinning the return type to `Promise<void>` makes the rejection a
// consequence rather than a separate assertion, since `void` and `CompiledModule` have no overlap.
//
// @ts-expect-error frozen (SPEC.md L2): the absorbed import is an error type, so this is false today.
export type _LoadReturns = Expect<Equal<ReturnType<LazyModuleHandle['load']>, Promise<void>>>;

// `lazy`, lowercase, returning the inert declaration — not `LazyModule`, which reads as a
// decorator being called in the one position where a reader is scanning for class names, and not
// `LazyModuleRef` carrying `loaded` and a cached promise, which §L2 calls the correction that
// matters most: `imports: [lazy(Heavy)]` evaluates once per module file, so state on that value is
// shared by every app compiled from the module class.
//
// No directive here, and the reason is worth writing down: the absorbed import above makes `lazy`
// an error type, `typeof lazy` is therefore `any`, and `any` satisfies this comparison — so the
// assertion is vacuously true today and a directive over it would be TS2578. It is not dead
// weight. The *name* is tested by the directive on the import; this line is what starts testing
// the *signature* the moment the export exists, and it is what rejects
// `lazy(module): LazyModuleRef` or a `lazy()` that takes a thunk.
export type _LazySignature = Expect<Equal<typeof lazy, (module: ModuleClass) => FrozenLazyImport>>;

// §L12.1's first clause, and the widening the whole amendment rests on: `imports` admits both.
// `| undefined` is in the frozen answer because `imports` stays optional and
// `exactOptionalPropertyTypes` is on — an indexed access on an optional property includes
// `undefined` regardless of whether the declaration writes it.
//
// The answer is held in a local alias so the assertion fits `printWidth: 120` on one line: `oxfmt`
// reflows a longer `Expect<...>` across three lines, which moves the error off the line the
// directive sits above and reports TS2578 for the directive and TS2344 for the assertion at once.
type FrozenImports = readonly (ModuleClass | FrozenLazyImport)[] | undefined;

// @ts-expect-error frozen (SPEC.md L2): `ModuleDef.imports` admits a `LazyImport`.
export type _ImportsWiden = Expect<Equal<ModuleDef['imports'], FrozenImports>>;

// §L2's `CompiledModule` gains `lazy`, **required**. This is the assertion that stops `lazy.spec.ts`
// being satisfied by an optional field: that file reads the handles through
// `CompiledModule & { readonly lazy?: ... }`, which an implementation declaring `lazy?:` would also
// satisfy, and §L11 is explicit that the list is empty rather than absent for a graph with no
// `lazy()` imports. `Equal` against a bare array type is what pins required-ness and element type
// at once; a `lazy?:` declaration makes the answer include `undefined` and this goes red.
//
// @ts-expect-error frozen (SPEC.md L2): `CompiledModule.lazy` is a required readonly array of handles.
export type _LazyRequired = Expect<Equal<CompiledModule['lazy'], readonly FrozenHandle[]>>;

// `lazy` is the *only* member `CompiledModule` gains. Written as the post-landing answer with a
// directive rather than as today's two keys with none: `keyof CompiledModule` is
// `'container' | 'controllers'` today, so the passing form of this assertion is one that the
// implementation slice breaks — a green test that has to be edited to land the feature is a booby
// trap, and this file has room for exactly one kind of failure.
//
// @ts-expect-error frozen (SPEC.md L2): `CompiledModule` gains `lazy` and nothing else.
export type _CompiledKeys = Expect<Equal<keyof CompiledModule, 'container' | 'controllers' | 'lazy'>>;

// The field that does not move, and it holds today: one flat controller list, which is what makes
// `load()`'s `void` return honest. §L9 appends a loaded module's instances to this list rather than
// giving the subtree a list of its own, so widening the element type here would be the wrong fix.
export type _ControllersUnchanged = Expect<Equal<CompiledModule['controllers'], readonly object[]>>;

// ---------------------------------------------------------------------------
// §L12.1's narrowing claim, as code the compiler has to accept
// ---------------------------------------------------------------------------
//
// "An `imports` entry is narrowed by `typeof entry === 'function'` with no `as`." A comparison of
// types cannot express this — it is a claim about control-flow analysis — so it is written as the
// function a two-pass compile has to contain, and the assertion is that it compiles. Both arms
// assign to an explicitly annotated local, which is what makes the narrowing load-bearing: widen
// either arm and the assignment is an error, and an `as` anywhere in here would defeat the point.
//
// `ModuleClass` is a bare abstract construct signature, and `.name` on it is exactly the read
// §L10 relies on for the cycle path message. It compiles, verified with `tsc --strict
// --exactOptionalPropertyTypes` on a two-line file rather than reasoned about.

type ImportEntry = NonNullable<ModuleDef['imports']>[number];

/** The shape of pass one's edge walk: a class is followed now, a marker is set aside for pass two. */
export function classifyImport(entry: ImportEntry): string {
  if (typeof entry === 'function') {
    const eager: ModuleClass = entry;
    return `eager:${eager.name}`;
  }
  const deferred: LazyImport = entry;
  return `lazy:${deferred.module.name}`;
}

// The one behaviour of `classifyImport` worth stating as a type: the `else` arm is the marker and
// nothing else, so adding a third arm to the union (a string module name, a thunk) breaks this
// rather than silently falling into the lazy branch.
//
// @ts-expect-error frozen (SPEC.md L2): `imports` holds a class or the marker, and nothing else.
export type _EntryUnion = Expect<Equal<ImportEntry, ModuleClass | FrozenLazyImport>>;
