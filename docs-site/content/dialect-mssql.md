Dialect: `'mssql'`. The compiler emits T-SQL and the repository ships a thin
adapter for a connected [`mssql`](https://www.npmjs.com/package/mssql) pool.
The adapter does not open, close or configure the pool.

```ts
import sql from 'mssql';
import { createQueryCompiler } from '@zmdb/query-compiler';
import { mssqlDriver } from '@zmdb/repository/drivers/mssql';

const pool = await sql.connect(process.env.DATABASE_URL!);
const driver = mssqlDriver(pool);
const query = createQueryCompiler('mssql').selectFrom('users').where('email', '=', 'a@b.com').compile();

const rows = await driver.execute(query);
```

The compiler keeps `parameters` positional. The adapter maps array element zero
to `p1`, element one to `p2`, and so on; `mssql` receives those names without
the leading `@`.

## SQL contract

| Construct           | SQL Server spelling                                                 |
| ------------------- | ------------------------------------------------------------------- |
| identifiers         | `[name]`; a closing `]` is escaped as `]]`                          |
| placeholders        | `@p1`, `@p2`, …                                                     |
| pagination          | `OFFSET … ROWS FETCH NEXT … ROWS ONLY` after an explicit `ORDER BY` |
| insert/update rows  | `OUTPUT INSERTED.…` in the verb-specific middle of the statement    |
| deleted rows        | `OUTPUT DELETED.…`                                                  |
| upsert              | one `MERGE … WITH (HOLDLOCK)` statement with a required final `;`   |
| auto-increment      | `INT IDENTITY(1,1)`                                                 |
| booleans            | `BIT`; `not()` emits bitwise `~`                                    |
| timestamp           | `DATETIMEOFFSET(3)`                                                 |
| text / JSON storage | `NVARCHAR(MAX)`                                                     |

A paginated SQL Server select without `.orderBy(...)` is refused at
`compile()`. The compiler does not invent `ORDER BY (SELECT NULL)`, because that
would make the query legal without making its pages reproducible.

`returning()` maps to the correct `OUTPUT` pseudo-table for insert, update and
delete. SQL Server rejects `OUTPUT` without `INTO` when an enabled trigger
exists for that DML action. zmdb cannot inspect target-table triggers, and
`OUTPUT … INTO` would require a table variable and another statement, so
triggered tables must use a hand-written path.

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

`HOLDLOCK` closes the absent-key race between concurrent upserts by taking
serializable range locks on the target. That correctness has a cost: hot-key
workloads can block longer or deadlock. SQL Server error `1205` is classified
as retryable metadata, but zmdb does not retry a unit of work automatically.

## Types and migrations

All ten `SqlType` members have an explicit SQL Server mapping. `varchar` uses
`NVARCHAR(n)` with `Length<n>` and `NVARCHAR(MAX)` without one. `timestamp`
uses `DATETIMEOFFSET(3)`, preserving the instant and JavaScript `Date`
millisecond precision.

There is no `uuid` member in `SqlType`, so the dialect does not invent a
`UNIQUEIDENTIFIER` mapping. Use `Sql<'varchar'> & Length<36>` for an
application-generated GUID, or a custom migration when the native type is
required.

Generated migrations cover table creation and removal, add/drop/alter column,
named foreign keys, indexes including filtered indexes, sequences and
persisted computed columns. Type alterations restate `NULL` or `NOT NULL`; a
hand-built operation without that metadata is refused rather than silently
making a required column nullable. Altering an existing primary key is refused:
the snapshot does not carry the SQL Server constraint name needed to drop it.
Reversing a dropped table is also refused because the change operation no
longer contains the removed columns.

## Explicitly unsupported

The SQL Server dialect refuses full-text search, materialized views,
row-level-security policies, schema introspection and stored-routine builders.
Those SQL Server features require metadata or statement shapes the current
zmdb contracts do not represent.

Write-expression concatenation uses `CONCAT`. On SQL Server, `CONCAT(NULL,
'x')` returns `'x'`, unlike the null-propagating behavior of Postgres, MySQL
and SQLite. Use a different expression when null preservation matters.

## E2E availability

The repository suite runs real SQL Server DDL, named parameters, bracket
escaping, `OUTPUT`, ordered pagination, `MERGE`, timestamp round-trips and
column migrations when `ZMDB_MSSQL_URL` points to a reachable server. Without
that variable it emits a visible `[skip] SQL Server E2E: …` message and keeps
an availability assertion in the suite; SQL Server coverage is never omitted
silently.

---

See also: [Query Compiler](./select.html) · [Writing a Driver](./custom-driver.html) · [Raw SQL](./raw-sql.html)
