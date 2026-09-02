> **ToDo / feature gap.** Relations carry no cascade configuration. `manyToOne`,
> `oneToMany`, `oneToOne` and `manyToMany` take a target and a foreign-key column
> and nothing else, and `References<…>` records a target with no `ON DELETE` /
> `ON UPDATE` action — it does not reach a generated migration at all, so the
> `REFERENCES` clause is yours to write. Deleting a parent with children raises a
> foreign-key violation from the database.

## Let the database do it

This is the better answer regardless of whether zmdb models it, because the constraint holds against every writer — your application, a migration, a colleague in `psql`:

```ts
const migrations = [
  {
    version: 3,
    name: 'posts_cascade',
    up: `ALTER TABLE "posts"
           DROP CONSTRAINT "posts_author_id_fkey",
           ADD CONSTRAINT "posts_author_id_fkey"
             FOREIGN KEY ("author_id") REFERENCES "authors"("id") ON DELETE CASCADE`,
    down: `ALTER TABLE "posts"
             DROP CONSTRAINT "posts_author_id_fkey",
             ADD CONSTRAINT "posts_author_id_fkey"
               FOREIGN KEY ("author_id") REFERENCES "authors"("id")`,
  },
];
```

The available actions, and what each is actually for:

| Action      | Effect                          | Use it when                                                                             |
| ----------- | ------------------------------- | --------------------------------------------------------------------------------------- |
| `CASCADE`   | delete the children too         | the child has no meaning without the parent (comments on a post)                        |
| `SET NULL`  | null the FK, keep the row       | the child outlives the parent (orders keep their line items when a customer is deleted) |
| `RESTRICT`  | refuse the delete               | the parent should not be deletable while referenced                                     |
| `NO ACTION` | the default; refuse, deferrable | you want the check at commit rather than at statement time                              |

> [!NOTE]
> SQLite enforces foreign keys only if `PRAGMA foreign_keys = ON` is set **per
> connection**. Set it in your driver, or your cascades silently do nothing on
> SQLite and work on Postgres — the worst possible split between test and
> production.

## Or cascade in application code

When the cascade has to do more than delete rows — archive them, emit an event, call a service — do it in a transaction so a partial cascade cannot commit:

```ts
await db.transaction(async () => {
  await commentRepo.deleteWhere({ postId: { eq: id } });
  await postRepo.delete(id);
});
```

`BaseRepository` has `delete(id)` but no bulk `deleteWhere`, so the child step is a compiled statement:

```ts
await driver.execute(createQueryCompiler('postgres').deleteFrom('comments').where('post_id', '=', id).compile());
```

Order matters: children first, then the parent, or the FK rejects the parent delete.

## Persist-cascades have no equivalent either

MikroORM's `cascade: [Cascade.PERSIST]` writes a new parent and its new children from one `flush()`. Here that is two `create` calls in a transaction, and you have the id from the first one:

```ts
await db.transaction(async () => {
  const author = await authorRepo.create({ name: 'Ada' });
  await postRepo.create({ authorId: author.id, title: 'On the Engine' });
});
```

More typing, and the insert order is visible rather than inferred from a graph walk.

## What it would take

Two pieces that can land independently. The DDL half needs the migration format to carry a foreign key first — [it does not today](./composite-keys.html) — and then a second type argument, `References<'users.id', { onDelete: 'cascade' }>`, threading the action through, plus `diff()` recognising a changed action as an operation. The application half is the one that needs a decision — a `cascade` option on a relation implies the repository walks the relation graph on delete, which means a delete issues an unknown number of statements, which is close to the implicit behaviour the [unit-of-work argument](./anti-patterns.html) rejects. The likely outcome is that the DDL half ships and the application half stays explicit.

---

See also: [Relations](./relations.html) · [Transactions](./transactions.html) · [Custom Migrations](./migrations-custom.html)
