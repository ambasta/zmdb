// Type-level tests for custom types & codecs (#133): the TS-side and DB-side
// types must flow through `defineType`/`encodeValue`/`decodeValue` so a codec
// cannot be wired up backwards. Compiled by `yarn typecheck`.
import type { Equal, Expect } from '../index.ts';
import { defineType } from './index.ts';
// Referenced only in type position (`typeof`), hence the type-only import.
import type { decodeValue, encodeValue } from './index.ts';

// A jsonb codec: TS object <-> JSON string in the DB.
const jsonType = defineType<Record<string, unknown>, string>({
  sqlType: 'jsonb',
  toDb: v => JSON.stringify(v),
  fromDb: raw => JSON.parse(raw),
});

export type _Codec1 = Expect<Equal<Parameters<typeof jsonType.toDb>[0], Record<string, unknown>>>;
export type _Codec2 = Expect<Equal<ReturnType<typeof jsonType.toDb>, string>>;
export type _Codec3 = Expect<Equal<Parameters<typeof jsonType.fromDb>[0], string>>;
export type _Codec4 = Expect<Equal<ReturnType<typeof jsonType.fromDb>, Record<string, unknown>>>;

// encode/decode are inverses at the type level, too.
export type _Codec5 = Expect<Equal<ReturnType<typeof encodeValue<Record<string, unknown>, string>>, string>>;
export type _Codec6 = Expect<
  Equal<ReturnType<typeof decodeValue<Record<string, unknown>, string>>, Record<string, unknown>>
>;
