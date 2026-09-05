# `@zmdb/sql` — zero-dependency SQL runtime (issue #635)

> Specification only. Issue #635 creates no package manifest or runtime source.

`@zmdb/sql` is the second independent root of the runtime DAG. It owns parameterized query builders, expressions, predicates, quoting, placeholders, injected dialect traits, joins, aggregations, FTS,
set operations, comments, and runtime schema-object SQL.

## Public surface

The package exports `.`, `./comments`, `./fts`, `./joins`, `./aggregations`, `./set-ops`, and `./schema-objects`. Dialect protocols are public from the root; official vendor implementations may move
to database packages without copying the protocol.

Introspection, snapshots, diffs, declaration emission, and migration runners belong to `@zmdb/migrations`. Outbox composition belongs to `@zmdb/orm`. Naming needed by schema belongs to `@zmdb/schema`.

## Dependency contract

`dependencies`, `optionalDependencies`, and `peerDependencies` are empty. No export reaches schema, validator, ORM, migrations, `oxfmt`, a database client, a third party, or a `node:*` module.
