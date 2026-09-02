# SPEC — Seeding (frozen)

Part of `@zmdb/repository`. A deterministic, seeded data generator that produces rows shaped
like a table's create DTO. Reproducible from a numeric seed. Epic #136.

## API

```ts
interface SeedOptions {
  seed?: number;
  count: number;
}
function seedRows<T extends DeclaredTable>(schema: TaggedSchema<T>, opts: SeedOptions): CreateDTO<T>[];
function makeRng(seed: number): () => number; // deterministic [0,1) generator
```

## Frozen behavior

- `makeRng(seed)` is a deterministic PRNG (mulberry32): same seed ⇒ same sequence, across
  processes and runtimes.
- `seedRows(schema, {seed, count})` returns `count` rows; the same `(schema, seed, count)`
  yields identical output.
- Values are generated from the column's **IR**, by the same sampler `random<T>()` uses, so
  they satisfy the whole declaration and not just its type: `Min<18>`, `Max<120>`,
  `MinLength`, `MaxLength`, a string-literal union's members, a `json` column's payload
  shape, and a `timestamp`'s `Date`.
- Auto-increment columns are absent, because `CreateDTO<T>` does not have them. Defaulted
  columns are absent too: they are optional in `CreateDTO<T>`, and a seeded value over a
  database default makes a row that does not resemble an inserted one.
- A column the sampler cannot satisfy is a **refusal**, naming the column and the reason. The
  one that occurs in practice is `Pattern<…>`: nothing inverts a regular expression, and a
  value that violates the column's own pattern is not a seed, it is a latent test failure.
- Relation-aware ordering is the caller's concern (documented); `seedRows` emits independent
  rows per table.

## Why it lives here

The generator is `@zmdb/aot-validator`'s sampler, and that package depends on
`@zmdb/schema-core/ir`, so seeding cannot sit in `schema-core` without pointing the
dependency backwards. It was in `@zmdb/schema-core/seeding` until then, with a value
generator of its own.

That generator is the reason this file's "known ceilings" section is gone rather than
updated. It read `col.type` and `col.flags.enum` and nothing else — the fifth walker over
column metadata, with the same failure mode as the other four: partial knowledge of one
vocabulary, held privately. Both ceilings it documented were consequences of that, and both
are closed by not having a second generator. The return type is `CreateDTO<T>[]` because the
rows are built from the type; the constraints hold because the sampler reads them.
