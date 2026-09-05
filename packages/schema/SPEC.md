# `@zmdb/schema` — zero-dependency semantic foundation (issue #635)

> Specification only. Issue #635 creates no package manifest or runtime source.

`@zmdb/schema` is an independent root of the runtime DAG. It owns declaration tags, schema and IR data, pure IR transforms, type derivation, pure DTO/result types, naming, relation metadata,
custom-type framing, and OpenAPI/JSON Schema framing.

## Public surface

The package exports `.`, `./tags`, `./ir`, `./derive`, `./dto`, `./naming`, `./relations`, `./entity-modeling`, `./openapi`, and `./custom-types`.

It does not compile SQL, validate a runtime value, open a compiler session, orchestrate an AI provider, or execute a populate. `dto` and `relations` contain only the pure halves frozen in
`.github/scripts/verify-runtime-foundation.SPEC.md` §3.

## Dependency contract

`dependencies`, `optionalDependencies`, and `peerDependencies` are empty. No export reaches `@zmdb/sql`, validator, ORM, tooling, migrations, AI, an integration package, a third party, or a `node:*`
module.

`singularPascalCase` moves here from query-compiler naming so OpenAPI no longer creates a schema-to-SQL edge.
