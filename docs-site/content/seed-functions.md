`@zmdb/schema-core/seeding` generates rows that satisfy a schema, from a seed you choose, so the same seed produces the same data.

## Generating rows

```ts
import { seedRows } from '@zmdb/schema-core/seeding';
import { userSchema } from './schema.js';

const rows = seedRows(userSchema, { count: 50, seed: 1 });
// Record<string, unknown>[], shaped like CreateDTO<User>
```

Every column gets a value appropriate to its **SQL type** — `text`/`varchar` a base-36 string, `integer`/`bigint`/`serial` an integer under a million, `numeric` two decimal places, `timestamp` a `Date`, `jsonEnum` one of its members, and anything else the string form. Same seed, same rows, which is what makes a seeded test reproducible and a seeded failure debuggable.

> [!IMPORTANT]
> That is the whole of it. The generator reads `ColumnMeta.type` and two flags, and
> nothing else — it does **not** honour nullability, `Min`/`Max`, `MinLength`/`MaxLength`,
> `Pattern`, `Length<N>`, `Numeric<P, S>` or a `Codec`. A nullable column always gets a
> value; a constrained one gets a value that may well violate the constraint, which
> `repo.create` will then reject. For a row that satisfies its constraints by construction,
> use [`random<T>()`](./random.html) — it reads the same tags the validator does, and
> refuses rather than guessing where it cannot.

The return type is `Record<string, unknown>[]`. Auto-increment and defaulted columns are
**omitted**, so the shape is a `CreateDTO<S>` and the rows go straight into `repo.create` —
but the static type is not `CreateDTO<S>`, so the call site needs the cast the generator
cannot give you.

## Inserting them

`seedRows` returns data; writing it is a separate step, because the generator has no connection:

```ts
for (const row of seedRows(userSchema, { count: 50, seed: 1 })) {
  await repo.create(row as CreateDTO<User>);
}
```

Fifty round trips. For a large seed, batch through the compiler instead:

```ts
const q = createQueryCompiler('postgres').insertInto('users').values(rows).compile();
await driver.execute(q);
```

> [!NOTE]
> There is no `id` to strip. A `Serial` column carries the `autoIncrement` flag and a
> `HasDefault` column carries `hasDefault`, and `seedRows` filters both out before
> generating — the row it hands you is already the `create` shape. Passing a generated
> `id` would be rejected anyway: the repository refuses a supplied serial column with
> `the database generates "id", so a payload cannot supply it`.

## The RNG on its own

`makeRng(seed)` is the deterministic generator underneath, and it is exported because a seed script usually needs more than rows — picking a random existing id, choosing a category, deciding whether an optional field is set:

```ts
import { makeRng } from '@zmdb/schema-core/seeding';

const rng = makeRng(42);
const pick = <T>(xs: readonly [T, ...T[]]): T => xs[Math.floor(rng() * xs.length)] ?? xs[0];

const authorIds = (await authorRepo.findAll()).map(a => a.id);
for (const post of seedRows(postSchema, { count: 500, seed: 42 })) {
  await postRepo.create({ ...post, authorId: pick(authorIds) } as CreateDTO<Post>);
}
```

Using the same seed for `makeRng` and `seedRows` keeps the whole script reproducible, including the join keys.

## Respecting foreign keys

A `References<'authors.id'>` column gets a value of the right _type_, not an id that exists. Seed in dependency order and substitute real keys:

```ts
const authors = [];
for (const a of seedRows(authorSchema, { count: 10, seed: 1 })) {
  authors.push(await authorRepo.create(a as CreateDTO<Author>));
}

for (const p of seedRows(postSchema, { count: 100, seed: 2 })) {
  await postRepo.create({ ...p, authorId: pick(authors).id } as CreateDTO<Post>);
}
```

There is no relation-aware seeding that does this for you — see below.

## Realistic values

The generator produces values that fit the SQL type, not values that look like names — and, as above, not values that satisfy your constraints either. Override the field:

```ts
const names = ['Ada', 'Grace', 'Alan', 'Barbara'];
seedRows(userSchema, { count: 4, seed: 1 }).map((r, i) => ({ ...r, name: names[i] ?? r.name }));
```

zmdb ships no faker-style corpus, because that is a lot of data to carry for zero [runtime dependencies](./why-zmdb.html).

## In tests

The value here is that a fixture is derived from the schema, so adding a column does not break every test that built a row by hand:

```ts
const [user] = seedRows(userSchema, { count: 1, seed: 1 });
const created = await repo.create(user as CreateDTO<User>);
```

Use a distinct seed per test so one test's data cannot make another pass. See [Testing](./testing.html).

## Random values from a type

For a payload that is not a table row, `random<T>()` in the validator does the same job against an arbitrary type:

```ts
import { random } from '@zmdb/aot-validator/utilities';

const body = random<CreateUserRequest>();
```

Needs the transformer. See [AOT Setup](./aot-setup.html).

## What is missing

**Relation-aware seeding.** No `seedGraph([authors, posts], relations)` that fills foreign keys with keys it just inserted. The manual version above is five lines, so this is convenience rather than capability.

**Insertion.** No `seed(driver, schema, opts)` — the generator deliberately has no I/O, which is why it works in a test with no database.

**Constraint-aware values, and a `CreateDTO<S>` return type.** The two are the same piece of work: the generator reads `CoreSchema.columns`, and the tags it ignores are all present on the `ColumnIR` beside them. `random<T>()` already does the reading; the honest fix is for `seedRows` to be a thin loop over it rather than a second, weaker generator.

---

See also: [Seeding](./seeding.html) · [Testing](./testing.html) · [random()](./validators-misc.html)
