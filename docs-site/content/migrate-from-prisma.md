Prisma's schema lives in its own DSL and its client is generated. zmdb's schema _is_ a TypeScript type and nothing is generated into your repo, so this migration replaces the build step as well as the query API.

## `schema.prisma` → a TypeScript module

```prisma
model User {
  id     Int     @id @default(autoincrement())
  email  String  @unique
  posts  Post[]
}
```

```ts
import { schemaOf } from '@zmdb/schema-core';
import type { OneToMany, PrimaryKey, Serial, Sql, Table, Unique } from 'zmdb/tags';

export interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'text'> & Unique;
  posts?: Post[] & OneToMany<'posts', 'authorId'>;
}

export const userSchema = schemaOf<User>();
```

The mapping is close to line-for-line: `@id` is `PrimaryKey`, `@default(autoincrement())` is `Serial`, `@unique` is `Unique`, `Post[]` is `Post[] & OneToMany<'posts', 'authorId'>`. What Prisma spells with attributes, zmdb spells with intersections.

The consequences of leaving the DSL:

- No `prisma generate`. There is no generated client to be stale, and your editor resolves types from the declaration directly. There _is_ a build step, but it emits nothing into your repository — see [AOT Setup](./aot-setup.html).
- No `@relation` back-reference bookkeeping. Relations are one-directional; declare the sides you actually query.
- Column types are ordinary type aliases, so you can factor them: `type Money = number & Sql<'numeric'> & Numeric<12, 2>`, then `total: Money`.

> [!NOTE]
> The relation _tag_ documents the relationship and reaches the derived documents, but the
> repository's `populate` still needs the runtime `relations` map beside the schema. The two
> are not yet one source. See [Relations](./relations.html).

## Client → repository

| Prisma                                               | zmdb                                                       |
| ---------------------------------------------------- | ---------------------------------------------------------- |
| `prisma.user.findUnique({ where: { id } })`          | `repo.findById(id)`                                        |
| `prisma.user.findFirst({ where })`                   | `repo.findOne(where)`                                      |
| `prisma.user.findMany({ where })`                    | `repo.find(where)`                                         |
| `prisma.user.findMany({ include: { posts: true } })` | `repo.findAll({ populate: ['posts'] })`                    |
| `prisma.user.findMany({ select: { id: true } })`     | `repo.list({ select: ['id'] })`                            |
| `prisma.user.create({ data })`                       | `repo.create(data)`                                        |
| `prisma.user.update({ where, data })`                | `repo.update(id, data)`                                    |
| `prisma.user.delete({ where })`                      | `repo.delete(id)`                                          |
| `prisma.user.upsert(...)`                            | — see [Upsert](./upsert.html)                              |
| `prisma.user.aggregate(...)`                         | `repo.aggregate(spec)`                                     |
| `prisma.$transaction([...])`                         | `batch([...])` — see [Batch API](./batch.html)             |
| `prisma.$transaction(async (tx) => ...)`             | `createTransactionalDb(conn).transaction(...)`             |
| `prisma.$queryRaw`                                   | `driver.execute(compiled)` — see [Raw SQL](./raw-sql.html) |

`select: { id: true }` becoming `select: ['id']` also changes the return type the same way Prisma's does — the row type narrows to the selected keys. See [Projections](./projections.html).

## Filters

Prisma's nested filter objects are close to zmdb's `WhereDTO`:

```ts
// { where: { age: { gte: 18 }, email: { contains: '@x' } } }  ->
{ age: { gte: 18 }, email: { like: '%@x%' } }
```

`contains` / `startsWith` / `endsWith` become `like` with the wildcards written out. `mode: 'insensitive'` becomes `ilike` (Postgres). See [Filters & Operators](./filters.html).

## Migrations

`prisma migrate dev` becomes a [generate script](./cli-generate.html) over a committed snapshot. Both approaches produce SQL files you review and commit; zmdb's diff runs against the snapshot rather than a shadow database, so it needs no second connection and works offline.

`prisma db pull` becomes `zmdb pull`. It reads through the configured driver,
writes generated declarations under `.zmdb/introspected`, refuses to overwrite
a file whose generated header was removed, and offers `--dry-run` and
`--check`; see [pull](./cli-pull.html).

## Where the models went

Prisma returns plain objects too, so this is the one migration where the _shape_ of a result does not change. What changes is that relations are not sometimes-present: if you did not `populate`, the key is absent from the type rather than typed as optional. That turns a class of runtime `undefined` into compile errors.

## Things Prisma has that zmdb does not

- a query engine binary — and therefore its cold-start and its deployment story
- `prisma studio` — see [studio](./cli-studio.html)
- MongoDB — see [MongoDB](./dialect-mongodb.html)
- `@default(cuid())` and friends — generate ids in your code or the database

## Things zmdb has that Prisma does not

- one declaration shared with the DDL, the validator, the OpenAPI document and the HTTP layer — and it is a TypeScript type, so `Omit`, `Pick` and `Partial` compose with it
- SQL you can print without a connection
- no generated code in your repository, no engine to ship

---

See also: [Why zmdb](./why-zmdb.html) · [Repository](./repository.html) · [Migrations](./migrations.html)
