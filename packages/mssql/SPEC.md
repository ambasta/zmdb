# `@zmdb/mssql` — complete SQL Server vertical

> Status: implemented by issue #672 against the current generic injection seams. SQL Server implementation is package-owned now; #675 removes only the frozen name/config/CLI compatibility surface.

## Public contract

```ts
export const mssql: SqlDialect<'mssql'>;
export const mssqlIntrospector: Introspector<'mssql'>;
export function mssqlDriver(pool: MssqlPool, options?: MssqlOptions): TransactionalDriver<'mssql'>;
export const mssqlVertical: DatabaseVertical<'mssql', MssqlPool, MssqlOptions>;
```

The package depends on `@zmdb/query-compiler` and `@zmdb/repository`. `mssql` is an optional peer and development dependency. The public adapter remains structural: applications pass an
already-connected node-mssql-compatible pool, and importing the package neither loads a client implementation nor opens a connection.

## Capabilities

| Capability                            | Value                     | Required behavior                                          |
| ------------------------------------- | ------------------------- | ---------------------------------------------------------- |
| returning insert/upsert/update/delete | true / true / true / true | correctly placed `OUTPUT INSERTED` or `OUTPUT DELETED`     |
| transactional DDL                     | true                      | migration and ledger row use one pinned transaction        |
| schemas                               | true                      | schema-qualified DDL and catalog round-trip                |
| sequences                             | true                      | SQL Server spelling and catalog round-trip                 |
| generated columns                     | true                      | computed/PERSISTED spelling and catalog round-trip         |
| partial indexes                       | true                      | filtered-index predicate preserved                         |
| foreign keys                          | true                      | keys and actions round-trip                                |
| row-level security                    | false                     | the current zmdb schema-object model explicitly refuses it |
| streaming                             | false                     | official initial adapter is buffered                       |
| cancellation                          | false                     | no in-flight cancellation claim                            |

False values are zmdb package refusals, not claims about every SQL Server facility. A later stream, cancel or RLS implementation requires a new frozen contract and real-server evidence.

## Sole ownership after extraction

`@zmdb/mssql` owns:

- `src/index.ts`, `src/compiler.ts` and `src/types.ts`: the SQL Server root traits, type map, parameter limit, deadlock retry code and every SQL Server matrix cell;
- bracket quoting, named placeholders, ordered `OFFSET/FETCH`, bitwise boolean negation, `OUTPUT` placement and `MERGE WITH (HOLDLOCK)`;
- every SQL Server branch in migrations, schema objects, ledger DDL, referential actions and outbox spelling;
- `src/driver.ts` and SQL Server transaction-owned request behavior;
- `src/introspect.ts`, replacing the former central unsupported-introspection branch; and
- all SQL Server capability, catalog, live-server and packed-consumer tests.

No SQL Server implementation remains in a generic production package. The retained generic references are the frozen public name, package-owned refusal text, and vendor-neutral capability strategy
values such as `output` and `merge`; the database-boundary verifier audits those separately from executable SQL Server implementation.

## Catalog contract

`mssqlIntrospector` reads and normalizes tables, columns, nullability, defaults, identity, primary keys, foreign keys, indexes, filtered predicates and computed columns. Object consumers use
`createIntrospector(mssql)` or the named export. The temporary string factory remains compatibility dispatch until #675.

Catalog rows are validated before use, and a fact that cannot be represented exactly is an explicit error or warning under the generic introspection policy. Silent omission is not allowed.

## Required refusals

The package refuses before execution:

- pagination with `limit` or `offset` and no `ORDER BY`;
- composite-key populate that would require unsupported row-value `IN`;
- full-text SQL not represented by the schema contract;
- materialized views, RLS and stored-routine definitions under the current generic schema-object vocabulary;
- an index/operator form not represented by its exact matrix; and
- streaming or in-flight cancellation requests that demand an unimplemented driver lifecycle.

Upsert remains one terminated `MERGE` statement with `HOLDLOCK`; emitting an unlocked or unterminated approximation is not a fallback.

## Qualification

The mandatory packed-consumer lane against real SQL Server must:

1. bind positional values to `p1…pn` and execute generated CRUD;
2. prove `OUTPUT`, ordered pagination and `MERGE` against the server;
3. apply and roll back migrations through one node-mssql transaction;
4. introspect identity, keys, foreign keys, indexes, defaults and computed columns to a clean drift report;
5. round-trip the package's abstract type mappings; and
6. verify the client appears only as a consumer-selected optional peer.

The optional local `ZMDB_MSSQL_URL` suite reports a visible skip. The dedicated CI and packed-consumer lanes require the connection, so qualification cannot pass without SQL Server.

## Non-goals

- Constructing or configuring application connection pools.
- Claiming unmodeled SQL Server features merely because hand-written SQL can reach them.
- Adding SQL Server branches back to generic compiler, migration, introspection or repository files.

## Runtime-foundation cutover (#635)

The vertical contract above is implemented first against the current generic seams. When #634 performs its hard package cutover, those inward dependencies become `@zmdb/sql` and `@zmdb/orm`; the
package remains the sole owner of the SQL Server driver, the `mssql` peer, and the `@types/mssql` development dependency. No foundation package imports it.
