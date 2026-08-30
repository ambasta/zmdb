# SPEC — Seeding (frozen)

Part of `@zmdb/schema-core`. A deterministic, seeded data generator that produces
rows satisfying a schema. Reproducible from a numeric seed. Epic #136.

## API

```ts
interface SeedOptions { seed?: number; count: number; }
function seedRows<S>(schema: S, opts: SeedOptions): CreateDTO<S>[];
function makeRng(seed: number): () => number; // deterministic [0,1) generator
```

## Frozen behavior

- `makeRng(seed)` is a deterministic PRNG (mulberry32): same seed ⇒ same
  sequence, across processes and runtimes.
- `seedRows(schema, {seed, count})` returns `count` rows; the same `(schema,
  seed, count)` yields byte-identical output (reproducible).
- Each generated value respects the column's TS type (text→string, integer→int,
  boolean→bool, timestamp→Date, jsonEnum→one of the enum members).
- Auto-increment / defaulted columns are omitted (it produces `CreateDTO<S>`
  shapes), so rows can be inserted via `repository.create`.
- Relation-aware ordering is the caller's concern for now (documented); seedRows
  emits independent rows per schema.
