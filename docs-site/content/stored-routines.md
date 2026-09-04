> **ToDo / partial support.** Routine declarations, dialect-aware DDL and
> body fingerprints ship. Automatic snapshot/diff carriage and the typed call
> site do not: `CALL` and `SELECT my_fn(...)` still go through raw SQL, with
> arguments and results owned by the caller.

## Declaring and emitting one

`RoutineDef` keeps the signature and body together. The body remains opaque text:

```ts
import { replaceRoutineStatements, routineFingerprint, type RoutineDef } from '@zmdb/query-compiler/schema-objects';
import type { MigrationConnection } from '@zmdb/query-compiler/migrations';

const archiveOldOrders = {
  kind: 'function',
  name: 'archive_old_orders',
  params: [{ name: 'cutoff', type: 'timestamp' }],
  returns: { type: 'integer' },
  language: 'plpgsql',
  body: `DECLARE moved INTEGER;
BEGIN
  WITH m AS (DELETE FROM orders WHERE created_at < cutoff RETURNING *)
  INSERT INTO orders_archive SELECT * FROM m;
  SELECT COUNT(*) INTO moved FROM orders_archive;
  RETURN moved;
END;`,
} as const satisfies RoutineDef;

export async function applyArchiveOldOrders(
  migrationConnection: MigrationConnection,
  previous: RoutineDef | undefined,
): Promise<void> {
  const changed = previous === undefined || routineFingerprint(previous) !== routineFingerprint(archiveOldOrders);
  const statements = changed ? replaceRoutineStatements(previous, archiveOldOrders, 'postgres') : [];

  for (const sql of statements) await migrationConnection.exec(sql);
}
```

`createRoutineDdl` returns one driver statement. `replaceRoutineStatements`
returns an ordered array because MySQL replacement is `DROP` followed by
`CREATE`, and `DELIMITER` is a mysql CLI directive rather than SQL. Execute each
element separately; joining on semicolons breaks routine bodies.

Postgres uses `CREATE OR REPLACE` while the signature is unchanged. A signature
change first drops the previous typed signature so it cannot quietly leave an
old overload behind. MySQL always drops then creates, and those two DDL
statements are not atomic because MySQL commits DDL implicitly.

See [Custom Migrations](./migrations-custom.html). `snapshot()` / `diff()` still
track tables and columns only, so storing the previous declaration and deciding
where these statements run remains the migration author's responsibility.

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

## Dialect behavior

|           | postgres                                           | mysql                                               | sqlite  |
| --------- | -------------------------------------------------- | --------------------------------------------------- | ------- |
| Function  | `CREATE OR REPLACE`, collision-safe dollar quoting | `DROP` + `CREATE`, explicit determinism and invoker | refuses |
| Procedure | `CREATE OR REPLACE PROCEDURE`                      | one driver statement, no `DELIMITER`                | refuses |
| Call      | raw `SELECT fn(...)` / `CALL p(...)`               | raw `SELECT fn(...)` / `CALL p(...)`                | —       |

SQLite has no stored routines at all, which is worth knowing if your tests run on SQLite and production runs on Postgres — a code path that only exists in the procedure is a code path the test suite never executes.

## What remains

The migration snapshot has no accepted routine carriage yet, so routine ordering
is not inferred alongside tables. The typed call site is also still open: it
must derive argument and result types from `RoutineDef`, validate arguments
before dispatch, bind every value, and validate the returned scalar or rows.
Until that lands, keep raw calls behind one reviewed application function.

---

See also: [Raw SQL](./raw-sql.html) · [Custom Migrations](./migrations-custom.html) · [Virtual Entities](./virtual-entities.html)
