> **ToDo / partial support.** Routine declarations, dialect-aware DDL, body
> fingerprints, and typed validated calls ship. Automatic snapshot/diff
> carriage does not, so migration authors still decide where routine statements
> run.

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

Expose the protected repository call through an application-named method:

```ts
import type { RoutineDef } from '@zmdb/query-compiler/schema-objects';
import { BaseRepository, type ArgsOf, type ResultOf } from '@zmdb/repository';

class OrdersRepository extends BaseRepository<Order> {
  static readonly schema = OrderSchema;

  archive(args: ArgsOf<typeof archiveOldOrders>): Promise<ResultOf<typeof archiveOldOrders>> {
    return this.call(archiveOldOrders, args);
  }
}
```

`ArgsOf` derives `readonly [Date]` from the parameter declaration.
`ResultOf` derives `number`; a procedure derives `void`, and a scalar `setof`
function derives a readonly array. Arguments are checked before SQL is compiled,
every value is bound, and returned values are decoded and validated against the
same declaration.

The lower SQL layer is available when validation is deliberately owned
elsewhere:

```ts
import { createQueryCompiler } from '@zmdb/query-compiler';

const calls = createQueryCompiler('postgres');
await driver.execute(calls.callFunction('archive_old_orders', [cutoff]));
await driver.execute(calls.callProcedure('rebuild_search_index', []));
```

That layer accepts a string name and `unknown[]`, so do not feed it a
request-selected routine. Request-derived values belong through the declared
repository call.

Calls made through a repository returned by `withTransaction(tx)` use the
transaction connection. zmdb cannot inspect an opaque routine body to discover
an internal `COMMIT` or `ROLLBACK`; keep transaction-controlling procedures
outside an outer transaction.

## Dialect behavior

|                    | postgres                                           | mysql                                               | sqlite  |
| ------------------ | -------------------------------------------------- | --------------------------------------------------- | ------- |
| Function DDL       | `CREATE OR REPLACE`, collision-safe dollar quoting | `DROP` + `CREATE`, explicit determinism and invoker | refuses |
| Procedure DDL      | `CREATE OR REPLACE PROCEDURE`                      | one driver statement, no `DELIMITER`                | refuses |
| Scalar / procedure | typed, validated, bound                            | typed, validated, bound                             | refuses |
| Scalar `setof`     | typed as a readonly array                          | refuses                                             | refuses |

SQLite has no stored routines at all, which is worth knowing if your tests run on SQLite and production runs on Postgres — a code path that only exists in the procedure is a code path the test suite never executes.

## What remains

The migration snapshot has no accepted routine carriage yet, so routine ordering
is not inferred alongside tables. Store the previous declaration with the
migration state you own and execute the ordered statements returned by
`replaceRoutineStatements`.

---

See also: [Raw SQL](./raw-sql.html) · [Custom Migrations](./migrations-custom.html) · [Virtual Entities](./virtual-entities.html)
