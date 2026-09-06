# `@zmdb/mysql` — complete MySQL vertical

> Status: implemented by issue #671. This specification remains the public contract and qualification checklist.

## Public contract

```ts
export const mysql: SqlDialect<'mysql'>;
export const mysqlIntrospector: Introspector<'mysql'>;
export function mysqlDriver(client: MysqlQueryable, options?: MysqlOptions): TransactionalDriver<'mysql'>;
export const mysqlVertical: DatabaseVertical<'mysql', MysqlQueryable, MysqlOptions>;

export function mysqlFamilyDriver<Name extends string>(dialect: SqlDialect<Name>, client: MysqlQueryable, options?: MysqlOptions): TransactionalDriver<Name>;
export function mysqlFamilyIntrospector<Name extends string>(name: Name, overrides?: MysqlCatalogOverrides): Introspector<Name>;
export function mysqlFamilyMigrations<Name extends string>(name: Name, overrides?: MysqlMigrationOverrides): MigrationDialect<Name>;
```

The family factories are the only parent implementation surface SingleStore may reuse. They accept the child dialect explicitly, return objects bound to it, and expose no mutable parent table. The
migration factory keeps ordinary MySQL columns, keys, ALTER forms, ledger behavior, quoting and type rendering in this package while admitting child-owned type and table-definition clauses.

The package depends on `@zmdb/query-compiler` and `@zmdb/repository`. `mysql2` is an optional peer and a development dependency. The adapter is typed against the structural `mysql2/promise` connection
and pool methods it actually uses.

## Capabilities

| Capability                            | Value                         | Required behavior                                       |
| ------------------------------------- | ----------------------------- | ------------------------------------------------------- |
| returning insert/upsert/update/delete | false / false / false / false | compilation refuses before driver execution             |
| transactional DDL                     | false                         | runner warns and keeps the ledger honest                |
| schemas                               | true                          | qualified database/schema behavior is tested            |
| sequences                             | false                         | standalone sequences are refused                        |
| generated columns                     | true                          | DDL and catalog round-trip                              |
| partial indexes                       | false                         | predicate indexes are refused                           |
| foreign keys                          | true                          | keys, support indexes and actions round-trip            |
| row-level security                    | false                         | explicit refusal                                        |
| streaming                             | false                         | official initial adapter is buffered                    |
| cancellation                          | false                         | already-aborted signals are honored; no in-flight claim |

The current central trait record says MySQL sequences and partial indexes are true. Those unqualified booleans are superseded. This package may claim only behavior covered by its exact matrix and
required real-server lane.

## Sole ownership after extraction

`@zmdb/mysql` owns:

- the MySQL root traits, type map, parameter limit, returning refusals and every MySQL matrix cell;
- backtick quoting, positional placeholders, offset-only pagination, `ON DUPLICATE KEY`, `MATCH`, concatenation and boolean spellings;
- MySQL DDL, `MODIFY` forms, support indexes, non-transactional migration behavior, routines and outbox spellings;
- `migrations/src/introspect/mysql.ts`, the captured MySQL 8 fixture and MySQL drift normalization;
- the new structural `mysql2/promise` driver, transaction connection pinning and honest result metadata; and
- MySQL-specific capability, live-server and packed-consumer tests.

It owns no SingleStore table-storage, shard/sort, foreign-key or catalog override. Public family factories provide reuse without copying implementation or creating a reverse dependency.

## Driver result rule

MySQL does not synthesize returned entity rows. An execution result that exposes `affectedRows` or `insertId` is represented through an explicit MySQL result surface; it is never placed into the
ordinary row array as if the compiler had emitted `RETURNING`. Repository operations whose contract requires returned rows must either use a proven follow-up query with explicit semantics or refuse
the unsupported operation before dispatch.

`transaction(run)` checks a connection out once, runs every callback query on it, commits or rolls back there, and releases it in `finally`.

## Required refusals

At minimum the package refuses returning clauses, transactional-DDL guarantees, standalone sequences, partial/expression indexes not represented by MySQL generated columns, RLS, PostgreSQL
extensions/operator classes and unsupported referential actions. Refusals happen during compilation or migration validation, not as server errors.

## Qualification

The required lane runs a strict `utf8mb4` MySQL server from the packed consumer and:

1. proves positional binding, bigint preservation and transaction pinning;
2. applies migrations while reporting the non-transactional-DDL boundary;
3. runs CRUD without inventing returned entities;
4. round-trips keys, foreign keys, support indexes, generated columns and defaults;
5. compares the live reader with the deterministic captured fixture parser; and
6. verifies `mysql2` is selected by the consumer, not installed through a generic package.

The service is mandatory in release qualification. The captured fixture and recorder tests cannot replace the live lane.

## Non-goals

- Owning SingleStore storage/distribution behavior.
- Claiming streaming or cancellation before a separately specified adapter lifecycle is proven.
- Creating packages for MySQL hosts whose only difference is connection configuration.
