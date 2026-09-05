Supported dialect: `'mssql'`. The compiler emits T-SQL, migrations cover the modeled SQL Server DDL, and the repository ships a thin adapter for an already-connected
[`mssql`](https://www.npmjs.com/package/mssql) pool. The adapter does not open, close or configure that pool.

```ts
import sql from 'mssql';
import { createQueryCompiler } from '@zmdb/query-compiler';
import { mssqlDriver } from '@zmdb/repository/drivers/mssql';

const pool = await sql.connect(process.env.DATABASE_URL!);
const driver = mssqlDriver(pool);
const query = createQueryCompiler('mssql').selectFrom('users').where('email', '=', 'a@b.com').compile();

const rows = await driver.execute(query);
```

The compiler keeps `parameters` positional. The adapter maps array element zero to `p1`, element one to `p2`, and so on; `mssql` receives those names without the leading `@`.

## SQL contract

| Construct              | Emitted SQL / behavior                                              | Caveat                                                         |
| ---------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------- |
| identifiers            | `[name]`; a closing `]` is escaped as `]]`                          | each qualified-name segment is quoted separately               |
| placeholders           | `@p1`, `@p2`, …                                                     | the adapter binds `p1`, `p2`, … from the positional array      |
| parameter budget       | repository IN lists use the dialect's 2,000-parameter ceiling       | SQL Server's batch limit is 2,100                              |
| pagination             | `OFFSET … ROWS FETCH NEXT … ROWS ONLY` after an explicit `ORDER BY` | unordered pagination is refused                                |
| insert/update rows     | `OUTPUT INSERTED.…` in the verb-specific middle of the statement    | enabled triggers can require an `OUTPUT … INTO` shape          |
| deleted rows           | `OUTPUT DELETED.…`                                                  | the public builder does not request pre-update rows            |
| upsert                 | one terminated `MERGE … WITH (HOLDLOCK)` statement                  | an explicit conflict target is required                        |
| auto-increment         | `INT IDENTITY(1,1)`                                                 | there is no abstract `uuid` type                               |
| booleans               | `BIT`; `not()` emits bitwise `~`                                    |                                                                |
| timestamp              | `DATETIMEOFFSET(3)`                                                 | preserves a JavaScript `Date` instant at millisecond precision |
| text / JSON storage    | `NVARCHAR(MAX)`                                                     | JSON is text storage, not a native JSON column                 |
| string concatenation   | `CONCAT(column, @pN)`                                               | `CONCAT(NULL, 'x')` returns `'x'`                              |
| column migrations      | `ADD`; `ALTER COLUMN … NULL\|NOT NULL`; `DROP COLUMN`               | altering a type must carry nullability                         |
| referential `RESTRICT` | `NO ACTION`                                                         | T-SQL has no `RESTRICT` spelling                               |

A paginated SQL Server select without `.orderBy(...)` is refused at `compile()`. The compiler does not invent `ORDER BY (SELECT NULL)`, because that would make the query legal without making its pages
reproducible.

`returning()` maps to the correct `OUTPUT` pseudo-table for insert, update and delete. SQL Server rejects `OUTPUT` without `INTO` when an enabled trigger exists for that DML action. zmdb cannot
inspect target-table triggers, and `OUTPUT … INTO` would require a table variable and another statement, so triggered tables must use a hand-written path.

## Upsert locking

SQL Server upserts compile to `MERGE` with an explicit conflict target:

```sql
MERGE [users] WITH (HOLDLOCK) AS tgt
USING (VALUES (@p1, @p2)) AS src ([email], [role])
ON tgt.[email] = src.[email]
WHEN MATCHED THEN UPDATE SET [role] = src.[role]
WHEN NOT MATCHED THEN INSERT ([email], [role])
VALUES (src.[email], src.[role]);
```

`HOLDLOCK` closes the absent-key race between concurrent upserts by taking serializable range locks on the target. That correctness has a cost: hot-key workloads can block longer or deadlock. SQL
Server error `1205` is classified as retryable metadata, but a transaction is retried only when the caller opts into the transaction retry policy. Keep external side effects out of a retrying
callback.

## Types and migrations

All ten `SqlType` members have an explicit SQL Server mapping. `varchar` uses `NVARCHAR(n)` with `Length<n>` and `NVARCHAR(MAX)` without one. `timestamp` uses `DATETIMEOFFSET(3)`, preserving the
instant and JavaScript `Date` millisecond precision.

There is no `uuid` member in `SqlType`, so the dialect does not invent a `UNIQUEIDENTIFIER` mapping. Use `Sql<'varchar'> & Length<36>` for an application-generated GUID, or a custom migration when the
native type is required.

Generated migrations cover table creation and removal, add/drop/alter column, named foreign keys, indexes including filtered indexes, sequences and persisted computed columns.

## Refusals and boundaries

| Requested construct                            | Current result / alternative                                                       |
| ---------------------------------------------- | ---------------------------------------------------------------------------------- |
| pagination without `ORDER BY`                  | refused; add `.orderBy(...)`                                                       |
| upsert without a conflict target               | refused; `MERGE` needs an explicit join predicate                                  |
| `OUTPUT` on an enabled-trigger target          | the server can reject it; use a hand-written `OUTPUT … INTO` path                  |
| materialized view                              | refused; SQL Server indexed views need a different declaration shape               |
| row-level-security policy                      | refused; predicate functions and security policies are not represented             |
| full-text search                               | refused; the schema cannot declare the required catalog and index                  |
| schema introspection                           | refused; use declared schemas or a hand-written catalog query                      |
| stored-routine calls or `RoutineDef` DDL       | refused; SQL Server's `CREATE`/`ALTER` and `EXEC` shapes are not modeled           |
| database extensions and extension-backed type  | refused; no PostgreSQL-style extension contract is assumed                         |
| vector or spatial extension operator           | refused; those closed operators are available only on the exact `postgres` dialect |
| expression index                               | refused; add a generated column and index that instead                             |
| explicit index method other than `btree`       | refused; SQL Server-specific index method/options are not modeled                  |
| index operator class                           | refused; operator classes are a PostgreSQL-only contract                           |
| hand-built type alteration without nullability | refused; SQL Server must restate `NULL` or `NOT NULL`                              |
| altering an existing primary key               | refused; the snapshot does not carry the existing SQL Server constraint name       |
| reversing a dropped table                      | refused; the drop operation no longer carries the removed columns                  |

## Measured coverage

The always-on suite covers the complete six-dialect golden matrix, SQL Server DDL and refusal tests, named-parameter binding, transaction pinning, and the 2,000-parameter and `1205` metadata.

A separate real-server suite runs DDL, bracket escaping, `OUTPUT`, ordered pagination, `MERGE`, transaction rollback, timestamp round-trips, schemas, foreign keys, filtered indexes, sequences,
persisted computed columns and column migrations when `ZMDB_MSSQL_URL` points to a reachable server. Without that variable the suite emits a visible `[skip] SQL Server E2E: …` message and keeps an
availability assertion, so the missing live server is explicit.

---

See also: [Query Compiler](./select.html) · [Writing a Driver](./custom-driver.html) · [Raw SQL](./raw-sql.html)
