// Type-level test for §8.5 of `./SPEC.md`: "There is no option that enables directory listing — a
// compile-time assertion over `StaticOptions`, since a missing runtime option is not observable."
//
// No runtime code. This is a *compilation* gate, run by `node scripts/typecheck.mjs` and therefore
// by CI. It is here rather than in `./static.spec.ts` because the claim is a negative one about a
// type, and a runtime test can only ever assert that one particular spelling of an option does
// nothing — `serve('sub', {})` answering 404 says nothing about `{ listing: true }` existing.
//
import type { Equal, Expect } from '@zmdb/schema-core';

import type { StaticOptions } from '../index.js';

/** §1's exact `StaticOptions` surface. */
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
// Pinning `keyof` to exactly these five names is `false` the moment a sixth appears, whatever it is called —
// `listing`, `directoryIndex`, `browse`, `autoIndex` — which is a stronger claim than a deny-list
// of names somebody thought of, and it is the same allow-list-over-deny-list argument §7 makes
// about content types.
//
type OptionKeys = keyof StaticOptions;
export type _8_5_closed_option_set = Expect<Equal<OptionKeys, FrozenKeys>>;

// The whole shape, which is what pairs each name with its type and pins `root` and `onError` as
// required. A slice that landed `root?: string` would satisfy the `keyof` assertion above and
// leave a handler that serves the process's working directory when the option is forgotten.
export type _1_options_shape = Expect<Equal<StaticOptions, FrozenStaticOptions>>;

// --- Green: why `keyof` is the technique -----------------------------------
//
// Not padding. `_8_5_closed_option_set` is only worth having if `keyof` really does notice an
// added property. These two run the same comparison over the local declaration: the closed set
// matches, and the same set plus one listing option does not.
type WithListing = FrozenStaticOptions & { readonly listing?: boolean };
export type _8_5_technique_matches = Expect<Equal<keyof FrozenStaticOptions, FrozenKeys>>;
export type _8_5_technique_notices = Expect<Equal<Equal<keyof WithListing, FrozenKeys>, false>>;

// `root` and `onError` are required and `index` is not.
type Required_<T, K extends keyof T> = {} extends Pick<T, K> ? false : true;
export type _1_root_required = Expect<Equal<Required_<FrozenStaticOptions, 'root'>, true>>;
export type _1_on_error_required = Expect<Equal<Required_<FrozenStaticOptions, 'onError'>, true>>;
export type _5_index_optional = Expect<Equal<Required_<FrozenStaticOptions, 'index'>, false>>;
