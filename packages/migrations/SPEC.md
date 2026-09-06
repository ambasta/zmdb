# `@zmdb/migrations` — schema lifecycle and migration engine SPEC

> Status: **IMPLEMENTED** by GitHub sub-issue #629 against the contract frozen by #626.

## 1. Responsibility

`@zmdb/migrations` owns the complete schema lifecycle:

- deterministic schema snapshots, diffs and ordered change plans;
- dialect-injected DDL plans and up/down rendering;
- migration-file parsing, naming, checksums and atomic writes;
- ledger execution, status and rollback;
- the filesystem-free embedded runner;
- catalog introspection, drift normalization and declaration emission; and
- reusable operations behind every database-oriented CLI command.

The measured ownership map assigns 23 shipped/build-input paths to this package and is frozen in
[`../../.github/scripts/verify-tooling-ownership.SPEC.md`](../../.github/scripts/verify-tooling-ownership.SPEC.md). Hot-path SELECT/INSERT/UPDATE/DELETE compilation, quoting protocols, query
expressions and schema-object protocols remain in `@zmdb/query-compiler`.

## 2. Dependency boundary

```text
zmdb CLI adapters ──> @zmdb/migrations/files ──> @zmdb/migrations ──> @zmdb/query-compiler
```

`@zmdb/migrations` has a required dependency on `@zmdb/query-compiler` and on the pinned `oxfmt` version used only by generated declarations. It has no dependency on `@zmdb/compiler`, `@zmdb/cli`,
`@zmdb/repository`, `@zmdb/web` or `zmdb`.

Schema and driver inputs are structural. The CLI may obtain schema values from `@zmdb/compiler/testing` and pass them in, but the migrations package never opens a TypeScript project. Database-specific
DDL, catalog queries and connection adapters arrive through the explicit database/migration protocols; no mutable dialect registry or import-for-side-effect mechanism is permitted.

Formatter-backed operations receive structural `emitDeclarations` and `formatSource` callbacks on `MigrationProject`. The CLI composes those adapters from the declarations entry and its pinned
formatter. This keeps command behavior byte-compatible without making the root lifecycle or runner graphs load the formatter.

## 3. Public surface

The package exports exactly:

| Subpath                               | Contract                                                                    |
| ------------------------------------- | --------------------------------------------------------------------------- |
| `@zmdb/migrations`                    | snapshot, diff, migration plans, DDL rendering and the low-level runner     |
| `@zmdb/migrations/runner`             | ledger runner, rollback, status and structural driver adapter               |
| `@zmdb/migrations/embedded`           | filesystem-free embedded migration format and runner                        |
| `@zmdb/migrations/introspect`         | catalog protocols, introspectors and drift detection                        |
| `@zmdb/migrations/introspect/runtime` | catalog row helpers and drift normalization without concrete readers        |
| `@zmdb/migrations/declarations`       | deterministic catalog-to-TypeScript declaration emission                    |
| `@zmdb/migrations/files`              | migration files, atomic persistence and reusable project command operations |
| `@zmdb/migrations/testing`            | in-memory protocols, golden helpers and conformance suites                  |

`zmdb/migrations` is the stable product facade over the root lifecycle, runner and file-backed project APIs. Advanced consumers use the explicit package subpaths. There are no compatibility entries
under `@zmdb/query-compiler`.

### 3.1 Root API

```ts
export declare function snapshot(schemas: readonly SnapshotableSchema[]): SchemaSnapshot;
export declare function diff(previous: SchemaSnapshot, next: SchemaSnapshot, options?: DiffOptions): readonly ChangeOp[];
export declare function planMigration(previous: SchemaSnapshot, next: SchemaSnapshot, database: MigrationPlanDialect): MigrationPlan;
```

`MigrationPlan` is data: ordered operations plus deterministic `up` and `down` statements. It does not execute a connection, open a file or load config. The detailed snapshot and migration contracts
remain normative in [`src/SPEC.md`](./src/SPEC.md).

### 3.2 Reusable command operations

The `@zmdb/migrations/files` entry owns one callable operation for each database-oriented CLI verb:

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

Catalog protocols, parsers, drift normalization and selection rules live under `@zmdb/migrations/introspect`. Database packages that need only the shared row helpers and drift normalization import
`@zmdb/migrations/introspect/runtime`, which reaches no concrete catalog reader. `emitDeclarations` lives under `@zmdb/migrations/declarations`; this is the sole path that imports `oxfmt`.

The root, runner and embedded subpaths must not reach `oxfmt`. Moving the formatter edge out of `@zmdb/query-compiler` restores a dependency-free SQL hot path.

### 3.4 Embedded runner

`@zmdb/migrations/embedded` is a browser-safe leaf:

- no Node built-in, filesystem, formatter, compiler, CLI, query builder or database binding;
- no import from another migrations entry point;
- deterministic ascending-version application, checksum validation and ledger-ahead refusal; and
- one injected `EmbeddedConnection` protocol.

The leaf retains the frozen SQLite ledger statements as well as ordering, checksum and failure-state behavior so extraction does not change any persisted bytes. Database packages may provide
connection adapters or compatibility re-exports; `@zmdb/sqlite/embedded` currently delegates directly to this implementation.

## 4. Old ownership removed

The implementation removed:

- `@zmdb/query-compiler/introspect`
- `@zmdb/query-compiler/migrations`
- `@zmdb/query-compiler/migrations/runner`
- `@zmdb/query-compiler/migrations/embedded`
- the `migrations` namespace export from the `zmdb` root

No implementation-owner forwarding subpath remains. Product imports use `zmdb/migrations`; advanced imports use `@zmdb/migrations` and its explicit subpaths. The old query-compiler paths do not
resolve.

## 5. Packed-consumer evidence

The standalone packed-consumer test:

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
