// Type-level test for §10 item 1 of `./SPEC.md`: "no `br` appears in `ContentCoding` — a
// compile-time assertion, so the decision in §3 cannot be quietly reversed without editing this
// spec". The runtime half of that item — `new CompressionStream('br')` throws on the supported
// runtime — is a green test in `./compression.spec.ts`.
//
// No runtime code. This is a *compilation* gate, run by `node scripts/typecheck.mjs` and therefore
// by CI, and it is here rather than in the spec file because a negative claim about a union is not
// observable at runtime: a middleware that added `br` to `ContentCoding` and threw when it was
// selected would pass every test in `./compression.spec.ts`, because no client in that file asks
// for a coding the platform cannot produce and gets one anyway.
//
// Each `@ts-expect-error` is self-retiring: TS2578 ("Unused '@ts-expect-error' directive") the day
// the claim comes true, which is the slice that lands the module. A missing named export needs two
// directives — the TS2305 on the import and the `Equal` that is then `false` because the name
// resolved to an error type — and they retire together.

import type { Equal, Expect } from '@zmdb/schema-core';

import type {
  // These three are on separate lines because the directive has to sit on the line the compiler
  // reports, which is the specifier's own line and not the `import` keyword's. One `import type`
  // statement for the module because `import/no-duplicates` is an error in `.oxlintrc.json`, and
  // `Ctx`/`QueryValues` below are real exports and so carry no directive.
  // @ts-expect-error TS2305 — §2's `AnyCtx` is not exported. See `_2_any_ctx_is_exported` below;
  // this is the one entry here that is a defect in the freeze rather than merely unwritten code.
  AnyCtx,
  // @ts-expect-error TS2305 — §2's `CompressionOptions` is not exported yet;
  // `packages/web/src/compression/` holds `SPEC.md` and nothing else.
  CompressionOptions,
  // @ts-expect-error TS2305 — §2's `ContentCoding`, likewise.
  ContentCoding,
  Ctx,
  QueryValues,
} from '../index.js';

/** §2's `CompressionOptions`, declared locally because there is no real one to widen yet. */
interface FrozenCompressionOptions {
  readonly minBytes?: number;
  readonly types?: readonly string[];
  readonly skip?: (response: unknown, ctx: unknown) => boolean;
}

type FrozenOptionKeys = 'minBytes' | 'types' | 'skip';

// --- §10.1: `ContentCoding` is exactly two codings --------------------------
//
// Carried positively. The idiom cannot pre-assert that a currently-legal literal becomes illegal,
// and `@ts-expect-error` over `const x: ContentCoding = 'br'` would be an unused directive today for
// the trivial reason that the name does not resolve. Pinning the union to exactly these two members
// is `false` the moment a third appears, whatever it is called — `br`, `zstd`, `deflate-raw` — which
// is the stronger claim, and it is the same allow-list-over-deny-list argument §6 makes about
// content types.
//
// `Equal` over the whole union rather than `Extract<ContentCoding, 'br'>`: over an error type,
// `Extract<T, …>` collapses back to the error type and `Equal` then returns `true`, so the
// assertion silently passes under its own directive and the directive is what fails, as an unused
// one. That trap cost real time in `../pipeline/streaming.type-test.ts` and is why the technique
// here is a whole-union comparison.
// @ts-expect-error TS2344 — `ContentCoding` resolved to an error type above, so this is `false`.
export type _10_1_content_coding = Expect<Equal<ContentCoding, 'gzip' | 'deflate'>>;

