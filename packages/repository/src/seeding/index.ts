// Deterministic seeding — see ./SPEC.md.
//
// This module used to live in `@zmdb/schema-core/seeding` and generate its values from a
// walk of its own over `schema.columns`: a `switch` on `col.type` returning a random number
// for an integer, a random `s…` for anything string-ish, and a member of `flags.enum` for an
// enum. It was the fifth walker over column metadata, and it had the failure mode all five
// shared — it read part of what a column says. `Min<18>`, `Max<120>`, `Pattern<…>`,
// `MinLength`, a `json` payload shape and nullability were all invisible to it, so seeding a
// table with any of them produced rows the table's own validator rejects.
//
// It generates from the IR now, through the same sampler `random<T>()` uses, which reads the
// whole vocabulary and *refuses* what it cannot satisfy rather than guessing. Two
// consequences worth stating, because both are visible to a caller:
//
//   - The rows honour the constraints. A `Min<18>` column is seeded within its bounds.
//   - A `Pattern<…>` column is refused, with the column named. Nothing inverts a regular
//     expression, so the alternative is a value that violates the pattern — which is what
//     used to happen, silently, and surfaced later as a validation failure in a test whose
//     subject was something else.
//
// It lives here rather than in `schema-core` because the sampler ships in
// `@zmdb/aot-validator`, which depends on `schema-core/ir` — so the dependency only points
// one way from here. That is also the honest home: a seeded row exists to be handed to
// `repository.create`, and now it type-checks as one.
import { random } from '@zmdb/aot-validator/utilities';
import type { CreateDTO, DeclaredTable, TaggedSchema } from '@zmdb/schema-core';
import { objectTypeFromIR, type ObjectIR } from '@zmdb/schema-core/ir';

/** Deterministic PRNG (mulberry32). Same seed ⇒ same sequence. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SeedOptions {
  seed?: number;
  count: number;
}

/**
 * The create shape with its optional properties dropped — the columns a caller *must* supply.
 *
 * The sampler fills every property of an object it is given, including the optional ones, and
 * that is right for `random<T>()`: a sample of a type is a value of that type. It is wrong
 * here. A column is optional in `CreateDTO` because the database has a default for it, and
 * seeding a value over the default is how a seeded row stops resembling an inserted one.
 */
function requiredColumns(shape: ObjectIR): ObjectIR {
  return { ...shape, properties: shape.properties.filter(property => !property.optional) };
}

/**
 * `count` rows shaped like `T`'s create DTO, reproducible from `seed`.
 *
 * Typed as `CreateDTO<T>[]`, which the column-map version could not be: it built its rows
 * from the lossy projection and had no way to tell the compiler what it had made. `random`'s
 * type parameter is inferred from the return type here, so there is no assertion — and no
 * type argument either, which is what keeps the transformer out of a call whose shape is only
 * known at runtime.
 */
export function seedRows<T extends DeclaredTable>(schema: TaggedSchema<T>, opts: SeedOptions): CreateDTO<T>[] {
  const rng = makeRng(opts.seed ?? 1);
  const shape = requiredColumns(objectTypeFromIR(schema.ir, 'create'));
  const rows: CreateDTO<T>[] = [];
  for (let i = 0; i < opts.count; i++) rows.push(random(shape, rng));
  return rows;
}
