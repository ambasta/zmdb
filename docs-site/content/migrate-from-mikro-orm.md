The hard part of this migration is not syntax, it is the change in model: MikroORM manages your objects, zmdb does not. Plan for the `EntityManager` to disappear rather than to be replaced.

## Entities become schema objects

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
export const users = defineSchema('users', {
  id: serial().primaryKey(),
  email: text().notNull().unique(),
});

export const userRelations = { posts: oneToMany(posts, 'authorId') };
```

The relation lives in a separate map rather than on the class, because there is no class. A read returns `Entity<typeof users>` — a plain object with no `posts` property unless you asked for one.

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

## Things with no replacement, on purpose

`identity map`, `unit of work`, `propagation`, `wrap()`, `metadata cache`, `metadata providers`, `entity constructors during hydration`. Each of these is on the [anti-patterns page](./anti-patterns.html) with the argument, and each of them is why there is no `reflect-metadata` and no boot-time discovery step.

## Things with no replacement, yet

- filters (`@Filter`) — [Entity Filters](./entity-filters.html)
- cascades — [Cascading](./cascading.html)
- `em.upsert` — [Upsert](./upsert.html)
- `qb.stream()` — [Streaming](./streaming.html)
- DataLoader — [DataLoaders](./dataloaders.html)
- `mikro-orm generate-entities` — [pull](./cli-pull.html)

## Config

`MikroORM.init({ entities, dbName, driver })` becomes: construct a [driver](./custom-driver.html) and pass it to repositories. There is no init step, no discovery, and no `mikro-orm.config.ts`. See [Configuration](./configuration.html).

---

See also: [Why fetched rows are inert](./inert-rows.html) · [Repository](./repository.html) · [Anti-patterns](./anti-patterns.html)
