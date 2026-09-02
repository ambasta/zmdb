# SPEC — Seeding (frozen)

Part of `@zmdb/schema-core`. A deterministic, seeded data generator that produces
rows shaped like a schema's insertable columns. Reproducible from a numeric seed. Epic #136.

## API

```ts
interface SeedOptions {
  seed?: number;
  count: number;
}
function seedRows(schema: CoreSchema<string>, opts: SeedOptions): Record<string, unknown>[];
function makeRng(seed: number): () => number; // deterministic [0,1) generator
```

## Frozen behavior

- `makeRng(seed)` is a deterministic PRNG (mulberry32): same seed ⇒ same
  sequence, across processes and runtimes.
- `seedRows(schema, {seed, count})` returns `count` rows; the same `(schema,
seed, count)` yields byte-identical output (reproducible).
- Each generated value respects the column's TS type (text→string, integer→int,
  boolean→bool, timestamp→Date, jsonEnum→one of the enum members).
- Auto-increment / defaulted columns are omitted, so a row can be handed to
  `repository.create`.
- Relation-aware ordering is the caller's concern for now (documented); seedRows
  emits independent rows per schema.

## Two known ceilings

The return type is `Record<string, unknown>[]`, not `CreateDTO<S>[]`: the generator walks
`schema.columns`, which is the lossy projection (`../../SPEC.md` §2), so it has no way to
prove to the compiler that what it built is the create shape. A caller therefore validates
or asserts on the way in rather than getting a typed row.

The values satisfy a column's **type** and not its **constraints**. `genValue` reads
`col.type` and `col.flags.enum` and nothing else, so a `Min<18>` or a
`Pattern<'^[a-z]+$'>` column can be seeded with a value its own validator rejects.

Both have the same fix, and it is the same fix: generate from the declared type via
`random<CreateDTO<T>>()`, which already reads the tags. That makes `seedRows` a loop over a
call the AOT validator emits, returns `CreateDTO<T>[]` honestly, and deletes `genValue`. It
is a follow-up rather than a change here because it moves the function onto the declared
type — the re-parameterisation tracked in `../../SPEC.md` §4.
