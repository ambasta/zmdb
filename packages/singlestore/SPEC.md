# `@zmdb/singlestore` — SingleStore MySQL-family vertical

> Status: implemented by issue #674. The current evidence combines a packed official-image run with the focused source-bound rerun described under Qualification; exact-head packed requalification
> remains required before closure.

## Public contract

```ts
export const singlestore: SqlDialect<'singlestore'>;
export const singlestoreIntrospector: Introspector<'singlestore'>;
export const singlestoreMigrations: MigrationDialect<'singlestore'>;
export function singlestoreDriver(client: MysqlQueryable, options?: MysqlOptions): MysqlDriver<'singlestore'>;
export const singlestoreVertical: DatabaseVertical<'singlestore', MysqlQueryable, MysqlOptions>;
```

The package depends one-way on the public `@zmdb/mysql` extension surface and on directly imported generic contracts. The parent has no reverse edge. Driver and catalog reuse is through public family
factories that bind the child dialect explicitly.

## Immutable inheritance

The package calls `extendSqlDialect(mysql, overrides)` once and deep-freezes the result. It has `family === 'mysql'`. The measured current overrides are:

- `serial` → `BIGINT AUTO_INCREMENT`;
- `timestamp` → `DATETIME(6)`, because SingleStore accepts fractional precision 0 or 6 rather than MySQL's inherited 3;
- full-text matching → parameterized `MATCH(column) AGAINST(?)` without MySQL's unsupported natural-language-mode suffix;
- foreign keys → false/refusal; and
- SingleStore-owned rowstore/columnstore, shard-key and sort-key validation/DDL.

The package must replace blind MySQL catalog delegation with server-proven SingleStore normalization. It cannot copy the MySQL root implementation or mutate its traits.

## Capabilities

| Capability                            | Value                         | Required behavior                                |
| ------------------------------------- | ----------------------------- | ------------------------------------------------ |
| returning insert/upsert/update/delete | false / false / false / false | inherited pre-execution refusal                  |
| transactional DDL                     | false                         | inherited warning/ledger behavior, server-proven |
| schemas                               | true                          | inherited then server-proven                     |
| sequences                             | false                         | explicit refusal                                 |
| generated columns                     | true                          | server-proven package expectation                |
| partial indexes                       | false                         | explicit refusal                                 |
| foreign keys                          | false                         | explicit refusal before DDL execution            |
| row-level security                    | false                         | explicit refusal                                 |
| streaming                             | false                         | official initial adapter is buffered             |
| cancellation                          | false                         | no in-flight claim                               |

The table is deliberately conservative. A server feature does not become a zmdb capability until the package can compile, migrate, introspect and test it through the public vertical.

## Sole ownership after extraction

`@zmdb/singlestore` owns:

- the SingleStore override row and every SingleStore expectation/refusal cell in the central matrix;
- `BIGINT AUTO_INCREMENT`, rowstore/columnstore, shard key, sort key and storage-transition behavior;
- validation that unique indexes are compatible with the shard key;
- the foreign-key and stored-routine refusals;
- SingleStore catalog queries/normalization instead of the former blind MySQL wrapper;
- the SingleStore-bound MySQL-family driver; and
- all SingleStore live-server, immutable-inheritance and packed-consumer tests.

Ordinary MySQL placeholders, quoting, pagination, compiler assembly, driver lifecycle and catalog parsing remain owned by `@zmdb/mysql` and are reused through its public extension surface.

## Required refusals

Before execution, the package refuses foreign keys, incompatible unique indexes, explicit index methods without table-storage evidence, check constraints, sort keys on explicit rowstore tables,
unsupported storage transitions, MySQL routine SQL that is not valid SingleStore grammar, returning clauses, standalone sequences, partial indexes, RLS, streaming and in-flight cancellation claims.

Shard/sort/storage declarations must survive schema IR, snapshot, diff, DDL and introspection. Silently dropping one is a correctness failure even if the resulting table can be created.

## Qualification

The mandatory real SingleStore lane starts the digest-pinned official Dev Image, fails closed without `ZMDB_SINGLESTORE_URL`, and from the packed consumer:

1. create rowstore and columnstore tables with shard and sort declarations;
2. prove the declarations survive migration and introspection;
3. refuse foreign keys and invalid unique indexes before server execution;
4. run CRUD and transaction behavior through the child-bound MySQL-family driver;
5. validate every inherited capability/refusal against the real server; and
6. prove the dependency tree points SingleStore → MySQL with no copied private implementation.

The measured packed implementation run used SingleStore 9.0.12 through its MySQL 5.7.32 protocol surface. It observed `INMEMORY_ROWSTORE`/`COLUMNSTORE` storage metadata, shard/sort definitions from
`SHOW CREATE TABLE`, non-transactional DDL, persisted computed columns, CRUD, rollback, and eight locally packed package archives. A focused source-bound rerun on the same server additionally proved
exact `DATETIME(6)` migration/CRUD/catalog behavior, the rowstore outbox DDL/index, parameterized full-text SQL, and the storage-dependent index/check-constraint refusal boundaries. A missing service
or URL fails release qualification; golden SQL does not replace this server evidence.

## Non-goals

- Copying `@zmdb/mysql`.
- Pretending SingleStore is only a connection recipe.
- Claiming a capability because MySQL has it without child-server proof.
