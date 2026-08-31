`created_at` looks trivial and has one decision in it: whether the clock is the database's or your process's.

## Database clock

```ts
import { defineSchema, serial, text, timestamp } from '@zmdb/schema-core';

export const posts = defineSchema('posts', {
  id: serial().primaryKey(),
  title: text().notNull(),
  createdAt: timestamp().defaultTo('now()').notNull(),
});
```

`defaultTo('now()')` emits `DEFAULT now()` in the DDL, so the database stamps the row. One clock for every writer, and it works for inserts from a migration or a `psql` session too. This is the right default.

The function name is dialect-specific, and the string is passed through:

| Dialect  | Use                                         |
| -------- | ------------------------------------------- |
| Postgres | `now()` — or `clock_timestamp()`, see below |
| MySQL    | `CURRENT_TIMESTAMP`                         |
| SQLite   | `CURRENT_TIMESTAMP`                         |

`now()` is not portable, so a schema targeting more than one dialect needs a value per dialect or the application clock instead.

> [!NOTE]
> In Postgres, `now()` is the **transaction** start time. Every row inserted in one
> transaction gets the same timestamp, which is usually what you want — it makes a
> batch consistent. `clock_timestamp()` is the wall clock and advances per
> statement.

## Application clock

```ts
createdAt: timestamp().notNull(),
```

```ts
await repo.create({ title, createdAt: new Date() });
```

Now every process's clock matters, and clock skew between instances puts rows out of order. Choose this only if you need to backdate rows or to control the timestamp in tests. Freezing the clock in tests is easier with the application clock — but a fixed `now()` via a database session setting is also possible, and testing on the same mechanism you ship is worth more.

## `updated_at`

There is no hook that maintains it in the DDL, and no `ON UPDATE CURRENT_TIMESTAMP` emitted. Two ways:

**A repository hook** — typed, in your code:

```ts
class PostRepository extends BaseRepository<typeof posts> {
  protected override preUpdate(row: UpdateDTO<typeof posts>) {
    return { ...row, updatedAt: new Date() };
  }
}
```

Applies to writes through this repository only. Anything writing directly to the table bypasses it.

**A trigger** — in a [custom migration](./migrations-custom.html):

```sql
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER posts_touch BEFORE UPDATE ON posts
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
```

Applies to every writer. MySQL has it built in: `updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`.

Pick the trigger if correctness across all writers matters; pick the hook if you want it visible in TypeScript.

## Time zones

The one that causes data loss. Postgres has two types:

- `timestamp` — no time zone. Stores wall-clock digits with no offset, so `12:00` is meaningless without knowing where.
- `timestamptz` — stores an instant, converting on the way in and out.

**Use `timestamptz` for anything that happened.** `timestamp()` in zmdb emits `TIMESTAMP`; for `timestamptz` you need a [custom migration](./migrations-custom.html) for the column type. Do it — a table of `timestamp` columns written from servers in different zones cannot be repaired, because the information needed to interpret them was never stored.

MySQL's `DATETIME` has no zone and `TIMESTAMP` converts using the session zone. SQLite has no date type at all — it stores text or a number, and comparisons are lexicographic, so store ISO-8601 UTC (`2026-08-31T12:00:00Z`) which sorts correctly as text.

Store UTC, convert at the edges, format in the user's zone in the UI. Never store local time.

## Reading them back

node-postgres parses `timestamp`/`timestamptz` to `Date`. mysql2 gives you `Date` or a string depending on configuration. SQLite gives you whatever you stored. So `Entity<S>` says `Date` and your driver may hand you a string:

```ts
const at = row.createdAt instanceof Date ? row.createdAt : new Date(String(row.createdAt));
```

Normalise in the driver wrapper rather than at every call site — that is what a [custom driver](./custom-driver.html) is for.

---

See also: [Column Types](./column-types.html) · [Custom Migrations](./migrations-custom.html) · [Array and JSON defaults](./guide-array-defaults.html)
