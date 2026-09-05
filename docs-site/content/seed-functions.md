`@zmdb/repository/seeding` generates rows that satisfy a schema, from a seed you choose, so the same seed produces the same data.

## Generating rows

```ts
import { seedRows } from '@zmdb/repository/seeding';
import { userSchema } from './schema.js';

const rows = seedRows(userSchema, { count: 50, seed: 1 });
// CreateDTO<User>[]
```

Every column gets a value that satisfies its **declaration**, not merely its SQL type: the row is assembled from the column's IR by the same sampler [`random<T>()`](./random.html) uses, so
`Min`/`Max`, `MinLength`/`MaxLength`, a string-literal union's members and a `json` column's payload shape all reach the generator. Same seed, same rows — which is what makes a seeded test
reproducible and a seeded failure debuggable.

> [!NOTE] This is a change from the generator that lived in `@zmdb/schema-core/seeding`. That one read `ColumnMeta.type` and two flags and nothing else, so a constrained column got a value that often
> violated the constraint and `repo.create` then rejected the row. It also returned `Record<string, unknown>[]`, which every call site had to cast. Both were the same defect — a second, weaker value
> generator beside the one the validator emits — and both went away when `seedRows` became a loop over that one.

Auto-increment and defaulted columns are **omitted**, so the shape and the static type are both `CreateDTO<T>` and the rows go straight into `repo.create`.

## Inserting them

`seedRows` returns data; writing it is a separate step, because the generator has no connection:

```ts
for (const row of seedRows(userSchema, { count: 50, seed: 1 })) {
  await repo.create(row);
}
```

Fifty round trips. For a large seed, batch through the compiler instead:

```ts
const q = createQueryCompiler('postgres').insertInto('users').values(rows).compile();
await driver.execute(q);
```

> [!NOTE] There is no `id` to strip. `CreateDTO<T>` has no auto-increment column and treats a defaulted one as optional, and `seedRows` generates the required properties only — the row it hands you is
> already the `create` shape. Passing a generated `id` would be rejected anyway — the repository refuses a supplied serial column.

## The RNG on its own

`makeRng(seed)` is the deterministic generator underneath, and it is exported because a seed script usually needs more than rows — picking a random existing id, choosing a category, deciding whether
an optional field is set:

```ts
import { makeRng, seedRows } from '@zmdb/repository/seeding';

const rng = makeRng(42);
const pick = <T>(xs: readonly [T, ...T[]]): T => xs[Math.floor(rng() * xs.length)] ?? xs[0];

const authorIds = (await authorRepo.findAll()).map(a => a.id);
for (const post of seedRows(postSchema, { count: 500, seed: 42 })) {
  await postRepo.create({ ...post, authorId: pick(authorIds) });
}
```

Using the same seed for `makeRng` and `seedRows` keeps the whole script reproducible, including the join keys.

## Respecting foreign keys

A `References<'authors.id'>` column gets a value of the right _type_, not an id that exists. Seed in dependency order and substitute real keys:

```ts
const authors = [];
for (const a of seedRows(authorSchema, { count: 10, seed: 1 })) {
  authors.push(await authorRepo.create(a));
}

for (const p of seedRows(postSchema, { count: 100, seed: 2 })) {
  await postRepo.create({ ...p, authorId: pick(authors).id });
}
```

There is no relation-aware seeding that does this for you — see below.

## Realistic values

The generator produces values that satisfy the declaration, not values that look like names. Override the field:

```ts
const names = ['Ada', 'Grace', 'Alan', 'Barbara'];
seedRows(userSchema, { count: 4, seed: 1 }).map((r, i) => ({ ...r, name: names[i] ?? r.name }));
```

zmdb ships no faker-style corpus, because that is a lot of data to carry for zero [runtime dependencies](./why-zmdb.html).

## A column it will not guess

`Pattern<…>` is a refusal rather than a wrong value — nothing here inverts a regular expression:

```
cannot sample `.slug`: a sample cannot be built from a pattern
```

Write that column yourself, or keep the pattern off it and check the value at the boundary that receives one. [`random()`](./random.html) lists the rest.

## In tests

The value here is that a fixture is derived from the schema, so adding a column does not break every test that built a row by hand:

```ts
const [user] = seedRows(userSchema, { count: 1, seed: 1 });
const created = await repo.create(user);
```

Use a distinct seed per test so one test's data cannot make another pass. See [Testing](./testing.html).

## Random values from a type

For a payload that is not a table row, `random<T>()` in the validator does the same job against an arbitrary type:

```ts
import { random } from '@zmdb/aot-validator/utilities';

const body = random<CreateUserRequest>();
```

Needs the transformer. See [AOT Setup](./aot-setup.html). The seed does not reach it: a transformed `random<T>()` is an inlined expression over `Math.random`, and the seeded path is `seedRows`, which
calls the sampler at runtime with a generator of its own.

## What is missing

**Relation-aware seeding.** No `seedGraph([authors, posts], relations)` that fills foreign keys with keys it just inserted. The manual version above is five lines, so this is convenience rather than
capability.

**Insertion.** No `seed(driver, schema, opts)` — the generator deliberately has no I/O, which is why it works in a test with no database.

**Optional columns.** `seedRows` generates the required properties of `CreateDTO<T>` and leaves the optional ones absent, which is a defensible default (a defaulted column should get its default) but
not a choice you can make per run.

---

See also: [Seeding](./seeding.html) · [Testing](./testing.html) · [random()](./validators-misc.html)
