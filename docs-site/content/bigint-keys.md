`bigint()` maps to a 64-bit integer column. The awkward part is not the DDL, it is that JavaScript's `number` cannot hold every value the column can.

## Declaring one

```ts
export const events = defineSchema('events', {
  id: bigint().primaryKey(),
  payload: json<{ kind: string }>().notNull(),
});
```

```sql
-- postgres / mysql
"id" BIGINT NOT NULL PRIMARY KEY
-- sqlite (INTEGER is already 64-bit)
"id" INTEGER NOT NULL PRIMARY KEY
```

For an auto-incrementing 64-bit key on Postgres you want `BIGSERIAL`, which `bigint()` does not emit. Declare the sequence yourself:

```ts
import { createSequenceDdl } from '@zmdb/query-compiler/schema-objects';

createSequenceDdl({ name: 'events_id_seq', start: 1 }, 'postgres');
// then: id: bigint().primaryKey().defaultTo("nextval('events_id_seq')")
```

See [Sequences](./sequences.html).

## The precision problem

`TsType` for `bigint` is `number`, and `number` loses integer precision above 2^53 − 1 (`Number.MAX_SAFE_INTEGER`, about 9.0 × 10^15). A 64-bit key goes to about 9.2 × 10^18. If your ids will realistically exceed 2^53 you cannot round-trip them through `number`.

> [!WARNING]
> This is silent. `9007199254740993` parses to `9007199254740992` and no error is raised anywhere.

## What drivers do

Drivers disagree, and the disagreement is deliberate on their part:

| Driver           | `BIGINT` arrives as                                               |
| ---------------- | ----------------------------------------------------------------- |
| `node-postgres`  | `string`                                                          |
| `mysql2`         | `string`, unless `supportBigNumbers` + `bigNumberStrings` are off |
| `node:sqlite`    | `number`, or `bigint` if the value exceeds the safe range         |
| `better-sqlite3` | `number`, or `bigint` with `safeIntegers`                         |

So the value your `Driver.execute` returns for a `bigint` column may be a `string`, a `number` or a `bigint` depending on which one you wrote.

## Pick a representation and enforce it in the driver

The driver is the right place, because it is the only code that knows which client it wraps.

**Option A — keep them as strings.** Safe, and the usual answer for ids you only ever pass around:

```ts
import { defineType } from '@zmdb/schema-core/custom-types';

export const bigintId = defineType<string, string>({
  sqlType: 'bigint',
  toDb: v => v,
  fromDb: raw => String(raw),
});
```

Then the column is `text()`-typed in TypeScript but `BIGINT` in the database. You lose arithmetic and comparison ordering in JS; you keep every digit.

**Option B — coerce to `bigint` in the driver.** Correct arithmetic, but `JSON.stringify` throws on `bigint`, so anything that reaches a response needs conversion:

```ts
const driver: Driver = {
  async execute(q) {
    const res = await pool.query(q.text, [...q.parameters]);
    return res.rows.map(r => ({ ...r, id: BigInt(r.id) }));
  },
};
```

**Option C — accept `number` and cap your ids.** Fine if the table will not exceed 2^53 rows, which is most tables. Configure the driver to parse `BIGINT` as a number and move on. Write down the assumption.

## In `WhereDTO`

Whatever you choose, the filter value has to match what the driver sends the database, not what it returns:

```ts
await repo.findOne({ id: { eq: '9007199254740993' } }); // string form
```

Both Postgres and MySQL accept a numeric string for a `BIGINT` parameter, so option A works end to end without a cast.

---

See also: [Column Types](./column-types.html) · [Custom Types & Codecs](./custom-types.html) · [Gotchas](./gotchas.html)
