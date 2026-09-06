# `@zmdb/postgres`

The PostgreSQL vertical for zmdb. It binds the SQL compiler, migration DDL, catalog introspection, and the `pg` runtime adapter to one immutable dialect object.

```ts
import { Pool } from 'pg';
import { postgres, postgresDriver } from '@zmdb/postgres';
import { createQueryCompiler } from '@zmdb/query-compiler';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const driver = postgresDriver(pool);
const query = createQueryCompiler(postgres).selectFrom('users').compile();

const rows = await driver.execute(query);
```

`pg` is an optional peer. Importing `@zmdb/postgres` does not construct a pool or open a connection. Cursor streaming is exposed for a pool-like queryable that can check out a client. Server-side
cancellation additionally requires a second queryable through `cancelVia`.

`postgresOutboxMigration(version)` supplies PostgreSQL's outbox table, defaults, and partial pending index as an ordinary migration.

`postgresFamilyDriver`, `postgresFamilyIntrospector`, and `postgresFamilyMigrations` are the immutable extension points for a PostgreSQL-family child such as CockroachDB. This package contains no
child-specific behavior.
