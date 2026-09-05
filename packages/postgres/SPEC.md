# `@zmdb/postgres` — complete PostgreSQL vertical

> Status: frozen by issue #666 for implementation in #670. This directory contains specification only.

## Public contract

```ts
export const postgres: SqlDialect<'postgres'>;
export const postgresIntrospector: Introspector<'postgres'>;
export function postgresDriver(client: PgQueryable, options?: PgOptions): TransactionalDriver<'postgres'>;
export const postgresVertical: DatabaseVertical<'postgres', PgQueryable, PgOptions>;

export function postgresFamilyDriver<Name extends string>(dialect: SqlDialect<Name>, client: PgQueryable, options?: PgOptions): TransactionalDriver<Name>;
export function postgresFamilyIntrospector<Name extends string>(name: Name, overrides?: PostgresCatalogOverrides): Introspector<Name>;
```

The four ordinary identity assertions match the SQLite spec. `postgresFamilyDriver` and `postgresFamilyIntrospector` are the narrow public extension surface for Cockroach; they are not private source
imports, registries or generic-package hooks.

The package depends on `@zmdb/query-compiler` and `@zmdb/repository`. `pg` is an optional peer and a development dependency for tests, never a dependency of either generic package or of the default
umbrella install. Importing the package does not open a connection or require a global `pg` singleton.

## Capabilities

| Capability                            | Value                     | Required behavior                                                  |
| ------------------------------------- | ------------------------- | ------------------------------------------------------------------ |
| returning insert/upsert/update/delete | true / true / true / true | suffix `RETURNING`                                                 |
| transactional DDL                     | true                      | migration and ledger row roll back together                        |
| schemas                               | true                      | qualified create/introspection                                     |
| sequences                             | true                      | DDL and catalog round-trip                                         |
| generated columns                     | true                      | DDL and catalog round-trip                                         |
| partial indexes                       | true                      | predicate and supported method/options preserved                   |
| foreign keys                          | true                      | keys and referential actions round-trip                            |
| row-level security                    | true                      | enable and policy DDL have exact expectations                      |
| streaming                             | true                      | cursor path when the supplied queryable can check out a connection |
| cancellation                          | true                      | out-of-band cancellation when `cancelVia` is supplied              |

The final two true values have explicit prerequisites. The driver omits `stream` if its supplied client cannot support the cursor lifecycle, and cancellation requires a second queryable. Capability
documentation must state those prerequisites and tests must cover both configured and degraded shapes.

## Sole ownership after extraction

`@zmdb/postgres` owns:

- the PostgreSQL root traits, type map, parameter limit, retry codes and every PostgreSQL matrix cell;
- PostgreSQL quoting/placeholders, `ON CONFLICT`, returning, FTS, operators and table-function support;
- PostgreSQL DDL, migrations, extensions, expression indexes, schemas, sequences, RLS, routines and outbox spellings;
- `query-compiler/src/introspect/postgres.ts` and its catalog parser/tests;
- `repository/src/drivers/pg.ts`, prepared statements, cursor streaming, cancellation and pinned transactions; and
- PostgreSQL-specific live fixtures, package capability rows and packed-consumer tests.

It owns no Cockroach override, retry policy or catalog exception. Public family factories expose reusable PostgreSQL behavior without importing Cockroach or consulting a mutable child registry.

## Required refusals

Every unsupported compiler, DDL or catalog construct has an exact matrix refusal. In particular, package code may not treat “PostgreSQL family” as permission to accept a Cockroach-only form or let a
child mutate the PostgreSQL objects.

The transaction retry list (`40001`, `40P01` at the measured starting point) is metadata only. Generic repository retry remains explicit opt-in because replaying a callback can repeat application side
effects.

## Qualification

The required PostgreSQL lane runs from a packed external consumer against the declared server version and:

1. applies representative DDL and migrations;
2. runs CRUD, returning and a real rollback;
3. round-trips extensions, keys, foreign keys, indexes, generated columns and schema-qualified objects through `postgresIntrospector`;
4. streams through a cursor, closes early without leaking a checked-out client and cancels through a second connection;
5. proves prepared-statement eviction deallocates server state; and
6. verifies the installed dependency tree contains `pg` only because the consumer selected it.

An absent server is a release-lane failure. Recorder tests and the current optional local E2E remain useful but are not support evidence by themselves.

## Non-goals

- Owning Cockroach-specific types, refusals, retries or catalog normalization.
- Bundling a PostgreSQL server or constructing application connection pools.
- Creating separate packages for hosted services that only supply PostgreSQL connection details.
