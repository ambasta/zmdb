// Type-level assertions for the public CSRF surface in ./SPEC.md §3.
import type { Equal, Expect } from '@zmdb/schema-core';

import type { AnyCtx, createCsrf, Csrf, CsrfOptions, Guard } from '../index.js';

interface FrozenCsrfOptions {
  readonly secret: Uint8Array<ArrayBuffer>;
  readonly sessionOf: (ctx: AnyCtx) => string | undefined;
  readonly allowedOrigins: readonly string[];
  readonly headerName?: string;
}

interface FrozenCsrf {
  issue(ctx: AnyCtx): Promise<string>;
  verify(ctx: AnyCtx): Promise<void>;
  guard(): Guard;
}

type FrozenCreateCsrf = (options: FrozenCsrfOptions) => Promise<FrozenCsrf>;

export type _options_match_spec = Expect<Equal<CsrfOptions, FrozenCsrfOptions>>;
export type _csrf_matches_spec = Expect<Equal<Csrf, FrozenCsrf>>;
export type _factory_matches_spec = Expect<Equal<typeof createCsrf, FrozenCreateCsrf>>;
