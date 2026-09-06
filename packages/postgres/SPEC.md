# `@zmdb/postgres` — complete PostgreSQL vertical

> Status: implemented by #670. The package-owned object path, driver, catalog parser, packed consumer, and PostgreSQL 18 acceptance are executable. The temporary six-name compatibility registry in
> `@zmdb/query-compiler` remains until #675.

## Public contract

```ts
export const postgres: SqlDialect<'postgres'>;
export const postgresIntrospector: Introspector<'postgres'>;
export function postgresDriver(client: PgQueryable, options?: PgOptions): TransactionalDriver<'postgres'>;
export const postgresVertical: DatabaseVertical<'postgres', PgQueryable, PgOptions>;

export function postgresFamilyDriver<Name extends string>(dialect: SqlDialect<Name>, client: PgQueryable, options?: PgOptions): TransactionalDriver<Name>;
export function postgresFamilyIntrospector<Name extends string>(name: Name, overrides?: PostgresCatalogOverrides): Introspector<Name>;
export function postgresFamilyMigrations<Name extends string>(name: Name, options?: PostgresMigrationOptions): MigrationDialect<Name>;

export function postgresOutboxTableDdl(): string;
export function postgresOutboxPendingIndexDdl(): string;
export function postgresOutboxMigration(version: number): Migration;
```

The four ordinary identity assertions match the SQLite spec. `postgresFamilyDriver`, `postgresFamilyIntrospector`, and `postgresFamilyMigrations` are the narrow public extension surface for Cockroach;
they are not private source imports, registries or generic-package hooks. The migration factory accepts child type-map overrides while keeping PostgreSQL DDL and schema-object behavior in the parent
package.

The package depends on `@zmdb/query-compiler` and `@zmdb/repository`. `pg` is an optional peer and a development dependency for tests, never a dependency of either generic package or of the default
umbrella install. Importing the package does not open a connection or require a global `pg` singleton.

## Capabilities

| Capability                            | Value                     | Required behavior                                                   |
| ------------------------------------- | ------------------------- | ------------------------------------------------------------------- |
| returning insert/upsert/update/delete | true / true / true / true | suffix `RETURNING`                                                  |
| transactional DDL                     | true                      | migration and ledger row roll back together                         |
| schemas                               | true                      | schema DDL and selected-schema table introspection                  |
| sequences                             | true                      | sequence DDL; sequence-backed columns normalize to generated values |
| generated columns                     | true                      | DDL and catalog round-trip                                          |
| partial indexes                       | true                      | predicate and supported method/options preserved                    |
| foreign keys                          | true                      | keys and referential actions round-trip                             |
| row-level security                    | true                      | enable and policy DDL have exact expectations                       |
| streaming                             | true                      | cursor path when the supplied queryable can check out a connection  |
| cancellation                          | true                      | out-of-band cancellation when `cancelVia` is supplied               |

The final two true values have explicit prerequisites. The driver omits `stream` if its supplied client cannot support the cursor lifecycle, and cancellation requires a second queryable. Capability
documentation must state those prerequisites and tests must cover both configured and degraded shapes.

## Object-path ownership after extraction

`@zmdb/postgres` owns:

- the PostgreSQL root traits, type map, parameter limit, retry codes and every PostgreSQL matrix cell;
- PostgreSQL quoting/placeholders, `ON CONFLICT`, returning, FTS, operators and table-function support;
- PostgreSQL DDL, migrations, extensions, expression indexes, schemas, sequences, RLS, routines and outbox spellings;
- an independent PostgreSQL catalog parser and tests (the generic six-name parser remains compatibility residue until #675);
- the former `repository/src/drivers/pg.ts` behavior: per-client prepared statements, cursor streaming, cancellation and pinned transactions; and
- PostgreSQL-specific live fixtures, package capability rows and packed-consumer tests.

The generic string emitters remain available to the temporary six-name path, but the injected `postgres.migrations` object executes package-owned DDL and schema-object emitters. Package-owned outbox
helpers carry PostgreSQL's table, default, and partial-index spellings, while the shared workflow compiles its query through the immutable dialect. The packed lane exercises both paths. The package
owns no Cockroach override, retry policy or catalog exception. Public family factories expose reusable PostgreSQL behavior without importing Cockroach or consulting a mutable child registry.

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

Measured on 2026-09-06 with PostgreSQL 18.6 and node-postgres 8.23.0:

```sh
ZMDB_POSTGRES_URL=postgres://… yarn verify:database-postgres
```

The command built six local package archives, installed them into a clean external consumer, typechecked with no `paths`, and passed all eight named runtime checks. An absent server is a release-lane
failure. Recorder tests and the optional local E2E remain useful but are not support evidence by themselves.

## Non-goals

- Owning Cockroach-specific types, refusals, retries or catalog normalization.
- Bundling a PostgreSQL server or constructing application connection pools.
- Creating separate packages for hosted services that only supply PostgreSQL connection details.

## Runtime-foundation cutover (#635)

The vertical contract above is implemented first against the current generic seams. When #634 performs its hard package cutover, those inward dependencies become `@zmdb/sql` and `@zmdb/orm`; the
package remains the sole owner of the PostgreSQL driver, its acceptance fixture, the `pg` peer, and the `@types/pg` development dependency. No foundation package imports it.
