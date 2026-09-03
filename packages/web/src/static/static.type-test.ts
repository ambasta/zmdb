// Type-level test for §8.5 of `./SPEC.md`: "There is no option that enables directory listing — a
// compile-time assertion over `StaticOptions`, since a missing runtime option is not observable."
//
// No runtime code. This is a *compilation* gate, run by `node scripts/typecheck.mjs` and therefore
// by CI. It is here rather than in `./static.spec.ts` because the claim is a negative one about a
// type, and a runtime test can only ever assert that one particular spelling of an option does
// nothing — `serve('sub', {})` answering 404 says nothing about `{ listing: true }` existing.
//
// Each `@ts-expect-error` is self-retiring: TS2578 ("Unused '@ts-expect-error' directive") the day
// the claim comes true, which is the slice that lands the module. A missing named export needs two
// directives — the TS2305 on the import, and the `Equal` that is then `false` because the name
// resolved to an error type — and they retire together.

import type { Equal, Expect } from '@zmdb/schema-core';

import type {
  // @ts-expect-error TS2305 — §1's `StaticOptions` is not exported yet; `packages/web/src/static/`
  // holds `SPEC.md` and nothing else. One `import type` statement for the module because
  // `import/no-duplicates` is an error, and the directive sits on the line the compiler reports,
  // which is the specifier's own line and not the `import` keyword's.
  StaticOptions,
} from '../index.js';

/** §1's `StaticOptions`, declared locally because there is no real one to widen yet. */
interface FrozenStaticOptions {
  readonly root: string;
  readonly index?: string;
  readonly cacheControl?: string;
  readonly contentTypes?: Readonly<Record<string, string>>;
  readonly onError: (error: unknown) => void;
}

type FrozenKeys = 'root' | 'index' | 'cacheControl' | 'contentTypes' | 'onError';

// --- §8.5: the option set is closed ----------------------------------------
//
// The claim "there is no option that enables directory listing" cannot be written directly: the
// idiom cannot pre-assert that a currently-illegal property becomes... anything, and
// `@ts-expect-error` over `{ listing: true }` would be an unused directive today for the trivial
// reason that `StaticOptions` does not exist. Carried positively instead: pinning `keyof` to
// exactly these five names is `false` the moment a sixth appears, whatever it is called —
// `listing`, `directoryIndex`, `browse`, `autoIndex` — which is a stronger claim than a deny-list
// of names somebody thought of, and it is the same allow-list-over-deny-list argument §7 makes
// about content types.
//
// `keyof` rather than `Extract` or `Pick`: over an error type, `Extract<T, …>` collapses back to
// the error type and `Pick<T, K>` accepts `{}`, so `Equal` returns `true` and the assertion
// silently passes under its own directive. Both were tried; both were unused directives.
type OptionKeys = keyof StaticOptions;
// @ts-expect-error TS2344 — `StaticOptions` resolved to an error type above, so this is `false`.
export type _8_5_closed_option_set = Expect<Equal<OptionKeys, FrozenKeys>>;

// The whole shape, which is what pairs each name with its type and pins `root` and `onError` as
// required. A slice that landed `root?: string` would satisfy the `keyof` assertion above and
// leave a handler that serves the process's working directory when the option is forgotten.
// @ts-expect-error TS2344 — as above.
export type _1_options_shape = Expect<Equal<StaticOptions, FrozenStaticOptions>>;

// --- Green: why `keyof` is the technique -----------------------------------
//
// Not padding. `_8_5_closed_option_set` is only worth having if `keyof` really does notice an
// added property, and a reader has no way to check that against a type that does not exist yet.
// These two run the same comparison over the local declaration, where both sides are real: the
// closed set matches, and the same set plus one listing option does not. If somebody later
// "simplifies" the assertion above to something `Equal` cannot see through, these are what stay
// behind to show what it used to say.
type WithListing = FrozenStaticOptions & { readonly listing?: boolean };
export type _8_5_technique_matches = Expect<Equal<keyof FrozenStaticOptions, FrozenKeys>>;
export type _8_5_technique_notices = Expect<Equal<Equal<keyof WithListing, FrozenKeys>, false>>;

// Green. `root` and `onError` are required and `index` is not, demonstrated on the local
// declaration for the reason above: `{} extends Pick<T, K>` is `true` for an error type, so this
// distinction cannot be asserted against the imported name at all — it would be an unused
// directive that reads like a passing test.
type Required_<T, K extends keyof T> = {} extends Pick<T, K> ? false : true;
export type _1_root_required = Expect<Equal<Required_<FrozenStaticOptions, 'root'>, true>>;
export type _1_on_error_required = Expect<Equal<Required_<FrozenStaticOptions, 'onError'>, true>>;
export type _5_index_optional = Expect<Equal<Required_<FrozenStaticOptions, 'index'>, false>>;
