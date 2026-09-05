# `@zmdb/mssql` — complete SQL Server vertical

> Status: frozen by issue #666 for implementation in #672. This directory contains specification only.

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

- `query-compiler/src/dialects/mssql.ts`, the SQL Server root traits, type map, parameter limit, deadlock retry code and every SQL Server matrix cell;
- bracket quoting, named placeholders, ordered `OFFSET/FETCH`, bitwise boolean negation, `OUTPUT` placement and `MERGE WITH (HOLDLOCK)`;
- every SQL Server branch in migrations, schema objects, ledger DDL, referential actions and outbox spelling;
- `repository/src/drivers/mssql.ts` and SQL Server transaction-owned request behavior;
- the replacement for the current central unsupported-introspection branch; and
- all SQL Server capability, catalog, live-server and packed-consumer tests.

No SQL Server implementation remains in a generic production package after #675.

## Catalog contract

`mssqlIntrospector` must read and normalize at least tables, columns, nullability, defaults, identity, primary keys, foreign keys, indexes, filtered predicates and computed columns. The target package
cannot call itself supported while `createIntrospector('mssql')` would still be represented by an unsupported branch.

Catalog rows are validated before use, and a fact that cannot be represented exactly is an explicit error or warning under the generic introspection policy. Silent omission is not allowed.

## Required refusals

The package refuses before execution:

- pagination with `limit` or `offset` and no `ORDER BY`;
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

The current optional `ZMDB_MSSQL_URL` suite is useful local evidence. Release qualification fails rather than passes with a visible skip when the service is absent.

## Non-goals

- Constructing or configuring application connection pools.
- Claiming unmodeled SQL Server features merely because hand-written SQL can reach them.
- Adding SQL Server branches back to generic compiler, migration, introspection or repository files.

## Runtime-foundation cutover (#635)

The vertical contract above is implemented first against the current generic seams. When #634 performs its hard package cutover, those inward dependencies become `@zmdb/sql` and `@zmdb/orm`; the
package remains the sole owner of the SQL Server driver, the `mssql` peer, and the `@types/mssql` development dependency. No foundation package imports it.
