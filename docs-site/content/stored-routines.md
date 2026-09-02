> **ToDo / feature gap.** There is no DDL emitter for procedures or functions, and
> no typed call site for invoking one. `CALL` and `SELECT my_fn(...)` work through
> raw SQL; nothing about them is derived or checked.

## Creating one today

A procedure is a statement, so it goes in a hand-written migration:

```ts
const migrations = [
  {
    version: 7,
    name: 'archive_old_orders',
    up: `
      CREATE OR REPLACE FUNCTION archive_old_orders(cutoff TIMESTAMP)
      RETURNS INTEGER AS $$
      DECLARE moved INTEGER;
      BEGIN
        WITH m AS (DELETE FROM orders WHERE created_at < cutoff RETURNING *)
        INSERT INTO orders_archive SELECT * FROM m;
        SELECT COUNT(*) INTO moved FROM orders_archive;
        RETURN moved;
      END;
      $$ LANGUAGE plpgsql
    `,
    down: 'DROP FUNCTION IF EXISTS archive_old_orders(TIMESTAMP)',
  },
];
```

See [Custom Migrations](./migrations-custom.html). Note that `snapshot()` / `diff()` track tables and columns only, so the routine is entirely your responsibility to version.

## Calling one

Wrap it in a function that owns the SQL and validates what comes back. That gives you one place to change if the signature moves, and a real type on the way out:

```ts
import { assert } from '@zmdb/aot-validator/utilities';

export async function archiveOldOrders(driver: Driver, cutoff: Date): Promise<number> {
  const rows = await driver.execute({
    text: 'SELECT archive_old_orders($1) AS moved',
    parameters: [cutoff],
  });
  const [row] = rows;
  return assert<{ moved: number }>(row).moved;
}
```

For a procedure with no result:

```ts
await driver.execute({ text: 'CALL rebuild_search_index()', parameters: [] });
```

For a set-returning function, treat it as a relation — give it a [schema object](./virtual-entities.html) and validate the rows:

```ts
const rows = await driver.execute({ text: 'SELECT * FROM active_users($1)', parameters: [orgId] });
return rows.map(r => assert<Entity<User>>(r));
```

## Dialect differences you have to handle yourself

|           | postgres                               | mysql                               | sqlite |
| --------- | -------------------------------------- | ----------------------------------- | ------ |
| Function  | `CREATE FUNCTION ... LANGUAGE plpgsql` | `CREATE FUNCTION ... DETERMINISTIC` | none   |
| Procedure | `CREATE PROCEDURE`                     | `CREATE PROCEDURE`                  | none   |
| Call      | `SELECT fn(...)` / `CALL p(...)`       | `SELECT fn(...)` / `CALL p(...)`    | —      |

SQLite has no stored routines at all, which is worth knowing if your tests run on SQLite and production runs on Postgres — a code path that only exists in the procedure is a code path the test suite never executes.

## What it would take

An emitter is easy: `createRoutineDdl({ name, args, returns, body, language }, dialect)` alongside the other [schema-object emitters](./indexes-constraints.html), plus `dropRoutineDdl`.

The typed call site is the real work. To make `call(archiveOldOrders, cutoff)` type-check you need the routine's signature at the type level, which means either declaring it twice (in the DDL body and in a TypeScript signature — the drift problem zmdb exists to avoid) or parsing the SQL body during the build. Neither is obviously right, so the emitter would probably land first and calls would stay explicit.

---

See also: [Raw SQL](./raw-sql.html) · [Custom Migrations](./migrations-custom.html) · [Virtual Entities](./virtual-entities.html)
