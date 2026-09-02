// @zmdb/web — zmdb data-layer integration (epic #277, spec ./SPEC.md).
// Typed DI token for a repository + an adapter turning a validator into the
// pipeline's validateBody hook. No consumer `as`, no runtime parser.
//
// "No runtime parser" still holds with `wireDecoder` here: it converts the two column
// types JSON cannot carry (a `timestamp`, a `bigint`) into the values the app layer holds,
// and it accepts and rejects nothing. Validation remains the consumer's AOT `assert`.

import type { BaseRepository } from '@zmdb/repository';
import type { CoreSchema } from '@zmdb/schema-core';
import { decodeWire, encodeWire, irFromSchema, type CodecRegistry, type Variant } from '@zmdb/schema-core/ir';

import { createToken, type Token } from '../di/index.ts';

/**
 * A typed DI token for a repository over schema `S`. Register a
 * `defineRepository(S, ...)` instance under it and `@Inject` it into a
 * controller — the injected field is typed `BaseRepository<S>`, no `as`.
 */
export function repositoryToken<S extends CoreSchema<string>>(name: string): Token<BaseRepository<S>> {
  return createToken<BaseRepository<S>>(name);
}

/**
 * Adapt a validator into a pipeline `validateBody` hook. Pass any function that
 * returns the validated value or throws — e.g. `@zmdb/aot-validator`'s
 * `assert<CreateDTO<S>>`. The framework embeds no parser of its own.
 */
export function validateWith<T>(validator: (raw: unknown) => T): (raw: unknown) => T {
  return validator;
}

/** A JSON object body — not an array, which is a valid JSON document and not a payload. */
function isBody(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The wire→app decode, at the boundary and nowhere else (plan D3).
 *
 * A column has three types, and two of them meet here: JSON carries a `timestamp` as an
 * ISO-8601 string and a `bigint` as a decimal one, while a handler, a `CreateDTO<S>` and
 * the repository all hold a `Date` and a `bigint`. Something has to convert, and if it is
 * not one function at the edge then it is every handler, differently — which is the state
 * in which nobody noticed that the repository accepted both and the DDL was wrong.
 *
 * Put it *before* validation in the chain: it decodes, the validator then checks the app
 * type. It converts and never rejects — a string that is not a date survives as a string,
 * so the validator reports it rather than the handler receiving `Invalid Date`.
 *
 * ```ts
 * dtoChain({ decode: wireDecoder(OrderSchema, 'create'), validate: assert<CreateDTO<typeof OrderSchema>> })
 * ```
 */
export function wireDecoder<S extends CoreSchema<string>>(
  schema: S,
  variant: Variant = 'create',
  codecs: CodecRegistry = {},
): (raw: unknown) => unknown {
  // Once per route, not once per request: the schema is a constant.
  const ir = irFromSchema(schema);
  return (raw: unknown) => (isBody(raw) ? decodeWire(ir, variant, raw, codecs) : raw);
}

/**
 * The app→wire encode, for a response: the same crossing in the other direction.
 *
 * A `Date` does not survive `JSON.stringify` as anything the published document describes
 * — it becomes an ISO string, which happens to be right — and a `bigint` does not survive
 * it at all (`TypeError`). Both are the wire type of a column, so both come from here.
 */
export function wireEncoder<S extends CoreSchema<string>>(
  schema: S,
  codecs: CodecRegistry = {},
): (result: unknown) => unknown {
  const ir = irFromSchema(schema);
  return (result: unknown) => {
    if (Array.isArray(result)) return result.map(row => (isBody(row) ? encodeWire(ir, row, codecs) : row));
    return isBody(result) ? encodeWire(ir, result, codecs) : result;
  };
}
