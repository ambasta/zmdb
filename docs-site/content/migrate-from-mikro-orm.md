The hard part of this migration is not syntax, it is the change in model: MikroORM manages your objects, zmdb does not. Plan for the `EntityManager` to disappear rather than to be replaced.

If the MikroORM application already has a live database, begin with the
[schema-first adoption path](./schema-first.html): introspect into a staging
directory, review every warning, copy the accepted declarations into
application-owned files, take a baseline snapshot, and keep it accurate with
`detectDrift()` in CI. That is safer than translating hundreds of decorators by
hand before comparing either result with the catalog.

## Entities become declared types

```ts
// MikroORM
@Entity()
export class User {
  @PrimaryKey() id!: number;
  @Property({ unique: true }) email!: string;
  @OneToMany(() => Post, p => p.author) posts = new Collection<Post>(this);
}
```

```ts
// zmdb
import { schemaOf } from '@zmdb/schema-core';
import type { OneToMany, PrimaryKey, Serial, Sql, Table, Unique } from 'zmdb/tags';

export interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'text'> & Unique;
  posts?: Post[] & OneToMany<'posts', 'authorId'>;
}

export const userSchema = schemaOf<User>();
```

Decorator for decorator, the mapping is direct: `@PrimaryKey()` is `PrimaryKey`, `@Property({ unique: true })` is `Unique`, `@OneToMany` is `OneToMany<'posts', 'authorId'>`. What differs is that there is no class and no `Collection` — the relation property is optional and holds a plain array when populated.

A read returns `Entity<User>`: a plain object, with no `posts` property unless you asked for one. `populate: ['posts']` is checked against the tag and batches its query from the same two strings — there is no runtime relations map beside the declaration. See [Relations](./relations.html).

## The EntityManager has no analogue

| MikroORM                          | zmdb                                    |
| --------------------------------- | --------------------------------------- |
| `em.find(User, {...})`            | `repo.find({...})`                      |
| `em.findOne(User, id)`            | `repo.findById(id)`                     |
| `em.persist(u); await em.flush()` | `await repo.create(dto)`                |
| `u.email = 'x'; await em.flush()` | `await repo.update(id, { email: 'x' })` |
| `em.fork()`                       | — nothing to fork                       |
| `wrap(u).init()`                  | — rows are already materialised         |
| `em.getReference(User, id)`       | — pass the id                           |

The middle two rows are the migration. Anywhere you mutate an entity and rely on `flush()` to work out the SQL, you now name the update. That is more typing and it is the point: the write that runs is the write at the call site. See [Unit of work](./anti-patterns.html).

## Collections become arrays you asked for

`user.posts.getItems()` — after `await user.posts.init()`, or implicitly if you were lucky with hydration — becomes:

```ts
const user = await repo.findById(id, { populate: ['posts'] });
user.posts; // Post[], typed, already loaded
```

If you did not pass `populate`, `user.posts` is not `undefined` — it is not in the type at all, so the mistake is a compile error. See [Why fetched rows are inert](./inert-rows.html).

## QueryBuilder becomes the compiler or the DTO

```ts
// MikroORM
const qb = em
  .createQueryBuilder(User)
  .where({ age: { $gte: 18 } })
  .orderBy({ email: 'ASC' });
```

```ts
// zmdb — DTO form, typed per column
await repo.list({ where: { age: { gte: 18 } }, orderBy: [{ column: 'email', dir: 'asc' }] });
```

`$gte` / `$in` / `$like` become `gte` / `in` / `like` and lose the `$`. See [Filters & Operators](./filters.html).

Request-scoped DataLoaders become an explicit `LoaderScope`: construct one at
the request boundary, then use `loaderFor(repo)` for keyed reads or
`relationLoader(repo, relation)` for declared relations. See
[DataLoaders](./dataloaders.html).

## Things with no replacement, on purpose

`identity map`, `unit of work`, `propagation`, `wrap()`, `metadata cache`, `metadata providers`, `entity constructors during hydration`. Each of these is on the [anti-patterns page](./anti-patterns.html) with the argument, and each of them is why there is no `reflect-metadata` and no boot-time discovery step.

## Things with no replacement, yet

- filters (`@Filter`) — [Entity Filters](./entity-filters.html)
- cascades — [Cascading](./cascading.html)
- `em.upsert` — [Upsert](./upsert.html)
- `qb.stream()` — [Streaming](./streaming.html)
- the `mikro-orm generate-entities` command — use the
  [schema-first library workflow](./schema-first.html); command packaging belongs
  to [pull](./cli-pull.html)

## Config

`MikroORM.init({ entities, dbName, driver })` becomes: construct a
[driver](./custom-driver.html) and pass it to repositories. There is no runtime
init or entity discovery. `zmdb.config.ts` exists for build tools and database
commands, not as an application bootstrap. See
[Configuration](./configuration.html).

---

See also: [Why fetched rows are inert](./inert-rows.html) · [Repository](./repository.html) · [Anti-patterns](./anti-patterns.html)
