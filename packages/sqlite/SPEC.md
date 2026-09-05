# `@zmdb/sqlite` — complete SQLite vertical

> Status: the package implementation for issue #669 is complete and qualified. The temporary generic string-dialect compatibility implementation remains until #675, so final sole ownership is not yet
> earned. Runtime, type-level, live in-memory, and packed-consumer evidence is mandatory and unskipped.

## Public contract

```ts
export const sqlite: SqlDialect<'sqlite'>;
export const sqliteIntrospector: Introspector<'sqlite'>;
export function sqliteDriver(database: SqliteDatabase, options?: SqliteOptions): TransactionalDriver<'sqlite'>;
export const sqliteVertical: DatabaseVertical<'sqlite', SqliteDatabase, SqliteOptions>;
```

Identity is normative:

```ts
sqliteVertical.dialect === sqlite;
sqliteVertical.driver === sqliteDriver;
sqlite.introspector === sqliteIntrospector;
```

The package depends at runtime only on `@zmdb/query-compiler` and `@zmdb/repository`. Its manifest declares no direct third-party runtime dependency or database client. Its public types are
structural; the root is browser-safe and does not import a Node built-in merely by loading. The structural adapter works with `node:sqlite` when the application passes a `DatabaseSync`-compatible
object.

The SQLite-specific embedded migration runner is a separate browser-safe subpath. It imports no Node built-in, filesystem code, compiler barrel or database binding.

## Capabilities

These values describe the target zmdb implementation, not every feature SQLite may expose through hand-written SQL:

| Capability                            | Value                     | Required behavior                                                                                              |
| ------------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------- |
| returning insert/upsert/update/delete | true / true / true / true | suffix `RETURNING`                                                                                             |
| transactional DDL                     | true                      | migration and ledger row share one transaction                                                                 |
| schemas                               | false                     | `CREATE SCHEMA` is refused                                                                                     |
| sequences                             | false                     | standalone sequences are refused; rowid-backed serial remains supported                                        |
| generated columns                     | true                      | exact generated-column golden and live execution; introspection warns on omission                              |
| partial indexes                       | true                      | predicate preserved by DDL and introspection                                                                   |
| foreign keys                          | true                      | adapter enables `PRAGMA foreign_keys = ON`; forward table references work; unsupported ALTER forms are refused |
| row-level security                    | false                     | explicit refusal                                                                                               |
| streaming                             | true                      | `StatementSync.iterate()`-shaped stepping without materializing all rows                                       |
| cancellation                          | false                     | abort is observed before dispatch and between rows, not during a native step                                   |

The current central trait record marks schemas and sequences true. Those booleans are not retained: the package contract follows executable zmdb behavior, and unsupported standalone schema/sequence
operations are refusals rather than plausible SQL.

## Canonical ownership and final-purge target

`@zmdb/sqlite` is the canonical SQLite package. The temporary generic compatibility branches remain only to let the parallel database packages land independently; #675 removes those branches and earns
final sole ownership.

`@zmdb/sqlite` owns:

- the SQLite row from `query-compiler/src/dialects/index.ts`, all SQLite golden/refusal cells and its parameter limit;
- SQLite quoting, positional placeholders, pagination, upsert, returning, boolean, FTS companion-table and operator decisions;
- every SQLite branch in migrations and schema objects, including inline foreign keys and explicit ALTER refusals;
- the SQLite-specific ledger connection and the embedded migration runner/probe;
- `query-compiler/src/introspect/sqlite.ts` and SQLite catalog/pragma normalization;
- `repository/src/drivers/sqlite.ts`, Date binding, statement caching, active-iterator protection, streaming and transactions; and
- driver, migration, introspection and capability tests specific to SQLite.

Generic repository tests may continue to use an in-memory SQLite connection as a fixture. They stay in `@zmdb/repository` when the assertion is about generic CRUD, DTO, cache, relation or lifecycle
behavior rather than SQLite.

## Required refusals

Before execution, the package refuses at least:

- standalone schemas, sequences, materialized views, row-level security and stored routines;
- primary-key changes and add/drop/change foreign-key operations that require table reconstruction;
- `serial` outside a sole rowid-backed primary key, because SQLite has no standalone sequence or column identity;
- reversing a dropped table or column when the generic operation no longer carries its complete definition;
- a request for in-flight engine cancellation; and
- any construct whose exact SQLite spelling or catalog round-trip is not represented in the package matrix.

No refusal is represented by dropping a `ChangeOp`, returning an empty string, emitting another database's SQL or waiting for SQLite to reject a statement.

## Qualification

SQLite qualification is always available and never skips. From the packed tarball, an external consumer must:

1. import the browser-safe root without loading a Node database module;
2. pass a real in-memory `node:sqlite` database to `sqliteDriver`;
3. apply migrations, run create/read/update/delete/upsert and roll back a transaction;
4. stream rows, abort between rows and prove an active statement is not evicted;
5. introspect the resulting database and prove normalized live/declaration equality (the package test also asserts a clean generic drift report); and
6. inspect the installed `@zmdb/sqlite` manifest and find no direct third-party runtime dependency.

Golden and type-level tests cover every abstract SQL type, statement form, schema object and refusal. Documentation may call SQLite supported only while all of the above remains required and green.

## Non-goals

- Shipping a SQLite engine or browser storage binding.
- Treating Expo, OPFS, `sql.js` or another binding as a separate database package.
- Adding a global SQLite registration or making SQLite the implicit compiler default.

## Runtime-foundation cutover (#635)

The vertical contract above is implemented first against the current generic seams. When #634 performs its hard package cutover, those inward dependencies become `@zmdb/sql` and `@zmdb/orm`.
`node:sqlite` remains the package's only built-in integration and stays outside the browser-safe root; no foundation package imports this optional package.
