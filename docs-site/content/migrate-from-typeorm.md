TypeORM's Active Record and Data Mapper patterns both assume entity instances with behaviour. zmdb has neither, so the migration is a rewrite of the data layer's shape, not a find-and-replace.

## Entity → schema object

```ts
// TypeORM
@Entity()
export class User extends BaseEntity {
  @PrimaryGeneratedColumn() id: number;
  @Column({ unique: true }) email: string;
  @CreateDateColumn() createdAt: Date;
}
```

```ts
// zmdb
export const users = defineSchema('users', {
  id: serial().primaryKey(),
  email: text().notNull().unique(),
  createdAt: timestamp().notNull().defaultTo('now()'),
});
```

`@CreateDateColumn` / `@UpdateDateColumn` have no decorator equivalent. `createdAt` is a default in the DDL; `updatedAt` is either a database trigger or a value you set in a [lifecycle hook](./lifecycle-hooks.html) — explicitly, in your code, where you can test it.

## Repository

TypeORM's `Repository<T>` is the closest thing in either library, so this part maps cleanly:

| TypeORM                                       | zmdb                                           |
| --------------------------------------------- | ---------------------------------------------- |
| `repo.findOneBy({ id })`                      | `repo.findById(id)`                            |
| `repo.find({ where: { age: MoreThan(18) } })` | `repo.find({ age: { gt: 18 } })`               |
| `repo.find({ relations: ['posts'] })`         | `repo.findAll({ populate: ['posts'] })`        |
| `repo.save(entity)`                           | `repo.create(dto)` or `repo.update(id, patch)` |
| `repo.remove(entity)`                         | `repo.delete(id)`                              |
| `repo.createQueryBuilder()`                   | `createQueryCompiler(dialect)`                 |

`save()` splitting into `create` and `update` is deliberate: `save` decides insert-versus-update from whether the id is set, which is exactly the ambiguity that produces accidental inserts.

## Active Record goes away

`User.find()`, `user.save()`, `user.remove()` have no equivalent. Rows are plain objects with no methods. See [Why fetched rows are inert](./inert-rows.html).

## Relations

`@ManyToOne` / `@OneToMany` / `@JoinTable` become entries in a relations map:

```ts
export const postRelations = { author: manyToOne(users, 'authorId') };
export const userRelations = { posts: oneToMany(posts, 'authorId') };
```

`eager: true` has no equivalent — that is lazy loading with the switch flipped, and both are excluded. Ask for what you want with `populate`. See [Loading Strategies](./loading-strategies.html).

`cascade: true` also has no equivalent yet — see [Cascading](./cascading.html).

## Migrations

TypeORM's `migration:generate` diffs entities against the live database. zmdb diffs schema objects against a **committed snapshot file**, and never reads the database to work out what to do:

```ts
const ops = diff(JSON.parse(readFileSync('migrations/snapshot.json', 'utf8')), snapshot([users, posts]));
```

That means generation works offline and in CI, and it means the snapshot is a reviewable artefact in the diff. It also means zmdb cannot detect drift a human made by hand — see [pull](./cli-pull.html).

## `synchronize: true` has no equivalent

Emitting DDL directly from schema objects is [push](./cli-push.html), and it is a script you run knowingly, not a config flag that runs at boot.

## Connection / DataSource

`new DataSource({...}).initialize()` becomes a `Driver`:

```ts
const driver: Driver = { execute: q => pool.query(q.text, [...q.parameters]).then(r => r.rows) };
```

Pooling, retries and TLS are your pool's job, not the ORM's. See [Writing a Driver](./custom-driver.html).

## Things TypeORM has that zmdb does not

- tree entities (`@Tree`) — model it yourself; there is no closure-table generator
- soft delete (`@DeleteDateColumn`, `withDeleted`) — see [Entity Filters](./entity-filters.html)
- subscribers with entity instances — see [Lifecycle Hooks](./lifecycle-hooks.html) for the data-shaped version
- `@Index` on the entity — indexes are DDL, see [Indexes & Constraints](./indexes-constraints.html)

---

See also: [Repository](./repository.html) · [Migrations](./migrations.html) · [Anti-patterns](./anti-patterns.html)
