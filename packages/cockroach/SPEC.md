# `@zmdb/cockroach` — CockroachDB PostgreSQL-family vertical

> Status: frozen by issue #666 for implementation in #673. This directory contains specification only.

## Public contract

```ts
export const cockroach: SqlDialect<'cockroach'>;
export const cockroachIntrospector: Introspector<'cockroach'>;
export function cockroachDriver(client: PgQueryable, options?: PgOptions): TransactionalDriver<'cockroach'>;
export const cockroachVertical: DatabaseVertical<'cockroach', PgQueryable, PgOptions>;
```

The package depends one-way on the public `@zmdb/postgres` extension surface and on the generic contracts it imports directly. `@zmdb/postgres` never imports this package. The driver and introspector
are child-bound results from the parent's public family factories, so their identity/name is Cockroach rather than PostgreSQL.

## Immutable inheritance

The package calls `extendSqlDialect(postgres, overrides)` once. The result is deeply frozen, has `family === 'postgres'`, and does not lazily read or mutate its parent. The initial overrides measured
in the current central table are:

- `serial` → `INT8 DEFAULT unique_rowid()`;
- `integer` → `INT4`;
- full-text search → explicit refusal;
- row-level security → false/refusal; and
- retryable transaction codes → `['40001']`.

Catalog normalization and any additional DDL differences must be established by the required real-server lane. They are child overrides, never edits to PostgreSQL.

## Capabilities

| Capability                            | Value                     | Required behavior                                                                |
| ------------------------------------- | ------------------------- | -------------------------------------------------------------------------------- |
| returning insert/upsert/update/delete | true / true / true / true | inherited exact SQL, server-proven                                               |
| transactional DDL                     | true                      | package migration lane proves rollback behavior                                  |
| schemas                               | true                      | inherited then server-proven                                                     |
| sequences                             | true                      | package-specific serial/sequence behavior proven                                 |
| generated columns                     | true                      | inherited then server-proven                                                     |
| partial indexes                       | true                      | inherited then server-proven                                                     |
| foreign keys                          | true                      | inherited then server-proven                                                     |
| row-level security                    | false                     | explicit Cockroach refusal                                                       |
| streaming                             | true                      | PostgreSQL-family cursor path under the same connection prerequisite             |
| cancellation                          | true                      | PostgreSQL-family out-of-band path under the same second-connection prerequisite |

Inheritance is not evidence. Every true inherited row receives a Cockroach real-server assertion before the package is supported.

## Sole ownership after extraction

`@zmdb/cockroach` owns:

- the Cockroach override row and all Cockroach expectation/refusal cells currently in the central dialect matrix;
- Cockroach serial/integer mapping, FTS and RLS refusals and retry code;
- Cockroach-specific migration validation and catalog normalization discovered by live proof;
- the current central PostgreSQL-introspector delegation, replaced by an explicit child introspector;
- the Cockroach-bound PostgreSQL-family driver; and
- Cockroach live-server, immutability, dependency-direction and packed-consumer tests.

It does not copy ordinary PostgreSQL placeholders, quoting, SQL assembly, migration emitters, driver lifecycle or catalog parser.

## Retry contract

Code `40001` is retryable metadata, not automatic replay. The generic repository retries only under the existing explicit transaction retry option. Documentation must warn that the callback can run
more than once and therefore must not perform non-idempotent external side effects.

The package tests retry classification and a real serialization retry without hiding application callbacks in the driver.

## Required refusals and qualification

RLS and PostgreSQL FTS are explicit pre-execution refusals. Any inherited operation rejected by the real Cockroach server becomes a child override/refusal before support can be claimed; it is not left
as a deployment caveat.

The mandatory packed consumer:

1. proves unchanged PostgreSQL behavior through public parent exports;
2. proves the serial/integer overrides and retry semantics;
3. applies migrations, runs CRUD/returning and a transaction;
4. introspects and obtains a clean drift report against real CockroachDB;
5. exercises claimed stream/cancel paths; and
6. verifies the installed dependency graph points Cockroach → PostgreSQL and never in reverse.

## Non-goals

- A copy of the PostgreSQL package.
- Automatic transaction replay without application opt-in.
- Treating Cockroach as a connection-string recipe once it owns these substantive overrides.