// --- §2 and the rejected level option --------------------------------------
//
// The non-goals list rejects "a compression level or quality option", with the reason that
// `CompressionStream` does not expose one "so the option would be either a lie or a `node:zlib`
// dependency". A rejected option is exactly the kind of thing that reappears as a well-meant
// addition, and a runtime test cannot see it: an ignored `level` option does nothing observable, by
// construction. Pinning `keyof` closes the set.
//
// `keyof` rather than `Pick` or `Extract`, for the reason in the comment above and one more:
// `Pick<T, K>` accepts `{}` over an error type, so `{} extends Pick<CompressionOptions, 'level'>`
// is `true` and reads as a passing assertion. `keyof any` is `string | number | symbol`, which
// `Equal` does see through.
type OptionKeys = keyof CompressionOptions;
// @ts-expect-error TS2344 — `CompressionOptions` resolved to an error type above, so this is
// `false`.
export type _2_closed_option_set = Expect<Equal<OptionKeys, FrozenOptionKeys>>;

// The whole shape, which is what pairs each name with its type and pins all three as optional — a
// slice that landed `minBytes: number` required would satisfy the `keyof` assertion above and break
// `compress(response, ctx)` with no options at all, which §2 shows as the ordinary call.
// @ts-expect-error TS2344 — as above.
export type _2_options_shape = Expect<Equal<CompressionOptions, FrozenCompressionOptions>>;

// --- §2's `AnyCtx` is named in a public signature and is not exported -------
//
// Not a §10 row, and here because no §10 row covers it: §2's `skip` and `compress` both take an
// `AnyCtx`, and `AnyCtx` is declared privately at `../middleware/index.ts:8` and exported from
// nowhere. A consumer therefore cannot write the type of a `skip` callback or of a call to
// `compress` without restating the type — which `./compression.spec.ts` and `../csrf/csrf.spec.ts`
// both have to do, and which is the reason this assertion exists rather than a note in a review.
// `../csrf/SPEC.md` §3 has the same problem in `sessionOf`, `issue` and `verify`;
// `../graphql/SPEC.md` §10 plans the export under a different epic, and neither of these two specs
// records the dependency.
//
// It is written here rather than in the csrf type-test only to keep it in one place; whichever
// slice lands the export retires it, and until then the gate says so instead of a comment.
type FrozenAnyCtx = Ctx<Record<string, string>, unknown, QueryValues>;
// @ts-expect-error TS2344 — `AnyCtx` resolved to an error type above, so this is `false`.
export type _2_any_ctx_is_exported = Expect<Equal<AnyCtx, FrozenAnyCtx>>;

// --- Green: why `keyof` and the whole-union comparison are the techniques ---
//
// Not padding. The three assertions above are only worth having if `Equal` really does notice an
// added union member and an added property, and a reader has no way to check that against types
// that do not exist yet. These run the same comparisons over the local declarations, where both
// sides are real: the closed sets match, and each set plus one addition does not. If somebody later
// "simplifies" an assertion above into something `Equal` cannot see through — which is precisely
// what `Extract` and `Pick` do here — these are what stay behind to show what it used to say.
type WithBrotli = 'gzip' | 'deflate' | 'br';
type WithLevel = FrozenCompressionOptions & { readonly level?: number };
export type _10_1_technique_notices = Expect<Equal<Equal<WithBrotli, 'gzip' | 'deflate'>, false>>;
export type _2_technique_matches = Expect<Equal<keyof FrozenCompressionOptions, FrozenOptionKeys>>;
export type _2_technique_notices = Expect<Equal<Equal<keyof WithLevel, FrozenOptionKeys>, false>>;

// Green, and the reason `_2_options_shape` pins optionality rather than trusting the `keyof` row:
// `{} extends Pick<T, K>` distinguishes a required property from an optional one, demonstrated on
// the local declaration because over an error type it is `true` for every key and so cannot be
// asserted against the imported name at all — it would be an unused directive that reads like a
// passing test.
type Required_<T, K extends keyof T> = {} extends Pick<T, K> ? false : true;
export type _2_min_bytes_optional = Expect<Equal<Required_<FrozenCompressionOptions, 'minBytes'>, false>>;
export type _2_skip_optional = Expect<Equal<Required_<FrozenCompressionOptions, 'skip'>, false>>;
