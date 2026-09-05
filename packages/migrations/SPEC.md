# `@zmdb/migrations` — schema lifecycle and migration engine SPEC

> Status: **FROZEN** for GitHub sub-issue #626. This is the target contract only; the specification slice moves no runtime source or manifest.

## 1. Responsibility

`@zmdb/migrations` owns the complete schema lifecycle:

- deterministic schema snapshots, diffs and ordered change plans;
- dialect-injected DDL plans and up/down rendering;
- migration-file parsing, naming, checksums and atomic writes;
- ledger execution, status and rollback;
- the filesystem-free embedded runner;
- catalog introspection, drift normalization and declaration emission; and
- reusable operations behind every database-oriented CLI command.

The exact move map contains 20 current shipped/build-input files and is frozen in [`../../.github/scripts/verify-tooling-ownership.SPEC.md`](../../.github/scripts/verify-tooling-ownership.SPEC.md).
Hot-path SELECT/INSERT/UPDATE/DELETE compilation, quoting protocols, query expressions and schema-object protocols remain in `@zmdb/query-compiler`.

## 2. Dependency boundary

```text
@zmdb/query-compiler ──> @zmdb/migrations ──> @zmdb/cli
```

`@zmdb/migrations` has a required dependency on `@zmdb/query-compiler` and on the pinned `oxfmt` version used for generated declarations and migration source. It has no dependency on `@zmdb/compiler`,
`@zmdb/cli`, `@zmdb/repository`, `@zmdb/web` or `zmdb`.

Schema and driver inputs are structural. The CLI may obtain schema values from `@zmdb/compiler/testing` and pass them in, but the migrations package never opens a TypeScript project. Database-specific
DDL, catalog queries and connection adapters arrive through the explicit database/migration protocols; no mutable dialect registry or import-for-side-effect mechanism is permitted.

## 3. Public surface

The package exports exactly:

| Subpath                         | Contract                                                                          |
| ------------------------------- | --------------------------------------------------------------------------------- |
| `@zmdb/migrations`              | snapshot, diff, migration plans, DDL rendering and project-independent operations |
| `@zmdb/migrations/runner`       | ledger runner, rollback, status and structural driver adapter                     |
| `@zmdb/migrations/embedded`     | filesystem-free embedded migration format and runner                              |
| `@zmdb/migrations/introspect`   | catalog protocols, introspectors and drift detection                              |
| `@zmdb/migrations/declarations` | deterministic catalog-to-TypeScript declaration emission                          |
| `@zmdb/migrations/files`        | migration-file parsing, naming, checksums and atomic persistence                  |
| `@zmdb/migrations/testing`      | in-memory protocols, golden helpers and conformance suites                        |

`zmdb/migrations` is the stable product facade over these APIs. The target has no permanent compatibility entries under `@zmdb/query-compiler`; #721/#728 own their removal version.

### 3.1 Root API

```ts
export declare function snapshot(schemas: readonly SnapshotableSchema[]): SchemaSnapshot;
export declare function diff(previous: SchemaSnapshot, next: SchemaSnapshot, options?: DiffOptions): readonly ChangeOp[];
export declare function planMigration(previous: SchemaSnapshot, next: SchemaSnapshot, database: MigrationDialect): MigrationPlan;
```

`MigrationPlan` is data: ordered operations plus deterministic `up` and `down` statements. It does not execute a connection, open a file or load config. Existing snapshot and migration contracts in
[`../query-compiler/src/migrations/SPEC.md`](../query-compiler/src/migrations/SPEC.md) remain normative after their module paths move.

### 3.2 Reusable command operations

The library owns one callable operation for each database-oriented CLI verb:

| CLI verb   | Library operation                                         |
| ---------- | --------------------------------------------------------- |
| `generate` | `generateMigration`                                       |
| `embed`    | `embedMigrations`                                         |
| `migrate`  | `migrate`                                                 |
| `rollback` | `rollback`                                                |
| `status`   | `migrationStatus`                                         |
| `push`     | `planPush` followed by `applyPush` after CLI confirmation |
| `check`    | `checkProject`                                            |
| `upgrade`  | `upgradeSnapshot`                                         |
| `export`   | `exportSchema`                                            |
| `pull`     | `pullDeclarations`                                        |

These functions accept resolved paths, schema values, a database protocol and/or a structural driver. They do not parse argv, print, prompt, read stdin or choose an exit code. The CLI owns those
things and nothing in this table must spawn the executable.

### 3.3 Introspection and declarations

Catalog protocols, parsers, drift normalization and selection rules move from `query-compiler/src/introspect`. `emitDeclarations` moves to `@zmdb/migrations/declarations`; this is the sole path that
imports `oxfmt`.

The root, runner and embedded subpaths must not reach `oxfmt`. Moving the formatter edge out of `@zmdb/query-compiler` restores a dependency-free SQL hot path.

### 3.4 Embedded runner

`@zmdb/migrations/embedded` is a browser-safe leaf:

- no Node built-in, filesystem, formatter, compiler, CLI, query builder or database binding;
- no import from another migrations entry point;
- deterministic ascending-version application, checksum validation and ledger-ahead refusal; and
- one injected `EmbeddedConnection` protocol.

Database packages may provide connection adapters and database-specific ledger statements. The generic ordering, checksum and failure-state algorithm remains owned here. This is the seam that lets a
SQLite vertical own SQLite behavior without duplicating the migration engine.

## 4. Old ownership removed

Implementation deletes:

- `@zmdb/query-compiler/introspect`
- `@zmdb/query-compiler/migrations`
- `@zmdb/query-compiler/migrations/runner`
- `@zmdb/query-compiler/migrations/embedded`
- the `migrations` namespace export from the `zmdb` root

No permanent implementation-owner forwarding subpath remains in the target. Product imports use `zmdb/migrations`; advanced imports use `@zmdb/migrations` and its explicit subpaths. A temporary old
query-compiler alias, if release governance requires one, owns no new behavior.

## 5. Packed-consumer evidence

A standalone packed consumer must:

1. import and typecheck every subpath without `@zmdb/cli` or `@zmdb/compiler`;
2. snapshot and diff a structural schema;
3. emit a plan through an injected test dialect;
4. parse and execute migration files against an in-memory ledger protocol;
5. run the embedded entry while an import-graph oracle proves it is filesystem-free;
6. introspect a fixture catalog and emit formatter-clean declarations; and
7. reject a planted old query-compiler migration import.

## 6. Non-goals

- Query hot-path behavior and database-specific vertical ownership are not reimplemented here.
- The package does not discover config, reflect TypeScript, parse argv or print.
- Embedded migrations do not acquire rollback or filesystem access.
- No old migration/introspection subpath becomes a permanent owner or receives new behavior.
