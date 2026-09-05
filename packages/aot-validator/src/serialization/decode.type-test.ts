// Type-level tests for AOT-validator decode and parse helpers (#54).
// No runtime code: this file is a compile-time gate evaluated by `tsc`.
import type { Equal, Expect } from '@zmdb/schema-core';

import type { decode, parse, ParseResult } from './index.ts';

// parse<T> returns ParseResult<T>
export type _ParseResultType = Expect<
  Equal<ReturnType<typeof parse<{ id: number; email: string }>>, ParseResult<{ id: number; email: string }>>
>;

// decode<T> returns ParseResult<T>
export type _DecodeResultType = Expect<
  Equal<ReturnType<typeof decode<{ id: number; email: string }>>, ParseResult<{ id: number; email: string }>>
>;
