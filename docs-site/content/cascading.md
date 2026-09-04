> **Database actions are supported; application graph cascades remain explicit.**
> `OnDelete<…>` and `OnUpdate<…>` are tags on the column that carries
> `References<…>`. Generated migrations emit and diff the foreign-key
> constraint. Repository deletes do not walk relation objects or persist an
> object graph.

## Declare the database action

```ts
import type { OnDelete, OnUpdate, PrimaryKey, References, Serial, Sql, Table } from 'zmdb/tags';

interface Post extends Table<'posts'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  authorId: number & Sql<'integer'> & References<'authors.id'> & OnDelete<'cascade'>;
  editorId: (number & Sql<'integer'> & References<'users.id'> & OnDelete<'set null'> & OnUpdate<'restrict'>) | null;
}
```

The two actions are independent. Omitting either tag emits `NO ACTION`
explicitly. `OnDelete<'set null'>` is refused on a non-nullable column, and
`'set default'` is refused unless the column has `HasDefault`.

The generated PostgreSQL constraint for `authorId` is:

```sql
ALTER TABLE "posts"
  ADD CONSTRAINT "posts_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "authors" ("id")
  ON DELETE CASCADE ON UPDATE NO ACTION
```

MySQL emits the supporting index before the named constraint:

```sql
CREATE INDEX `posts_authorId_fkey_idx` ON `posts` (`authorId`);
ALTER TABLE `posts`
  ADD CONSTRAINT `posts_authorId_fkey`
  FOREIGN KEY (`authorId`) REFERENCES `authors` (`id`)
  ON DELETE CASCADE ON UPDATE NO ACTION
```

SQLite has no `ALTER TABLE … ADD CONSTRAINT`, so the same action is inline in
the table creation:

```sql
CREATE TABLE "posts" (
  "id" INTEGER PRIMARY KEY,
  "authorId" INTEGER NOT NULL,
  FOREIGN KEY ("authorId") REFERENCES "authors" ("id")
    ON DELETE CASCADE ON UPDATE NO ACTION
)
```

Each `References<'table.column'>` is one single-column constraint. A composite
foreign key is declared explicitly at table level so separate references are
never grouped by guesswork:

```ts
import type { ForeignKey } from 'zmdb/tags';

interface Membership extends Table<'memberships'>, ForeignKey<'tenantId,userId', 'users', 'tenantId,id'> {
  // columns...
}
```

## The available actions

| Action        | Effect                          | Use it when                                                      |
| ------------- | ------------------------------- | ---------------------------------------------------------------- |
| `CASCADE`     | delete the children too         | the child has no meaning without the parent                      |
| `SET NULL`    | null the FK, keep the row       | the child outlives the parent                                    |
| `SET DEFAULT` | write the FK column's default   | the declared default is meaningful; InnoDB does not support this |
| `RESTRICT`    | refuse the delete               | the parent should not be deletable while referenced              |
| `NO ACTION`   | the default; refuse, deferrable | you want the database's default referential behavior             |

## Migration behavior and limits

- PostgreSQL and MySQL create all tables first, then add named constraints.
- MySQL receives a deterministic supporting index immediately before each
  constraint. `SET DEFAULT` is refused because InnoDB does not implement it.
- SQLite emits constraints inline in `CREATE TABLE`. A cycle between newly
  created tables is refused because neither table can be created first.
- SQLite cannot add, drop or change a constraint on an existing table. The diff
  names the constraint and requires a hand-written table rebuild.
- Generated constraint names use `<table>_<column>_fkey`; names longer than
  PostgreSQL's 63-character limit are refused rather than truncated.

The `node:sqlite` adapter runs `PRAGMA foreign_keys = ON` when it wraps a
connection, and the repository E2E proves a real `ON DELETE CASCADE`. A custom
SQLite driver still owns its connection setup.

## Cascade in application code when deletion has side effects

When a cascade also archives rows, emits an event or calls a service, make those
steps explicit in a transaction:

```ts
await db.transaction(async () => {
  await driver.execute(createQueryCompiler('postgres').deleteFrom('comments').where('post_id', '=', id).compile());
  await postRepo.delete(id);
});
```

Order matters: children first, then the parent, unless the database constraint
itself uses `CASCADE`.

## Persist cascades have no equivalent

MikroORM's `cascade: [Cascade.PERSIST]` writes a new parent and its new children
from one `flush()`. Here that is two explicit writes in a transaction:

```ts
await db.transaction(async () => {
  const author = await authorRepo.create({ name: 'Ada' });
  await postRepo.create({ authorId: author.id, title: 'On the Engine' });
});
```

The insert order is visible, and there is no identity-map graph walk hidden
behind the call.

---

See also: [Relations](./relations.html) · [Transactions](./transactions.html) · [Custom Migrations](./migrations-custom.html)
