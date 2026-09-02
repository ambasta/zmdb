`created_at` looks trivial and has one decision in it: whether the clock is the database's or your process's.

## Database clock

```ts
import type { HasDefault, PrimaryKey, Serial, Sql, Table } from 'zmdb/tags';

export interface Post extends Table<'posts'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  title: string & Sql<'text'>;
  createdAt: Date & Sql<'timestamp'> & HasDefault;
}
```

`HasDefault` makes `createdAt` optional in `CreateDTO<Post>` and says the database will fill
it. It does not say _with what_ — a type cannot hold a runtime value — so the function name
goes in the [migration](./migrations-custom.html), which is the only place a dialect is
actually chosen:

```sql
ALTER TABLE "posts" ALTER COLUMN "created_at" SET DEFAULT now();
```

One clock for every writer, and it works for inserts from a migration or a `psql` session too. This is the right default.

The function name is dialect-specific:

| Dialect  | Use                                         |
| -------- | ------------------------------------------- |
| Postgres | `now()` — or `clock_timestamp()`, see below |
| MySQL    | `CURRENT_TIMESTAMP`                         |
| SQLite   | `CURRENT_TIMESTAMP`                         |

The declaration is portable across all three; the default expression is not, which is one
argument for keeping it in the migration where it is visible rather than in a schema that
claims to be dialect-neutral.

> [!NOTE]
> In Postgres, `now()` is the **transaction** start time. Every row inserted in one
> transaction gets the same timestamp, which is usually what you want — it makes a
> batch consistent. `clock_timestamp()` is the wall clock and advances per
> statement.

## Application clock

```ts
createdAt: Date & Sql<'timestamp'>;
```

Drop `HasDefault` and the column becomes required in `CreateDTO`, so the compiler asks for
the value:

```ts
await repo.create({ title, createdAt: new Date() });
```

Now every process's clock matters, and clock skew between instances puts rows out of order. Choose this only if you need to backdate rows or to control the timestamp in tests. Freezing the clock in tests is easier with the application clock — but a fixed `now()` via a database session setting is also possible, and testing on the same mechanism you ship is worth more.

## `updated_at`

There is no hook that maintains it in the DDL, and no `ON UPDATE CURRENT_TIMESTAMP` emitted. Two ways:

**A repository hook** — typed, in your code:

```ts
const postSchema = schemaOf<Post>();

class PostRepository extends BaseRepository<typeof postSchema> {
  protected override preUpdate(row: Record<string, unknown>): void {
    row.updatedAt = new Date();
  }
}
```

The hook mutates the payload in place and returns nothing, which is why it runs before the
`SET` clause is built. It applies to writes through this repository only — anything writing
directly to the table bypasses it.

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

**Anything that happened wants `timestamptz`,** and that is what you get: `Sql<'timestamp'>`
emits `TIMESTAMPTZ` on Postgres and `DATETIME(3)` on MySQL. The app type is `Date` on all
three dialects, so the instant is what crosses the boundary rather than a set of digits. The
old builder emitted a bare `TIMESTAMP` and left `timestamptz` to a hand-written migration;
that is no longer a thing you have to remember, because a table of zone-less timestamps
written from servers in different regions cannot be repaired — the information needed to
interpret them was never stored.

SQLite has no date type at all — it stores `TEXT`, and comparisons are lexicographic, so
store ISO-8601 UTC (`2026-08-31T12:00:00Z`) which sorts correctly as text.

Store UTC, convert at the edges, format in the user's zone in the UI. Never store local time.

## Reading them back

node-postgres parses `timestamp`/`timestamptz` to `Date`. mysql2 gives you `Date` or a string depending on configuration. SQLite gives you whatever you stored. So `Entity<Post>` says `Date` and your driver may hand you a string:

```ts
const at = row.createdAt instanceof Date ? row.createdAt : new Date(String(row.createdAt));
```

Normalise in the driver wrapper rather than at every call site — that is what a [custom driver](./custom-driver.html) is for.

---

See also: [Column Types](./column-types.html) · [Tag Reference](./tags-reference.html) · [Custom Migrations](./migrations-custom.html) · [Array and JSON defaults](./guide-array-defaults.html)
