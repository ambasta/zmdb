A `json` column holds arrays and objects, and its shape is part of the declaration. Two things to get right: where the default value lives, and what `HasDefault` does and does not say.

## Declaring one

```ts
import type { HasDefault, PrimaryKey, Serial, Sql, Table } from 'zmdb/tags';

interface Preferences {
  theme: 'light' | 'dark';
  digest: boolean;
}

export interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'text'>;
  tags: string[] & Sql<'json'> & HasDefault;
  prefs: Preferences & Sql<'json'> & HasDefault;
}
```

`tags` and `prefs` are optional in `CreateDTO` because they say `HasDefault`, and fully typed in `Entity` — `row.prefs.theme` is `'light' | 'dark'`, not `unknown`.

The shape is on the property, so there is nothing to remember to supply. `json<T>()` used to take its payload as a type argument you could simply omit, and a bare `json()` gave you `unknown` and a cast at every read. That failure mode is gone: a `json` column's type is the type you wrote.

## Where the default value lives

**Not in the schema.** `HasDefault` says the column _has_ a default, not _which one_, and it cannot say which one: a default is a runtime value and no type holds one.

So write it in the [migration](./migrations-custom.html), where the DDL is written anyway:

```sql
ALTER TABLE "users" ALTER COLUMN "tags" SET DEFAULT '[]'::jsonb;
ALTER TABLE "users" ALTER COLUMN "prefs" SET DEFAULT '{"theme":"dark","digest":true}'::jsonb;
```

The database applies it, which means it also applies to rows inserted by anything else — a migration, a `psql` session, another service. That is the behaviour you want, and it is why this is the right home for the value rather than a consolation prize.

> [!WARNING]
> A default only fills a column that is **omitted**. Passing `undefined` explicitly is still an omission, but passing `null` is not — it stores `null`, and you will read `null` from a column your type says is `string[]`.

## The shared-reference trap is gone

The old `defaultTo([])` put a real array into the schema object, and anything that mutated a default read back out of the schema mutated it for every row that had used it — the `useState([])` versus a module-level array problem, one layer down.

There is nothing to share now. `HasDefault` is a phantom symbol slot that
disappears at compile time, so the schema carries no array to alias. Older
`defineSchema` code can still contain mutable defaults; the
[codemod](./codemod.html) reports each one it removes.

## Reading and writing

The driver returns JSON columns as parsed values in Postgres (`json`/`jsonb`) and as **strings** in MySQL, SQLite and SQL Server. That difference is the driver's, not zmdb's:

```ts
const raw = row.tags;
const tags = typeof raw === 'string' ? assert<string[]>(JSON.parse(raw)) : raw;
```

`assert` rather than a cast, because the column's contents are only as good as whatever last wrote them — including a hand-run `UPDATE` from two years ago. See [Serialization](./serialization.html).

## Appending

The closed `set()` expression vocabulary has no JSON or array-append variant, so read-modify-write still races
here exactly as it does for counters outside the supported [`inc()` form](./guide-increment-decrement.html).
Postgres can append atomically:

```ts
await driver.execute({
  text: `UPDATE "users" SET "tags" = "tags" || $1::jsonb WHERE "id" = $2`,
  parameters: [JSON.stringify([tag]), id],
});
```

Deduplicating requires more SQL, at which point a join table is the better design.

## A real array column instead

Postgres has native `text[]`, and `SqlType` does not include it — the ten types are `serial integer bigint numeric text varchar boolean timestamp json jsonEnum`. So a genuine array column needs a hand-written [migration](./migrations-custom.html) and a `Sql<'json'>` declaration that lies slightly about the storage type. It works for reads and writes; DDL generation for that table then has to be yours.

Usually `json` is fine. Where you need `ANY`, `@>` or a GIN index over array elements, take the migration.

## Prefer a join table when you query the contents

```ts
import type { Length, PrimaryKey, References, Sql, Table } from 'zmdb/tags';

export interface UserTag extends Table<'user_tags'> {
  userId: number & Sql<'integer'> & References<'users.id'> & PrimaryKey;
  tag: string & Sql<'varchar'> & Length<64> & PrimaryKey;
}
```

If you ever filter, group or count by tag, this is the right model — it indexes, it joins, and it does not need JSON operators. Two `PrimaryKey` tags say composite, which is what stops the same tag being attached twice — though the DDL emitter does not yet write that as one table constraint, so this table wants a [hand-written migration](./migrations-custom.html); see [Composite Keys](./composite-keys.html). Keep `json` for opaque blobs you read whole, like `prefs`.

## Enum-valued columns

```ts
status: ('draft' | 'published' | 'archived') & HasDefault;
```

A literal union, and that is all. There is no `jsonEnum` tag and no `as const` to forget: the old `jsonEnum(['draft', 'published'] as const)` widened to `string[]` without the `as const`, silently giving you `string` instead of the union and losing the narrowing that was the entire point. A union type cannot widen by accident.

---

See also: [Column Types](./column-types.html) · [JSON Properties](./json-properties.html) · [Timestamp defaults](./guide-timestamp-defaults.html)
