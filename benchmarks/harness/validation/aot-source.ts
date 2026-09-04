// The AOT path's source: the four moltar cases, written the way a user writes them.
//
// This file is transform input, not something to import. `generate.mjs` runs the real
// `transformFile` over it — the same reflect-then-emit path the bundler plugin runs — and
// writes the result to `aot.generated.ts`, which is what the benchmark measures. Running
// it untransformed would throw: `is<T>(data)` with no second argument has no runtime
// witness, which is the whole point of the transform.
import { equals, is, validate } from '../../../packages/aot-validator/src/utilities/index.js';
import type { Moltar } from './model.js';

export function aotIs(data: unknown): boolean {
  return is<Moltar>(data);
}

export function aotEquals(data: unknown): boolean {
  return equals<Moltar>(data);
}

// The shipped `validate<T>` contract: the validated value IS the parsed value, because a
// purely structural type has no coercion. Rebuilding it would measure an allocation the
// real API does not make.
export function aotParseSafe(data: unknown): unknown {
  const result = validate<Moltar>(data);
  if (!result.success) throw new Error('wrong type.');
  return result.data;
}

export function aotParseStrict(data: unknown): unknown {
  if (!equals<Moltar>(data)) throw new Error('wrong type.');
  return data;
}
