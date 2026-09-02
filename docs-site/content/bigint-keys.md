A `bigint` column is a 64-bit integer. The awkward part is not the DDL, it is that JavaScript has two number types and JSON has neither of them.

## Declaring one

```ts
import type { PrimaryKey, Sql, Table } from 'zmdb/tags';

export interface Event extends Table<'events'> {
  id: bigint & Sql<'bigint'> & PrimaryKey;
  payload: { kind: string } & Sql<'json'>;
}
```

```sql
-- postgres / mysql
"id" BIGINT NOT NULL PRIMARY KEY
-- sqlite (INTEGER is already 64-bit)
"id" INTEGER NOT NULL PRIMARY KEY
```

The app type is `bigint`, TypeScript's own arbitrary-precision integer, and that is the whole
point — the column holds values `number` cannot, so the type that represents it must too. A
`number & Sql<'bigint'>` declaration is accepted, and it is a promise you will regret; see the
precision section.

## Auto-incrementing

`Serial` and `Sql<'bigint'>` together mark the column generated — it drops out of
`CreateDTO<Event>`, which is the part your code notices — but the DDL still says `BIGINT`, not
`BIGSERIAL`. Only `Serial` on an `integer` column becomes `SERIAL`. So declare the sequence:

```ts
import { createSequenceDdl } from '@zmdb/query-compiler/schema-objects';

createSequenceDdl({ name: 'events_id_seq', start: 1 }, 'postgres');
```

```sql
ALTER TABLE "events" ALTER COLUMN "id" SET DEFAULT nextval('events_id_seq');
```

See [Sequences](./sequences.html).

## The precision problem, and where it went

`number` loses integer precision above 2^53 − 1 (`Number.MAX_SAFE_INTEGER`, about 9.0 × 10^15). A 64-bit key goes to about 9.2 × 10^18.

> [!WARNING]
> The loss is silent. `9007199254740993` parses to `9007199254740992` and no error is raised
> anywhere. This is why the app type for `Sql<'bigint'>` is `bigint`: the failure had no
> detectable moment, so the fix has to be structural rather than a check.

The one place a `bigint` cannot go is JSON — `JSON.stringify(1n)` throws. So the **wire** type
for a `bigint` column is a `string`, with `format: 'int64'`, and you get that without asking:
it is in the generated JSON Schema, the OpenAPI document and what `wireDecoder` expects. Three
types for one column, each one what that layer can actually carry.

```ts
type Row = Entity<Event>; // { id: bigint; payload: { kind: string } }
// the JSON body:          { "id": "9007199254740993", "payload": { … } }
```

`wireDecoder` converts a decimal string back to a `bigint` on the way in — and only a decimal
string, checked against `/^-?\d+$/` rather than handed to a bare `BigInt()`, because
`BigInt('0x10')` is 16 and `BigInt('')` is 0, neither of which is something a caller meant to
send.

## What drivers do

Drivers disagree, and the disagreement is deliberate on their part:

| Driver           | `BIGINT` arrives as                                               |
| ---------------- | ----------------------------------------------------------------- |
| `node-postgres`  | `string`                                                          |
| `mysql2`         | `string`, unless `supportBigNumbers` + `bigNumberStrings` are off |
| `node:sqlite`    | `number`, or `bigint` if the value exceeds the safe range         |
| `better-sqlite3` | `number`, or `bigint` with `safeIntegers`                         |

So the value your `Driver.execute` returns for a `bigint` column may be a `string`, a `number` or a `bigint` depending on which one you wrote. `Entity<Event>` says `bigint`, so this is the gap you close.

## Close it in the driver

The driver is the right place, because it is the only code that knows which client it wraps:

```ts
const driver: Driver = {
  async execute(q) {
    const res = await pool.query(q.text, [...q.parameters]);
    return res.rows.map(r => ({ ...r, id: BigInt(r.id as string) }));
  },
};
```

One conversion, at the one boundary that knows the client's conventions, rather than a
`typeof` check at every call site. That is also what a [custom driver](./custom-driver.html) is
for.

If you would rather hold the ids as strings — safe, and often enough for a key you only pass
around — declare that instead, and be explicit that arithmetic and ordering are gone:

```ts
export interface Event extends Table<'events'> {
  id: string & Sql<'bigint'> & PrimaryKey;
}
```

Both Postgres and MySQL accept a numeric string for a `BIGINT` parameter, so this works end to end with no codec.

## In `WhereDTO`

The filter value matches the app type, whichever one you declared:

```ts
await repo.findOne({ id: { eq: 9007199254740993n } }); // bigint form
await repo.findOne({ id: { eq: '9007199254740993' } }); // string form
```

The one that does not typecheck is the one that would have silently rounded.

---

See also: [Column Types](./column-types.html) · [Tag Reference](./tags-reference.html) · [Custom Types & Codecs](./custom-types.html) · [Gotchas](./gotchas.html)
