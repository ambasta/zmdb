# @zmdb/mssql

The complete SQL Server vertical for zmdb: a frozen T-SQL dialect, migration semantics, structural node-mssql driver, catalog introspection, and capability metadata.

## Install

```bash
npm add @zmdb/mssql@alpha mssql
```

`mssql` is an optional peer. Importing `@zmdb/mssql` does not load the client, create a pool, or open a connection; pass an already-connected node-mssql-compatible pool to `mssqlDriver`.

```ts
import sql from 'mssql';
import { createQueryCompiler } from '@zmdb/query-compiler';
import { mssql, mssqlDriver } from '@zmdb/mssql';

const pool = await sql.connect(process.env.DATABASE_URL!);
const driver = mssqlDriver(pool);
const query = createQueryCompiler(mssql).selectFrom('users').where('id', '=', 7).compile();
const rows = await driver.execute(query);
```

See the [SQL Server guide](https://ambasta.github.io/zmdb/docs/dialect-mssql.html) for exact capabilities and refusals.

## License

GNU General Public License v3.0 or later (GPL-3.0-or-later) — see [LICENSE](./LICENSE).
