Seeding generates deterministic test data from your schema. Use `seedRows` to create reproducible datasets — the same seed always produces the same rows. This is useful for testing, demos, and
development environments.

## Basic Usage

```ts {"mode":"illustrative","id":"example-001","reason":"The application supplies the local modules ./schemas.js; this fence is an excerpt of that project."}
import { seedRows } from '@zmdb/orm/seeding';
import { userSchema } from './schemas.js';

// Generate 100 rows with the default seed (1)
const rows = seedRows(userSchema, { count: 100 });

// rows => CreateDTO<User>[]
// [{ name: 's3k1w9d', email: 's2m5p8k', age: 34, active: true }, ...]
```

`seedRows` takes the **schema value** — `schemaOf<User>()` — rather than the type, and reads the declared type back off it: a `TaggedSchema<User>` carries `User` in its type, so the return is
`CreateDTO<User>[]` and the rows go into `repo.create` with no cast.

## Deterministic Generation

Pass a seed for reproducible output:

```ts {"mode":"illustrative","id":"example-002","reason":"The surrounding example supplies seedRows, userSchema; this excerpt does not repeat those declarations."}
// Same seed = same rows every time
const rows1 = seedRows(userSchema, { seed: 42, count: 10 });
const rows2 = seedRows(userSchema, { seed: 42, count: 10 });

// rows1 and rows2 are structurally equal
```

The PRNG is mulberry32 — fast, deterministic, and seedable. Nothing in the generator reaches for `Math.random`, so a seeded run is reproducible across processes and runtimes, which is what makes a
seeded failure debuggable from the test output alone.

## Seed Options

```ts {"mode":"compile","id":"example-003"}
interface SeedOptions {
  seed?: number; // PRNG seed (default: 1)
  count: number; // number of rows to generate
}
```

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

```ts {"mode":"illustrative","id":"example-004","reason":"The surrounding example supplies HasDefault, PrimaryKey, Serial, Sql, Table; this excerpt does not repeat those declarations."}
export interface Thing extends Table<'things'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey; // absent — the database assigns it
  createdAt: Date & Sql<'timestamp'> & HasDefault; //    absent — the default assigns it
  name: string & Sql<'text'>; //                         generated
  active: boolean & Sql<'boolean'>; //                   generated
}
```

## What it refuses

A column the sampler cannot satisfy is a thrown refusal that names the column and the reason, rather than a value that will be rejected downstream. The case that occurs in practice is `Pattern<…>`:

```ts {"mode":"illustrative","id":"example-005","reason":"The surrounding example supplies Pattern, Sql, Table, accountSchema, seedRows; this excerpt does not repeat those declarations."}
export interface Account extends Table<'accounts'> {
  slug: string & Sql<'text'> & Pattern<'^[a-z]+$'>;
}

seedRows(accountSchema, { count: 1 });
// Error: cannot sample `.slug`: a sample cannot be built from a pattern;
//        nothing here inverts a regular expression
```

Inverting a regular expression is a real problem and this does not solve it — it says so instead. Where you need such a table seeded, write that column yourself:

```ts {"mode":"compile","id":"example-006"}
const accounts = Array.from({ length: 10 }, (_, i) => ({ slug: `account-${i}` }));
```

or drop the pattern from the column and check the value at the boundary that receives one. The other refusals — contradictory bounds, a type that recurs with no terminating arm — are listed under
[`random()`](./random.html).

## Custom Generation

`makeRng(seed)` is exported because a seed script usually needs more than rows — picking an existing id, choosing a category, deciding whether an optional field is set:

```ts {"mode":"illustrative","id":"example-007","reason":"The surrounding example supplies authorRepo, postRepo, postSchema; this excerpt does not repeat those declarations."}
import { makeRng, seedRows } from '@zmdb/orm/seeding';

const rng = makeRng(42);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)]!;

const authorIds = (await authorRepo.findAll()).map(a => a.id);
for (const post of seedRows(postSchema, { count: 500, seed: 42 })) {
  await postRepo.create({ ...post, authorId: pick(authorIds) });
}
```

Using the same seed for `makeRng` and `seedRows` keeps the whole script reproducible, including the join keys.

## Integration with Repository

```ts {"mode":"illustrative","id":"example-008","reason":"The surrounding example supplies UserRepository, seedRows, userSchema; this excerpt does not repeat those declarations."}
async function seedDatabase(repo: UserRepository, count: number) {
  for (const row of seedRows(userSchema, { count })) {
    await repo.create(row);
  }
}
```

`count` round trips. For a large seed, batch through the compiler instead:

```ts {"mode":"illustrative","id":"example-009","reason":"The surrounding example supplies createQueryCompiler, driver, rows; this excerpt does not repeat those declarations."}
import { postgres } from '@zmdb/postgres';

const q = createQueryCompiler(postgres).insertInto(userSchema).values(rows).compile();
await driver.execute(q);
```

> [!TIP] Use a transaction for bulk seeds to improve performance and ensure atomicity.

> [!NOTE] A `References<'authors.id'>` column gets a value of the right _type_, not an id that exists. Seed in dependency order and substitute real keys, as above — there is no relation-aware
> `seedGraph`.

---

See also: [Schema Core](./schema-declaration.html) · [Repository](./repository.html) · [Validation](./validators-is.html)
