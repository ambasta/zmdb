Seeding generates deterministic test data from your schema. Use `seedRows` to create reproducible datasets — same seed always produces the same rows. This is useful for testing, demos, and development environments.

## Basic Usage

```ts
import { seedRows, makeRng } from '@zmdb/schema-core/seeding';
import { userSchema } from './schemas.js';

// Generate 100 rows with default seed (1)
const rows = seedRows(userSchema, { count: 100 });

// rows => [{ name: 's3k1w9d', email: 's2m5p8k', ... }, ...]
```

`seedRows` takes the **schema object** — `schemaOf<User>()` — not the type, because it walks
`CoreSchema.columns` at runtime. `Record<string, unknown>[]` out, shaped like `CreateDTO<User>`.

## Deterministic Generation

Pass a seed for reproducible output:

```ts
// Same seed = same rows every time
const rows1 = seedRows(userSchema, { seed: 42, count: 10 });
const rows2 = seedRows(userSchema, { seed: 42, count: 10 });

// rows1 === rows2 (structurally equal)
```

The PRNG uses mulberry32 — fast, deterministic, and seedable.

## Seed Options

```ts
interface SeedOptions {
  seed?: number; // PRNG seed (default: 1)
  count: number; // number of rows to generate
}
```

## Supported Column Types

The seeder handles these types:

| Type                          | Generated Value                     |
| ----------------------------- | ----------------------------------- |
| `serial`, `integer`, `bigint` | Random integer (0–1M)               |
| `numeric`                     | Random decimal (0–1000)             |
| `boolean`                     | Random boolean                      |
| `timestamp`                   | Random date                         |
| `jsonEnum`                    | Random enum value                   |
| `text`, `varchar`             | Random string (`s` + base36 number) |

Columns flagged `autoIncrement` or `hasDefault` are skipped, which is what makes the output a
`create` shape:

```ts
export interface Thing extends Table<'things'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey; // skipped — Serial sets autoIncrement
  createdAt: Date & Sql<'timestamp'> & HasDefault; //    skipped — hasDefault
  name: string & Sql<'text'>; //                         generated
  active: boolean & Sql<'boolean'>; //                   generated
}
```

> [!IMPORTANT]
> The seeder reads `ColumnMeta.type` and those two flags, and nothing else. It does not
> honour nullability, a `Codec`, `Length<N>`, `Numeric<P, S>`, or any of the validation
> tags — a nullable column always gets a value, and a `Min<18>` column gets whatever the
> PRNG produced. Rows can therefore fail `repo.create`'s own validation.
>
> Where you need a value that satisfies its constraints, use
> [`random<T>()`](./random.html): it reads the same tags the validator emits from, and
> refuses outright where it cannot honour one (a `Pattern`, say) rather than producing
> something that will be rejected later.

## Custom Generation

For complex data, extend the seeder or generate manually:

```ts
import { makeRng } from '@zmdb/schema-core/seeding';

const rng = makeRng(123);

const users = Array.from({ length: 50 }, () => ({
  name: `User_${Math.floor(rng() * 1000)}`,
  email: `user${Math.floor(rng() * 1000)}@example.com`,
  role: rng() < 0.5 ? 'admin' : 'user',
}));
```

## Integration with Repository

```ts
async function seedDatabase(repo: UserRepository, count: number) {
  for (const row of seedRows(userSchema, { count })) {
    await repo.create(row as CreateDTO<User>);
  }
}
```

The cast is the one wart: the rows have the `CreateDTO<User>` _shape_ but the declared return
type is `Record<string, unknown>[]`, because `seedRows` is parameterised on the schema value
rather than on the declared type. See [Seed Value Generators](./seed-functions.html).

> [!TIP]
> Use a transaction for bulk seeds to improve performance and ensure atomicity.

---

See also: [Schema Core](./schema-declaration.html) · [Repository](./repository.html) · [Validation](./validators-is.html)
