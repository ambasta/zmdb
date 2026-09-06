# `@zmdb/cockroach`

CockroachDB support for zmdb, implemented as a one-way child of the public `@zmdb/postgres` family surface.

```ts
import { cockroach, cockroachDriver } from '@zmdb/cockroach';
import { createQueryCompiler } from '@zmdb/query-compiler';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.COCKROACH_URL });
const compiler = createQueryCompiler(cockroach);
const driver = cockroachDriver(pool);

await driver.execute(compiler.selectFrom('users').compile());
```

The child keeps PostgreSQL quoting, placeholders, DML, migrations, cursors and catalog parsing where Cockroach accepts them. It overrides the parts that are not interchangeable:

- `serial` emits `INT8 DEFAULT unique_rowid()`;
- `integer` emits `INT4`;
- PostgreSQL extensions, explicit index methods/operator classes, full-text operators and row-level-security declarations are refused;
- migration connections report non-transactional DDL and omit PostgreSQL's transaction wrapper because `CREATE TABLE` survives `ROLLBACK`;
- server-side cancellation is not advertised or accepted because CockroachDB does not provide PostgreSQL's `pg_cancel_backend()` function; and
- catalog indexes are read through CockroachDB's `SHOW` surface and normalized with the rest of the PostgreSQL-family snapshot.

The raw driver preserves node-postgres's `INT8` representation: `unique_rowid()` values arrive as decimal strings, and the live lane proves they exceed JavaScript's safe-integer range. Pass those
values back as opaque parameters; do not coerce them with `Number`.

`40001` is classified as retryable, but retrying is always explicit. A retry re-runs the entire transaction callback, potentially `maxRetries + 1` times. Keep HTTP calls, message publishing, file
writes and every other non-idempotent external side effect outside a retrying callback: a database rollback cannot undo them.

See the CockroachDB dialect guide in the documentation site for the full capability and refusal matrix.
