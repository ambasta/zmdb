// Custom types & codecs — see ./SPEC.md.

import type { Codec } from '../ir/index.js';

/**
 * A column type the library does not know, described by its owner.
 *
 * Three types, because a column has three (plan D3): `Wire` is what JSON carries,
 * `TS` is what handler code holds, and `DB` is what the driver binds. A codec that
 * named only two of them left the third to be guessed, and the guess was "the same
 * as the app type" — which is how a `Money` instance ended up being handed to
 * `JSON.stringify` and to a query parameter unchanged.
 *
 * All four functions are required. A codec whose `toWire` was optional would be a
 * codec that sometimes converts, and the caller cannot tell which kind it has.
 */
export interface CustomType<Wire = unknown, TS = unknown, DB = unknown> {
  /** DDL type, e.g. `'jsonb'`. Dialect spelling is the emitter's business. */
  readonly sqlType: string;
  /** Serialise for the driver. */
  toDb(value: TS): DB;
  /** Parse a driver row value. */
  fromDb(raw: DB): TS;
  /** Serialise for a JSON response. */
  toWire(value: TS): Wire;
  /** Parse a JSON request body value. */
  fromWire(raw: Wire): TS;
  /** Validate untrusted write payload. */
  validate?(value: unknown): boolean | string;
}

export function defineType<Wire, TS, DB>(def: CustomType<Wire, TS, DB>): CustomType<Wire, TS, DB> {
  return Object.freeze({ ...def });
}
export function encodeValue<Wire, TS, DB>(type: CustomType<Wire, TS, DB>, value: TS): DB {
  return type.toDb(value);
}
export function decodeValue<Wire, TS, DB>(type: CustomType<Wire, TS, DB>, raw: DB): TS {
  return type.fromDb(raw);
}

/**
 * Adapt a `CustomType` to the `Codec` the IR's wire crossing asks for.
 *
 * The IR speaks `unknown` on both sides because it is data, not generics; the
 * conversion is one cast at this boundary rather than one at every registry literal.
 * A `Codec<'Money'>` tag names the key this goes under:
 *
 * ```ts
 * wireDecoder(Schema, 'create', { Money: wireCodec(MoneyType) })
 * ```
 */
export function wireCodec<Wire, TS, DB>(type: CustomType<Wire, TS, DB>): Codec {
  // boundary: a registry is keyed by name, so the value arriving at either direction is only
  // as typed as the declaration that named this codec. The validator is what proves it, and
  // it runs before `decode` and after `encode`.
  return {
    decode: (wire: unknown) => type.fromWire(wire as Wire),
    encode: (app: unknown) => type.toWire(app as TS),
  };
}
