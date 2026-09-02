> **ToDo / feature gap.** There is no SQL Server dialect and no workaround. Unlike
> [Cockroach](./dialect-cockroach.html) or [SingleStore](./dialect-singlestore.html),
> SQL Server is not wire- or syntax-compatible with any of the three supported
> dialects, so there is nothing to route it through. `Dialect` is
> `'postgres' | 'mysql' | 'sqlite'`.

## Why it cannot be approximated

T-SQL differs from Postgres and MySQL in ways that reach the compiler's core, not its edges:

|                         | Supported dialects          | SQL Server                                                             |
| ----------------------- | --------------------------- | ---------------------------------------------------------------------- |
| Identifier quoting      | `"x"` / `` `x` ``           | `[x]`                                                                  |
| Placeholders            | `$1` / `?`                  | `@p1` (named)                                                          |
| Pagination              | `LIMIT n OFFSET m`          | `OFFSET m ROWS FETCH NEXT n ROWS ONLY`, and it **requires `ORDER BY`** |
| Auto-increment          | `SERIAL` / `AUTO_INCREMENT` | `IDENTITY(1,1)`                                                        |
| Returning inserted rows | `RETURNING`                 | `OUTPUT INSERTED.*`, placed before `VALUES`                            |
| Boolean                 | `BOOLEAN` / `TINYINT(1)`    | `BIT`                                                                  |
| String concatenation    | `\|\|`                      | `+`                                                                    |
| Text                    | `TEXT`                      | `NVARCHAR(MAX)`                                                        |
| Case sensitivity        | per-collation               | per-collation, and the _default_ is insensitive                        |

The pagination row is the one that makes it structural. `LIMIT` is a suffix the compiler appends; `OFFSET ... FETCH NEXT` requires an `ORDER BY` to exist, so a paginated query with no ordering — which compiles fine everywhere else — is a syntax error on SQL Server. That is not a formatting difference, it is a rule the builder would have to enforce at the type level or fail at runtime.

`OUTPUT INSERTED.*` is the second: it goes in the middle of the statement rather than at the end, so it cannot be appended the way `RETURNING` is.

## What you can use today

Nothing in zmdb. The parts that do transfer are the ones with no SQL in them:

- the declaration and `Entity<T>` / `CreateDTO<T>` / `WhereDTO<T>` — types
- the AOT validators, `toJsonSchema`, `toOpenApi` — no SQL
- `@zmdb/web` in full — no SQL

So you can use zmdb for validation and HTTP and write your data layer with `mssql` or Kysely against the same schema-derived types:

```ts
import type { Entity } from '@zmdb/schema-core';
import { assert } from '@zmdb/aot-validator/utilities';

const result = await pool.request().input('id', id).query('SELECT * FROM [users] WHERE [id] = @id');
const user = assert<Entity<typeof users>>(result.recordset[0]);
```

The `assert` is what keeps the hand-written SQL tied to the schema object.

## What it would take

A fourth `Dialect` member and a real dialect module: quoting, named placeholders, the pagination rewrite with its `ORDER BY` requirement, `OUTPUT INSERTED` placement, type mappings for all ten column types, and the `ALTER TABLE` variants for migrations. Plus a driver over `mssql`.

It is the largest of the dialect gaps and the only one where the existing dialect abstraction would likely need widening — every other target is a mapping table, this one changes statement structure. If you need it, the pagination and `OUTPUT` handling are where to start, because they determine whether the current builder shape can accommodate it at all.

---

See also: [Query Compiler](./select.html) · [Dialect: Postgres](./dialect-postgres.html) · [Raw SQL](./raw-sql.html)
