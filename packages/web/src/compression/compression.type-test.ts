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
import type { Equal, Expect } from '@zmdb/schema-core';

import type { AnyCtx, CompressionOptions, ContentCoding, Ctx, QueryValues, WebResponse } from '../index.js';

/** §2's exact `CompressionOptions` surface. */
interface FrozenCompressionOptions {
  readonly minBytes?: number;
  readonly types?: readonly string[];
  readonly skip?: (response: WebResponse, ctx: AnyCtx) => boolean;
}

type FrozenOptionKeys = 'minBytes' | 'types' | 'skip';

// --- §10.1: `ContentCoding` is exactly two codings --------------------------
//
// Pinning the union to exactly these two members is `false` the moment a third appears, whatever it
// is called — `br`, `zstd`, `deflate-raw` — which is the stronger claim, and it is the same
// allow-list-over-deny-list argument §6 makes about content types.
//
// `Equal` over the whole union rather than a deny-list catches any third coding.
export type _10_1_content_coding = Expect<Equal<ContentCoding, 'gzip' | 'deflate'>>;

// --- §2 and the rejected level option --------------------------------------
//
// The non-goals list rejects "a compression level or quality option", with the reason that
// `CompressionStream` does not expose one "so the option would be either a lie or a `node:zlib`
// dependency". A rejected option is exactly the kind of thing that reappears as a well-meant
// addition, and a runtime test cannot see it: an ignored `level` option does nothing observable, by
// construction. Pinning `keyof` closes the set.
//
type OptionKeys = keyof CompressionOptions;
export type _2_closed_option_set = Expect<Equal<OptionKeys, FrozenOptionKeys>>;

// The whole shape, which is what pairs each name with its type and pins all three as optional — a
// slice that landed `minBytes: number` required would satisfy the `keyof` assertion above and break
// `compress(response, ctx)` with no options at all, which §2 shows as the ordinary call.
export type _2_options_shape = Expect<Equal<CompressionOptions, FrozenCompressionOptions>>;

// --- §2's `AnyCtx` is named in a public signature ----------------------------
//
// Public callbacks must be able to name the context they receive.
type FrozenAnyCtx = Ctx<Record<string, string>, unknown, QueryValues>;
export type _2_any_ctx_is_exported = Expect<Equal<AnyCtx, FrozenAnyCtx>>;

// --- Green: why `keyof` and the whole-union comparison are the techniques ---
//
// Not padding. The three assertions above are only worth having if `Equal` really does notice an
// added union member and an added property. The closed sets match, and each set plus one addition
// does not.
type WithBrotli = 'gzip' | 'deflate' | 'br';
type WithLevel = FrozenCompressionOptions & { readonly level?: number };
export type _10_1_technique_notices = Expect<Equal<Equal<WithBrotli, 'gzip' | 'deflate'>, false>>;
export type _2_technique_matches = Expect<Equal<keyof FrozenCompressionOptions, FrozenOptionKeys>>;
export type _2_technique_notices = Expect<Equal<Equal<keyof WithLevel, FrozenOptionKeys>, false>>;

// `_2_options_shape` also pins optionality rather than trusting only the key set.
type Required_<T, K extends keyof T> = {} extends Pick<T, K> ? false : true;
export type _2_min_bytes_optional = Expect<Equal<Required_<FrozenCompressionOptions, 'minBytes'>, false>>;
export type _2_skip_optional = Expect<Equal<Required_<FrozenCompressionOptions, 'skip'>, false>>;
