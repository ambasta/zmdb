# Runtime foundation

Start with `zmdb` for the complete application journey. Its default install includes SQLite and the CLI/compiler tooling used to build the application. The four foundation packages below are the
advanced standalone choices when an application needs a smaller runtime surface. The umbrella package does not inherit their zero-external-dependency guarantee.

## Responsibilities and dependencies

An arrow means a direct runtime dependency. The [generated architecture](./architecture.md) and [architecture policy](https://github.com/ambasta/zmdb/blob/main/scripts/architecture/policy.mjs) own the
complete package graph; the foundation portion is:

```text
@zmdb/schema       -> none
@zmdb/sql          -> none
@zmdb/validator    -> @zmdb/schema
@zmdb/orm          -> @zmdb/schema, @zmdb/sql, @zmdb/validator
```

| Package           | Responsibility                                                                                                                   |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `@zmdb/schema`    | Schema tags and intermediate representation, type derivation, relation metadata and OpenAPI shapes.                              |
| `@zmdb/sql`       | Expressions, predicates, query compilation, joins, aggregates, full-text search, set operations and schema-object SQL.           |
| `@zmdb/validator` | Validation and serialization runtime consumed by generated code; compiler reflection and host adapters are outside this package. |
| `@zmdb/orm`       | Repositories and composition: CRUD, transactions, relation loading, replicas, streaming, hooks and outbox workflows.             |

Schema and SQL have no dependency on each other. SQL does not load schema, migrations, a database client, a formatter, validator or ORM. Validator consumes schema; it does not load the TypeScript
compiler. ORM composes all three inward owners rather than placing repository behavior in schema or SQL.

## What zero external dependency means

The four packages have no third-party runtime dependencies, optional dependencies or peers. Their allowed dependencies are only the internal arrows above. This does not mean zero internal packages,
zero development dependencies or zero application dependencies. Build-time TypeScript and tooling are outside the runtime guarantee; a selected database driver or AI SDK has its own explicit contract.

Runtime code uses built ESM entry points and `.js` relative imports. No source-specifier rewriting, compatibility facade or historical package reader is involved. The
[package reference](./package-reference.md) lists the exact public subpaths and current release membership.

## Standalone use

Select only the public package needed by the consumer:

```bash
npm install @zmdb/schema@1.0.0-alpha.4
npm install @zmdb/sql@1.0.0-alpha.4
npm install @zmdb/validator@1.0.0-alpha.4
npm install @zmdb/orm@1.0.0-alpha.4
```

These are four independent installation examples, not a requirement to list transitive dependencies yourself. ORM installs its declared foundation closure. Applications choosing direct core packages
keep them on the same core version; [release guidance](https://github.com/ambasta/zmdb/blob/main/PUBLISHING.md) explains independent integrations and supported ranges.

Use the [schema guide](./schema-declaration.md), [query guide](./select.md), [validation guide](./validators-validate.md) and [repository guide](./repository.md) for their public APIs. The runnable
[quick start](./quick-start.md) composes the product's schema, migration, AOT and HTTP workflow.

## Selected integration boundaries

Database packages own their complete dialect objects, drivers, migration implementations and introspection. SQL accepts the selected dialect contract; it no longer selects a built-in dialect from a
string name. SQLite and PostgreSQL, as well as the other admitted database packages, point inward to the foundation; the foundation never loads a database client. Select a database using the
[installation guide](./installation.md) and its generated package-reference entry.

`@zmdb/ai` composes the schema and validator owners. Anthropic, LangChain and Vercel AI SDK integrations remain separate packages with declared SDK peers; provider SDKs are absent from foundation
imports. The [AI integration guide](./llm-strategy.md) explains those choices.

## Existing consumer proof

The committed [foundation consumer](https://github.com/ambasta/zmdb/tree/main/fixtures/consumer-runtime-foundation) installs real packed packages outside the workspace and checks standalone schema,
SQL, validator and ORM lanes, plus application and generated-code composition. The central publication verifier requires its complete successful report. The normal product has its separate installed
SQLite/CLI/AOT/HTTP journey. These are different dependency boundaries; passing the application journey alone does not establish the standalone foundation guarantee.
