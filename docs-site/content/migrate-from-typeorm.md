TypeORM's Active Record and Data Mapper patterns both assume entity instances with behaviour. zmdb has neither, so the migration is a rewrite of the data layer's shape, not a find-and-replace.

## Entity class → entity interface

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
import type { HasDefault, PrimaryKey, Serial, Sql, Table, Unique } from 'zmdb/tags';

export interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'text'> & Unique;
  createdAt: Date & Sql<'timestamp'> & HasDefault;
}
```

The decorators become intersection tags on the property, and the class becomes an
`interface`. The differences that will bite during a port:

- **There is no value here.** `User` is a type; `schemaOf<User>()` is what produces the
  schema value a repository takes, and it is compiled away at build time.
- **No `@Column` needed.** Every property is a column unless its type is a relation.
- **Nullability is `| null`**, not an option object — and the tags go _inside_ the
  parentheses: `(Date & Sql<'timestamp'>) | null`.
- **`HasDefault` says the column _has_ a default, not which one.** A default is a runtime
  value and no type holds one, so `now()` lives in the migration.

`@CreateDateColumn` / `@UpdateDateColumn` have no equivalent. `createdAt` is `HasDefault` plus a `SET DEFAULT now()` in the DDL; `updatedAt` is either a database trigger or a value you set in a [lifecycle hook](./lifecycle-hooks.html) — explicitly, in your code, where you can test it. See [Timestamp defaults](./guide-timestamp-defaults.html).

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
import type { ManyToOne, OneToMany } from 'zmdb/tags';

export interface Post extends Table<'posts'> {
  authorId: number & Sql<'integer'> & References<'users.id'>;
  author?: User & ManyToOne<'users', 'authorId'>;
  comments?: Comment[] & OneToMany<'comments', 'postId'>;
}
```

The tag carries the target table and the column holding the join; cardinality comes from the
declared type — `User & …` is to-one, `Comment[] & …` is to-many — so there is nothing to
decode and nothing that can disagree with the property. Make relation properties optional:
`Entity<T>` excludes them, and a row only has one when you asked for it. There is nothing else to
wire: `populate: ['author']` checks the key against the declaration and batches its query from
the same tag.

`eager: true` has no equivalent — that is lazy loading with the switch flipped, and both are excluded. Ask for what you want with `populate`. See [Loading Strategies](./loading-strategies.html).

`cascade: true` also has no equivalent yet — see [Cascading](./cascading.html).

## Migrations

TypeORM's `migration:generate` diffs entities against the live database. zmdb diffs the declarations against a **committed snapshot file**, and never reads the database to work out what to do:

```ts
const ops = diff(
  JSON.parse(readFileSync('migrations/snapshot.json', 'utf8')),
  snapshot([schemaOf<User>(), schemaOf<Post>()]),
);
```

That means generation works offline and in CI, and the snapshot is a reviewable
artefact in the diff. A separate library workflow can now read the live catalog
and emit declarations, but the complete drift reporter and `check` command have
not landed; see [pull](./cli-pull.html).

## `synchronize: true` has no equivalent

Emitting DDL directly from the declarations is [push](./cli-push.html), and it is a script you run knowingly, not a config flag that runs at boot.

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
