// Type-level tests for the response body union (epic #564, spec freeze #565). No runtime code: a
// *compilation* gate run by `node scripts/typecheck.mjs`, and therefore by CI. These are
// `./SPEC.md` §A9 items 2 and 3, which are compile-time claims by construction — "an exhaustive
// switch is a compile error when an arm is added" is not something a runtime assertion can say.
//
// Each `@ts-expect-error` below is self-retiring: TS2578 ("Unused '@ts-expect-error' directive")
// the day the claim comes true, which is the slice that lands §A1 (#567). A missing named export
// needs two directives — the TS2305 on the import, and the `Equal` that is then `false` because
// the name resolved to an error type — and they retire together.

import type { Equal, Expect } from '@zmdb/schema-core';

import type {
  // @ts-expect-error TS2305 — §A1's `ResponseBody` is not exported yet. One import statement for
  // the module because `import/no-duplicates` is an error, and the directive sits on the line the
  // compiler reports, which is the specifier's own line and not the `import` keyword's.
  ResponseBody,
  WebResponse,
} from './index.js';

// §A1's three arms, declared locally. This is the *whole* frozen union rather than a widening,
// because there is no existing `ResponseBody` to widen — what keeps it honest is `_A9_1_*` at the
// bottom, which pins the two `WebResponse` fields that do not change and therefore keeps the
// `Omit<WebResponse, 'body'>` intersections in `./streaming.spec.ts` load-bearing.
type FrozenTextBody = { readonly kind: 'text'; readonly value: string };
type FrozenBytesBody = { readonly kind: 'bytes'; readonly value: Uint8Array<ArrayBuffer> };
type FrozenStreamValue = ReadableStream<Uint8Array<ArrayBuffer>>;
type FrozenStreamBody = {
  readonly kind: 'stream';
  readonly value: FrozenStreamValue;
  readonly length: number | undefined;
};
type FrozenResponseBody = FrozenTextBody | FrozenBytesBody | FrozenStreamBody;
type FrozenValue = string | Uint8Array<ArrayBuffer> | FrozenStreamValue;

// --- A9.2: the tag, and therefore the arm count ----------------------------
//
// §A9.2's claim is "an exhaustive `switch` over `ResponseBody` with no `default` is a compile
// error when an arm is added". That is a claim about a *future* arm, and the idiom cannot
// pre-assert that a currently-legal program becomes illegal — a literal that is legal today under
// a directive is TS2578 now. Carried positively instead: pinning the tag to exactly these three
// literals is `false` the day a fourth arm appears, which is the compile error §A9.2 asks for, on
// the line a reader will look at.
// @ts-expect-error TS2344 — `ResponseBody` resolved to an error type above, so this is `false`.
export type _A9_2_tags = Expect<Equal<ResponseBody['kind'], 'text' | 'bytes' | 'stream'>>;

// --- A9.3: `Uint8Array<ArrayBuffer>`, not bare `Uint8Array` ----------------
//
// Under TypeScript 7 a bare `Uint8Array` means `Uint8Array<ArrayBufferLike>`, which includes a
// `SharedArrayBuffer`-backed view, and `BodyInit` excludes those — so `new Response(body.value)`
// in `toFetchHandler` would be TS2345. §A1 says the only ways out are this parameter or an `as`
// at the adapter, and §2.5 forbids the second. Indexed access across the union is deliberate: it
// pins all three `value` types on one line, and `Extract<ResponseBody, …>` cannot be used for the
// per-arm version because `Extract` over an error type collapses to the error type and the
// assertion silently passes — which is how this file nearly shipped three unused directives.
// @ts-expect-error TS2344 — as above.
export type _A9_3_values = Expect<Equal<ResponseBody['value'], FrozenValue>>;

// The whole union, arm by arm, which is what pairs each tag with its own `value` and pins
// `length` as required-and-nullable. It is the assertion that fails if the slice lands
// `length?: number`, and the two green assertions below are why it can be trusted to.
// @ts-expect-error TS2344 — as above.
export type _A9_3_union = Expect<Equal<ResponseBody, FrozenResponseBody>>;

// Green, and the reason `_A9_3_union` is written as a whole-shape comparison rather than as an
// assertion about `length` on its own. `Equal<T['length'], number | undefined>` cannot tell
// `length: number | undefined` from `length?: number`: under `exactOptionalPropertyTypes` both
// read as `number | undefined`, which `_A9_3_length_indistinguishable` states as a fact. What
// does distinguish them is whether `{}` satisfies the picked property, which is true exactly when
// the property is optional. These two would fail if somebody "simplified" the local declaration
// above to the optional form, which would take `_A9_3_union` with it.
type Required_<T, K extends keyof T> = {} extends Pick<T, K> ? false : true;
type OptionalLengthArm = { readonly kind: 'stream'; readonly value: FrozenStreamValue; readonly length?: number };
export type _A9_3_length_required = Expect<Equal<Required_<FrozenStreamBody, 'length'>, true>>;
export type _A9_3_length_optional = Expect<Equal<Required_<OptionalLengthArm, 'length'>, false>>;
export type _A9_3_length_indistinguishable = Expect<Equal<FrozenStreamBody['length'], OptionalLengthArm['length']>>;

// The platform half of §A1's argument, asserted against `lib.dom` rather than against this
// package: a `SharedArrayBuffer`-backed view is not a `BodyInit`. This directive is *not*
// self-retiring — it is a permanent property of the platform types — and it is here because it is
// the entire reason the two assertions above name `ArrayBuffer`. A reader who doubts them can
// delete this line and watch the build stay green.
declare const sharedBacked: Uint8Array<ArrayBufferLike>;
// @ts-expect-error TS2345 — Uint8Array<ArrayBufferLike> is not assignable to BodyInit.
export const _A9_3_bodyinit = new Response(sharedBacked);

// --- A9.1's promise, at the type level -------------------------------------
//
// Green. `status` and `headers` do not change, and the `Omit<WebResponse, 'body'>` intersections
// in `./streaming.spec.ts` are only load-bearing while that is true: widen `status` to a string
// union or make `headers` mutable and every assertion in that file would quietly start testing a
// shape nobody has. These two are what turn that into a build failure.
export type _A9_1_status = Expect<Equal<WebResponse['status'], number>>;
export type _A9_1_headers = Expect<Equal<WebResponse['headers'], Readonly<Record<string, string>>>>;

// Green, and the one assertion in this file that must go *red* when the feature lands: today
// `body` is a `string`. It is not written as a `@ts-expect-error`, because a false claim under a
// directive is red immediately and this claim is true. When §A1 lands, this line fails and is
// deleted with the rest of the file — which is the point: nothing here can be forgotten on the
// way in.
export type _A9_1_body_today = Expect<Equal<WebResponse['body'], string>>;
