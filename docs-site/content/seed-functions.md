`@zmdb/schema-core/seeding` generates rows that satisfy a schema, from a seed you choose, so the same seed produces the same data.

## Generating rows

```ts
import { seedRows } from '@zmdb/schema-core/seeding';
import { users } from './schema.js';

const rows = seedRows(users, { count: 50, seed: 1 });
// Entity<typeof users>[]
```

Every column gets a value appropriate to its type, honouring `nullable()` and any `validate()` rules that constrain the range. Same seed, same rows — which is what makes a seeded test reproducible and a seeded failure debuggable.

## Inserting them

`seedRows` returns data; writing it is a separate step, because the generator has no connection:

```ts
for (const row of seedRows(users, { count: 50, seed: 1 })) {
  await repo.create(row);
}
```

Fifty round trips. For a large seed, batch through the compiler instead:

```ts
const q = createQueryCompiler('postgres').insertInto('users').values(rows).compile();
await driver.execute(q);
```

> [!NOTE]
> `seedRows` returns `Entity<S>`, which **includes** `serial` columns.
> `repo.create` takes `CreateDTO<S>`, which excludes them. Strip the key when
> letting the database assign it:
>
> ```ts
> const { id, ...dto } = row;
> await repo.create(dto);
> ```

## The RNG on its own

`makeRng(seed)` is the deterministic generator underneath, and it is exported because a seed script usually needs more than rows — picking a random existing id, choosing a category, deciding whether an optional field is set:

```ts
import { makeRng } from '@zmdb/schema-core/seeding';

const rng = makeRng(42);
const pick = <T>(xs: readonly [T, ...T[]]): T => xs[Math.floor(rng() * xs.length)] ?? xs[0];

const authorIds = (await authorRepo.findAll()).map(a => a.id);
for (const post of seedRows(posts, { count: 500, seed: 42 })) {
  await postRepo.create({ ...post, authorId: pick(authorIds) });
}
```

Using the same seed for `makeRng` and `seedRows` keeps the whole script reproducible, including the join keys.

## Respecting foreign keys

The generator fills a `references()` column with a value of the right _type_, not an id that exists. Seed in dependency order and substitute real keys:

```ts
const authors = [];
for (const a of seedRows(authorsSchema, { count: 10, seed: 1 })) {
  const { id, ...dto } = a;
  authors.push(await authorRepo.create(dto));
}

for (const p of seedRows(postsSchema, { count: 100, seed: 2 })) {
  const { id, ...dto } = p;
  await postRepo.create({ ...dto, authorId: pick(authors).id });
}
```

There is no relation-aware seeding that does this for you — see below.

## Realistic values

The generator produces values that fit the type and the rules, not values that look like names. If you want plausible data, constrain it with a rule the generator can read, or override the field:

```ts
email: text().notNull().validate({ kind: 'pattern', value: '^[a-z]+@example\\.com$' }),
```

...or, for anything more, pass your own:

```ts
const names = ['Ada', 'Grace', 'Alan', 'Barbara'];
seedRows(users, { count: 4, seed: 1 }).map((r, i) => ({ ...r, name: names[i] ?? r.name }));
```

zmdb ships no faker-style corpus, because that is a lot of data to carry for zero [runtime dependencies](./why-zmdb.html).

## In tests

The value here is that a fixture is derived from the schema, so adding a column does not break every test that built a row by hand:

```ts
const [user] = seedRows(users, { count: 1, seed: 1 });
const created = await repo.create(stripKey(user));
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

---

See also: [Seeding](./seeding.html) · [Testing](./testing.html) · [random()](./validators-misc.html)
