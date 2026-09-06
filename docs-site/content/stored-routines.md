Stored functions and procedures use one `RoutineDef` for typed calls and explicit DDL. Calls validate the declared arguments and results, while routine bodies remain opaque text that migration authors
manage explicitly.

## Call an existing routine

Declare the signature once, then expose the protected repository call through an application-named method:

```ts
import type { RoutineDef } from '@zmdb/query-compiler/schema-objects';
import { BaseRepository, type ArgsOf, type ResultOf } from '@zmdb/repository';

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

class OrdersRepository extends BaseRepository<Order> {
  static readonly schema = OrderSchema;

  archive(args: ArgsOf<typeof archiveOldOrders>): Promise<ResultOf<typeof archiveOldOrders>> {
    return this.call(archiveOldOrders, args);
  }
}
```

`ArgsOf` derives `readonly [Date]` from the parameter declaration. `ResultOf` derives `number`; a procedure derives `void`, and a scalar `setof` function derives a readonly array. Arguments are
checked before SQL is compiled, every value is bound, and returned values are decoded and validated against the same declaration.

Calls made through a repository returned by `withTransaction(tx)` use the transaction connection. zmdb cannot inspect an opaque routine body to discover an internal `COMMIT` or `ROLLBACK`; keep
transaction-controlling procedures outside an outer transaction.

The lower SQL layer is available when validation is deliberately owned elsewhere:

```ts
import { createQueryCompiler } from '@zmdb/query-compiler';

const calls = createQueryCompiler('postgres');
await driver.execute(calls.callFunction('archive_old_orders', [cutoff]));
await driver.execute(calls.callProcedure('rebuild_search_index', []));
```

That layer accepts a string name and `readonly unknown[]`. It quotes the name and binds every value, but it cannot prove that the selected routine or its arguments match a declaration. Do not feed it
a request-selected routine; request-derived values belong through the declared repository call.

### Why validation is a security boundary

Binding protects the outer `SELECT` or `CALL`, not dynamic SQL assembled inside an opaque routine body. A routine created outside zmdb may also run with definer rights, turning permission to call it
into permission to act as its owner. The repository therefore checks the declaration, arity, and app-layer argument types before compiling the call. Routine authors must still parameterize or validate
any dynamic SQL inside the body.

Generated MySQL DDL uses `SQL SECURITY INVOKER`, and the declaration does not offer definer rights. Quoting a request-selected name would prevent identifier injection but would still let the request
choose which privileged program to run, which is why the typed path takes a declared `RoutineDef` rather than a name.

## Manage an opaque body

Use the same declaration from the call site when emitting an explicit migration:

```ts
import { replaceRoutineStatements, routineFingerprint, type RoutineDef } from '@zmdb/query-compiler/schema-objects';
import type { MigrationConnection } from 'zmdb/migrations';

export async function applyArchiveOldOrders(migrationConnection: MigrationConnection, previous: RoutineDef | undefined): Promise<void> {
  const changed = previous === undefined || routineFingerprint(previous) !== routineFingerprint(archiveOldOrders);
  const statements = changed ? replaceRoutineStatements(previous, archiveOldOrders, 'postgres') : [];

  for (const sql of statements) await migrationConnection.exec(sql);
}
```

`routineFingerprint` covers the declaration and strips only trailing whitespace from each line and trailing newlines from the body. With the comparison above, a reindent, comment edit, or keyword case
change produces a different fingerprint and re-emits the routine. zmdb does not parse or otherwise normalize the body.

`createRoutineDdl` returns one driver statement. `replaceRoutineStatements` returns an ordered array because MySQL replacement is `DROP` followed by `CREATE`, and `DELIMITER` is a mysql CLI directive
rather than SQL. Execute each element separately; joining on semicolons breaks routine bodies.

Postgres uses `CREATE OR REPLACE` while the signature is unchanged. A signature change first drops the previous typed signature so it cannot quietly leave an old overload behind. MySQL always drops
then creates, and those two DDL statements are not atomic because MySQL commits DDL implicitly.

Migration snapshots and diffs do not carry `RoutineDef` values. Store the previous declaration with migration state you own, decide where the statements run, and execute the ordered result through a
[custom migration](./migrations-custom.html).

## Dialect behavior

| Dialect     | DDL                                                                             | Calls                                                       |
| ----------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| postgres    | `CREATE OR REPLACE`; tagged dollar quoting and typed replacement                | scalar, procedure and `setof`; typed, validated and bound   |
| cockroach   | inherits Postgres grammar while retaining Cockroach type spellings              | inherits Postgres scalar, procedure and `setof` calls       |
| mysql       | ordered `DROP` + `CREATE`; explicit determinism and invoker security            | scalar and procedure calls; `setof` refused                 |
| singlestore | refuses `RoutineDef` DDL; use a hand-written migration for its distinct grammar | inherited MySQL scalar and procedure calls; `setof` refused |
| sqlite      | refuses                                                                         | refuses                                                     |
| mssql       | refuses                                                                         | refuses                                                     |

Only input parameters are supported: `out` and `inout` are refused. Function returns are scalar SQL types or, on the Postgres family, a `setof` scalar; composite/table returns and overload
declarations are not represented. SQLite has no stored routines, so both DDL and calls fail explicitly rather than being emulated. SQL Server also refuses this surface: its routine grammar and return
shapes are not represented by the current `RoutineDef`. SingleStore calls can target hand-written routines, but its declaration grammar is likewise not represented by `RoutineDef`.

## Deliberate boundaries

| Boundary                       | What it means                                                                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| No body generation or parsing  | The author supplies opaque routine text; zmdb only wraps and fingerprints it.                                                   |
| No signature inference         | Parameters and returns come from `RoutineDef`, not from parsing the body or querying the database.                              |
| No triggers                    | Trigger timing and event semantics are outside the stored-routine surface.                                                      |
| No routine introspection       | Nothing reads routines back from a live catalogue; see [pull (introspect)](./cli-pull.html) for the broader catalogue boundary. |
| No automatic snapshot carriage | Routine ordering and prior declarations remain explicit migration inputs.                                                       |

See also: [Raw SQL](./raw-sql.html) · [Custom Migrations](./migrations-custom.html) · [pull (introspect)](./cli-pull.html)
