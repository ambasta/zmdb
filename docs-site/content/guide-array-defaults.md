`json<T>()` holds arrays and objects, and `defaultTo` gives them a default. Two traps: where the default lives, and shared references.

## Declaring one

```ts
import { defineSchema, serial, text, json } from '@zmdb/schema-core';

export const users = defineSchema('users', {
  id: serial().primaryKey(),
  email: text().notNull(),
  tags: json<string[]>().defaultTo([]),
  prefs: json<{ theme: 'light' | 'dark'; digest: boolean }>().defaultTo({ theme: 'dark', digest: true }),
});
```

`tags` and `prefs` are optional in `CreateDTO` because they have defaults, and fully typed in `Entity`. Always supply the type parameter — bare `json()` is `unknown` and forces a cast at every read.

## Where the default is applied

`defaultTo` emits a column `DEFAULT` in the generated DDL, so the database applies it — which means it also applies to rows inserted by anything else, including a migration or a `psql` session. That is the behaviour you want.

> [!WARNING]
> A default only fills a column that is **omitted**. Passing `undefined`
> explicitly is still an omission, but passing `null` is not — it stores `null`
> and you will read `null` from a column your type says is `string[]`.

## The shared-reference trap

```ts
const EMPTY: string[] = [];
tags: json<string[]>().defaultTo(EMPTY),   // careful
```

The schema object holds a reference to that array. Anything that mutates a default read out of the schema mutates it for every row that used it. Since the default is serialised into DDL rather than handed to your rows this is mostly harmless in zmdb — but if you also use the schema for [seeding](./seed-functions.html) or fixtures, pass a fresh literal:

```ts
tags: json<string[]>().defaultTo([]),   // fresh literal, no shared reference
```

Same reasoning as `useState([])` versus a module-level array.

## Reading and writing

The driver returns JSON columns as parsed values in Postgres (`json`/`jsonb`) and as **strings** in MySQL and SQLite. That difference is the driver's, not zmdb's:

```ts
const raw = row.tags;
const tags = typeof raw === 'string' ? assert<string[]>(JSON.parse(raw)) : raw;
```

`assert` rather than a cast, because the column's contents are only as good as whatever last wrote them — including a hand-run `UPDATE` from two years ago. See [Serialization](./serialization.html).

## Appending

There is no expression support in `set()`, so read-modify-write races here exactly as it does for [counters](./guide-increment-decrement.html). Postgres can do it atomically:

```ts
await driver.execute({
  text: `UPDATE "users" SET "tags" = "tags" || $1::jsonb WHERE "id" = $2`,
  parameters: [JSON.stringify([tag]), id],
});
```

Deduplicating requires more SQL, at which point a join table is the better design.

## A real array column instead

Postgres has native `text[]`, and `SqlType` does not include it — the ten types are `serial integer bigint numeric text varchar boolean timestamp json jsonEnum`. So a genuine array column needs a hand-written [migration](./migrations-custom.html) and a `json<string[]>()` declaration that lies slightly about the storage type. It works for reads and writes; DDL generation for that table then has to be yours.

Usually `json` is fine. Where you need `ANY`, `@>` or a GIN index over array elements, take the migration.

## Prefer a join table when you query the contents

```ts
export const userTags = defineSchema('user_tags', {
  userId: references(integer(), users, 'id').notNull(),
  tag: varchar(64).notNull(),
});
```

If you ever filter, group or count by tag, this is the right model — it indexes, it joins, and it does not need JSON operators. Keep `json` for opaque blobs you read whole, like `prefs`.

## Enum-valued arrays

```ts
status: jsonEnum(['draft', 'published', 'archived'] as const).defaultTo('draft'),
```

The `as const` is not optional. Without it the array widens to `string[]` and you get `string` instead of the union — losing the narrowing that was the entire point, silently.

---

See also: [Column Types](./column-types.html) · [JSON Properties](./json-properties.html) · [Timestamp defaults](./guide-timestamp-defaults.html)
