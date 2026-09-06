# @zmdb/mysql

`@zmdb/mysql` is the complete MySQL vertical for zmdb: one immutable dialect object owns SQL compilation, capability refusals, DDL and migrations, catalog introspection, and the structural
`mysql2/promise` driver.

## Install

```bash
npm add @zmdb/mysql@alpha mysql2@^3.24.3
```

`mysql2` is an optional peer. Importing this package never imports or installs a database client; the application passes an existing mysql2 pool or connection to `mysqlDriver`.

```ts
import { mysql, mysqlDriver } from '@zmdb/mysql';
import mysql2 from 'mysql2/promise';

const pool = mysql2.createPool({
  uri: process.env.DATABASE_URL,
  charset: 'utf8mb4',
  supportBigNumbers: true,
  bigNumberStrings: true,
});

const driver = mysqlDriver(pool);
const rows = await driver.execute({
  text: 'SELECT ? AS value',
  parameters: ['example'],
});

console.log(mysql.capabilities.transactionalDdl); // false
console.log(rows);
```

Use `executeResult` when command metadata matters. Non-returning commands produce `{ kind: 'command', affectedRows, insertId }`; ordinary `execute` returns an empty row array and never disguises
metadata as a returned entity.

MySQL does not support `RETURNING`, transactional DDL, standalone sequences, partial indexes, or row-level security. The compiler and migration dialect refuse those requests before dispatch.

> **Prerelease** (`1.0.0-alpha.4`, published under the `alpha` dist-tag). Requires **Node.js 26+** and is **ESM-only**.

## License

GPL-3.0-or-later.
