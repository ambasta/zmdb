Seeding generates deterministic test data from your schema. Use `seedRows` to create reproducible datasets — the same seed always produces the same rows. This is useful for testing, demos, and
development environments.

## Basic Usage

<!-- snippet: seeding.ts#snippet-1 -->

`seedRows` takes the **schema value** — `schemaOf<User>()` — rather than the type, and reads the declared type back off it: a `TaggedSchema<User>` carries `User` in its type, so the return is
`CreateDTO<User>[]` and the rows go into `repo.create` with no cast.

## Deterministic Generation

Pass a seed for reproducible output:

<!-- snippet: seeding.ts#snippet-2 -->

The PRNG is mulberry32 — fast, deterministic, and seedable. Nothing in the generator reaches for `Math.random`, so a seeded run is reproducible across processes and runtimes, which is what makes a
seeded failure debuggable from the test output alone.

## Seed Options

<!-- snippet: seeding.ts#snippet-3 -->

## What a generated value satisfies

Values come from the column's **IR** — the same description the validator checks against, and via the same sampler [`random<T>()`](./random.html) uses. So a generated row satisfies the whole
declaration, not just its SQL type:

| Declaration                | Generated value                              |
| -------------------------- | -------------------------------------------- |
| `string & Sql<'text'>`     | base-36 string, 1–12 characters              |
| `… & MinLength<4>`         | at least four characters                     |
| `number & Sql<'integer'>`  | integer, 0 … 1000                            |
| `… & Min<18> & Max<120>`   | integer in `[18, 120]`                       |
| `boolean & Sql<'boolean'>` | 50/50                                        |
| `Date & Sql<'timestamp'>`  | a `Date`                                     |
| `'admin' \| 'user'`        | one member, uniformly                        |
| `{ … } & Sql<'json'>`      | a payload of the declared shape, recursively |
| `bigint & Sql<'bigint'>`   | a `bigint` in the same range                 |

That is the difference from the column-map generator this replaced, which read the SQL type and two flags and nothing else: a `Min<18>` column got whatever the PRNG produced, so seeded rows routinely
failed the table's own validator inside a test whose subject was something else.

## The `create` shape

Auto-increment and defaulted columns are **absent**, because `CreateDTO<T>` does not have the first and treats the second as optional — and a seeded value over a database default makes a row that does
not resemble an inserted one:

<!-- snippet: seeding.ts#snippet-4 -->

## What it refuses

A column the sampler cannot satisfy is a thrown refusal that names the column and the reason, rather than a value that will be rejected downstream. The case that occurs in practice is `Pattern<…>`:

<!-- snippet: seeding.ts#snippet-5 -->

Inverting a regular expression is a real problem and this does not solve it — it says so instead. Where you need such a table seeded, write that column yourself:

<!-- snippet: seeding.ts#snippet-6 -->

or drop the pattern from the column and check the value at the boundary that receives one. The other refusals — contradictory bounds, a type that recurs with no terminating arm — are listed under
[`random()`](./random.html).

## Custom Generation

`makeRng(seed)` is exported because a seed script usually needs more than rows — picking an existing id, choosing a category, deciding whether an optional field is set:

<!-- snippet: seeding.ts#snippet-7 -->

Using the same seed for `makeRng` and `seedRows` keeps the whole script reproducible, including the join keys.

## Integration with Repository

<!-- snippet: seeding.ts#snippet-8 -->

`count` round trips. For a large seed, batch through the compiler instead:

<!-- snippet: seeding.ts#snippet-9 -->

> [!TIP] Use a transaction for bulk seeds to improve performance and ensure atomicity.

> [!NOTE] A `References<'authors.id'>` column gets a value of the right _type_, not an id that exists. Seed in dependency order and substitute real keys, as above — there is no relation-aware
> `seedGraph`.

---

See also: [Schema Core](./schema-declaration.html) · [Repository](./repository.html) · [Validation](./validators-is.html)
