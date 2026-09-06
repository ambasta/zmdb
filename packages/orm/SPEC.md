# `@zmdb/orm` — sole schema/SQL/validator composition layer (issue #635)

> Specification only. Issue #635 creates no package manifest or runtime source.

`@zmdb/orm` is the only foundation package allowed to combine schema metadata, SQL builders, and runtime validation. It owns repositories, DTO-to-query folding, populate execution, transactions,
structural driver contracts, loaders, filters, caching, streaming, entity hooks/modeling, seeding, replicas, and outbox behavior.

## Public surface

The package exports `.`, `./dto`, `./relations`, `./seeding`, `./transactions`, `./outbox`, `./replicas`, and `./entity-modeling`. Test fixtures remain ORM-owned but are excluded from builds and
tarballs.

Concrete SQLite, PostgreSQL, and SQL Server adapters live in their database packages. Framework endpoint integration lives in `@zmdb/web`; background-job storage belongs to explicit jobs-provider
packages (`@zmdb/jobs-sqlite` and `@zmdb/jobs-postgres`), while provider-neutral queue behavior and ports belong to `@zmdb/jobs`.

## Dependency contract

The exact production dependency set is `@zmdb/schema`, `@zmdb/sql`, and `@zmdb/validator`. No other internal edge, external production/optional/peer dependency, or `node:*` import is permitted.
