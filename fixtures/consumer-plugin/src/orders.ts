// Everything this project does with an `Order`, and the only file that mentions validation.
//
// Six derivations of one interface, none of which names a schema: the type argument *is* the
// input. Which is the whole claim of the type-first design — `./model.ts` is edited, and the
// validator, the error report, the sample, the JSON Schema and the SQL schema follow.
//
// There are two copies of this file, one per fixture, and they differ in exactly one way: in
// `consumer-cli/` the seven calls below have already been replaced by the generated wrappers
// next door, because that is what `@zmdb/compiler` project compilation does to a source file. In `consumer-plugin/`
// they are still as written, and the bundler's copy of the plugin rewrites them on the way
// into the bundle. Same program either way — that is the thing being tested.

import { assert, is, schemaOf, validate, type ValidateResult } from 'zmdb';
import { toJsonSchema, type JsonSchemaObject, type TaggedSchema } from 'zmdb/schema';
import { random } from 'zmdb/validator';

import type { Order } from './model.js';

export function accepts(value: unknown): boolean {
  return is<Order>(value);
}

/**
 * The same question about an anonymous shape.
 *
 * Here for what the emitter does with it rather than for the shape itself: a *named* type
 * hoists into a helper the call sites share, and an inline one becomes a single boolean
 * expression with no call in it at all. REQ-AV-1's acceptance criterion is written about this
 * case, so the fixture had better contain one.
 */
export function acceptsPoint(value: unknown): boolean {
  return is<{ readonly x: number; readonly y: number }>(value);
}

export function insist(value: unknown): Order {
  return assert<Order>(value);
}

export function explain(value: unknown): ValidateResult<Order> {
  return validate<Order>(value);
}

export function sample(): Order {
  return random<Order>();
}

export function document(): JsonSchemaObject {
  return toJsonSchema<Order>();
}

export function schema(): TaggedSchema<Order> {
  return schemaOf<Order>();
}
