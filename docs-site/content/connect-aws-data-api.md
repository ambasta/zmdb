Dialect: `'postgres'` (or `'mysql'`). The RDS Data API is HTTP against Aurora Serverless, which means no connection to manage — and a result format that needs unwrapping before it looks like a row.

## Setup

```ts
import { RDSDataClient, ExecuteStatementCommand } from '@aws-sdk/client-rds-data';
import type { Driver } from '@zmdb/repository';

const client = new RDSDataClient({});

export const driver: Driver = {
  async execute(query) {
    const res = await client.send(
      new ExecuteStatementCommand({
        resourceArn: process.env.CLUSTER_ARN,
        secretArn: process.env.SECRET_ARN,
        database: process.env.DB_NAME,
        sql: query.text,
        parameters: query.parameters.map(toParam),
        includeResultMetadata: true,
      }),
    );
    return unwrap(res);
  },
};
```

## The two adapters you have to write

The Data API does not take positional parameters or return plain rows, so the driver does more work here than anywhere else.

**Parameters are named and tagged.** Compiled Postgres queries use `$1`, `$2`; the Data API wants `:p1` with a typed value. Rewrite the text and build the parameter list:

```ts
function toDataApi(query: CompiledQuery) {
  const sql = query.text.replace(/\$(\d+)/g, (_, n) => `:p${n}`);
  const parameters = query.parameters.map((value, i) => ({ name: `p${i + 1}`, value: toField(value) }));
  return { sql, parameters };
}

function toField(v: unknown) {
  if (v === null || v === undefined) return { isNull: true };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { longValue: v } : { doubleValue: v };
  if (v instanceof Date) return { stringValue: v.toISOString() };
  return { stringValue: JSON.stringify(v) };
}
```

**Results are column-oriented and tagged.** Recombine them with the metadata:

```ts
function unwrap(res: { records?: unknown[][]; columnMetadata?: { name?: string }[] }) {
  const names = (res.columnMetadata ?? []).map(c => c.name ?? '');
  return (res.records ?? []).map(record =>
    Object.fromEntries(record.map((field, i) => [names[i] ?? `column_${i}`, fromField(field)])),
  );
}

function fromField(f: Record<string, unknown>): unknown {
  if (f.isNull === true) return null;
  return f.stringValue ?? f.longValue ?? f.doubleValue ?? f.booleanValue ?? null;
}
```

> [!WARNING]
> `fromField` above uses `??` over the possible keys, which is concise and
> subtly wrong for `longValue: 0` — `0` is not nullish, so that case is fine, but
> `booleanValue: false` is also not nullish and also fine, while a genuinely
> absent field falls through to `null`. Write it as an explicit key check if you
> care about the difference between a missing field and a null one. This is the
> kind of place where [validating the rows](./raw-sql.html) against
> `Entity<S>` earns its keep.

## Transactions

The Data API has explicit transaction ids rather than a session:

```ts
const { transactionId } = await client.send(new BeginTransactionCommand({ resourceArn, secretArn, database }));
// pass transactionId on each ExecuteStatementCommand
await client.send(new CommitTransactionCommand({ resourceArn, secretArn, transactionId }));
```

Build a second `Driver` that carries the id and pass that one to `createTransactionalDb`. See [Transactions](./transactions.html).

## Why use it

**No connection management from Lambda.** The reason the Data API exists: a Lambda that scales to hundreds of concurrent invocations cannot each hold a Postgres connection. HTTP has none to hold. See [Serverless Performance](./perf-serverless.html).

**IAM instead of credentials in the environment**, since access is authorised by role.

## Why not

**Latency.** Every statement is an HTTPS call through the Data API service, so a query that takes 2ms in the database takes 20ms+ end to end. A `populate` is two of those. Batch where you can.

**No cursors, and row-count limits.** Large result sets are truncated or rejected. Paginate everything.

For a long-running server, use a normal Postgres connection to the same cluster instead — see [Postgres](./connect-postgres.html). The Data API is for the case where connection count is the binding constraint.

---

See also: [Writing a Driver](./custom-driver.html) · [Serverless Performance](./perf-serverless.html) · [Dialect: Postgres](./dialect-postgres.html)
