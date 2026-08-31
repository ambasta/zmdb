Seeding generates deterministic test data from your schema. Use `seedRows` to create reproducible datasets — same seed always produces the same rows. This is useful for testing, demos, and development environments.

## Basic Usage

```ts
import { seedRows, makeRng } from '@zmdb/schema-core/seeding';
import { UserSchema } from './schemas';

// Generate 100 rows with default seed (1)
const rows = seedRows(UserSchema, { count: 100 });

// rows => [{ id: 12345, name: 's3k1w9d', email: 's2m5p8k', ... }, ...]
```

## Deterministic Generation

Pass a seed for reproducible output:

```ts
// Same seed = same rows every time
const rows1 = seedRows(UserSchema, { seed: 42, count: 10 });
const rows2 = seedRows(UserSchema, { seed: 42, count: 10 });

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

Columns with `autoIncrement` or `hasDefault` are skipped.

```ts
const SchemaWithDefaults = defineSchema('t', {
  id: serial().primaryKey(), // skipped (autoIncrement)
  createdAt: timestamp().defaultNow(), // skipped (hasDefault)
  name: text(), // generated
  active: boolean(), // generated
});
```

> [!NOTE]
> Seeding doesn't respect custom types or validators. It generates raw values based on column type.

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
  const rows = seedRows(UserSchema, { count });

  for (const row of rows) {
    await repo.create(row);
  }
}
```

> [!TIP]
> Use a transaction for bulk seeds to improve performance and ensure atomicity.

---

See also: [Schema Core](./schema-declaration.html) · [Repository](./repository.html) · [Validation](./validators-is.html)
