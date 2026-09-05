# Introspection: catalog → snapshot → declaration — Spec (frozen)

> Part of `@zmdb/query-compiler` (module `src/introspect/`). Epic "Introspection — the DDL-to-declaration direction". Frozen for TDD. The catalog readers, declaration emitter and two-direction drift
> report are implemented; the adoption CLI and guide remain separate slices.

## 1. Why the reverse direction is not the forward one inverted

Forward, the type map is a total function out of a closed vocabulary: `Sql<'text'>` is `TEXT`, always, and each root `DialectTypeMap` has one row per abstract type. Backward it is a partial function
out of an open one.

Postgres will report `character varying`, `varchar`, `text`, `citext`, `name`, a domain over any of those, or an enum — several collapsing onto one `SqlType`, one carrying a constraint no tag can
state, and one mapping to nothing at all.

A spec that said "map the type back" would produce an emitter that widens the awkward cases to `unknown` and reports success.

There are two outputs and they are different products, which is the distinction the rest of this document rests on:

| Output                       | Audience | Requirement                                     |
| ---------------------------- | -------- | ----------------------------------------------- |
| `snapshot(driver)`           | `diff`   | **Exact.** Drift detection is a lie without it. |
| `emitDeclarations(snapshot)` | a person | A starting point. May warn, may omit.           |

So a column the emitter cannot represent still appears in the snapshot, carrying its catalog type verbatim. Otherwise `check` reports a phantom drift, on every run, for a column nobody can express —
and a drift check that is never clean is a drift check nobody reads.

```ts
export interface IntrospectionDriver {
  execute(query: CompiledQuery): Promise<readonly Record<string, unknown>[]>;
}

export interface Introspector {
  readonly dialect: Dialect;
  snapshot(driver: IntrospectionDriver, opts?: IntrospectOptions): Promise<CatalogSchemaSnapshot>;
}

export declare function createIntrospector(dialect: Dialect): Introspector;

export interface IntrospectOptions {
  readonly schemas?: readonly string[]; // default: the dialect's default schema
  readonly include?: readonly string[]; // table name globs
  readonly exclude?: readonly string[]; // default: the migration ledger
}

export interface EmitDeclarationsResult {
  readonly files: readonly { readonly path: string; readonly source: string }[];
  readonly warnings: readonly {
    readonly table: string;
    readonly column?: string;
    readonly reason: string;
  }[];
}
export interface EmitOptions {
  /** Required because SchemaSnapshot is deliberately dialect-neutral. */
  readonly dialect: Dialect;
}
export declare function emitDeclarations(snapshot: SchemaSnapshot, opts: EmitOptions): Promise<EmitDeclarationsResult>;

export interface DriftOptions {
  /** Table-name globs. Default: `['_zmdb_migrations']`; an explicit list replaces it. */
  readonly exclude?: readonly string[];
  /** Enables dialect-owned noise rules, currently the MySQL foreign-key support index rule. */
  readonly dialect?: Dialect;
}
export interface DriftReport {
  readonly onlyInDatabase: readonly ChangeOp[];
  readonly onlyInDeclarations: readonly ChangeOp[];
  readonly clean: boolean;
}
export declare function detectDrift(live: SchemaSnapshot, declared: SchemaSnapshot, opts?: DriftOptions): DriftReport;
```

`CatalogSchemaSnapshot` is structurally a `SchemaSnapshot` and adds the catalog-only evidence plus the ordered keys, foreign keys, indexes and extensions already frozen by the dependent migration
epics. At this base those migration implementations have not landed, so the richer exported type is the explicit bridge rather than making this reader slice implement their diff and DDL work.

`IntrospectionDriver` is the structural slice of the driver the repository already injects: `execute(query: CompiledQuery)`. It is declared here because `@zmdb/query-compiler` sits below
`@zmdb/repository` and cannot import its `Driver` without reversing the package graph. `createIntrospector` is the one dialect dispatch; there is no second per-reader construction API. Catalog queries
are ordinary `CompiledQuery` values with parameters, never concatenated strings: the schema list and the globs are caller input, and this is a module whose entire job is to send SQL naming things the
caller chose.

The package DAG keeps `@zmdb/query-compiler` below `@zmdb/schema-core` and alongside `@zmdb/aot-validator`. Catalog rows are therefore validated here by explicit field validators rather than asserted
or imported through a forbidden upward or sibling edge. Declaration formatting is the one runtime dependency in this package: `oxfmt`, invoked on generated source so checked-in output follows the
repository formatter. A wrong-shaped row throws `CatalogRowError` naming the catalog, row and field before any value is used.

## 2. Catalog sources, per dialect

**Postgres** — `information_schema.tables`, `.columns`, `.table_constraints`, `.key_column_usage` and `.referential_constraints` for the ordinary facts, **plus `pg_catalog`** for five things
`information_schema` does not expose at all:

| Fact                                    | Source                                             |
| --------------------------------------- | -------------------------------------------------- |
| Indexes, at all                         | `pg_index` + `pg_get_indexdef()`                   |
| An index expression or access method    | the same — needed for §1.1 of `../schema-objects/` |
| Extension membership                    | `pg_extension`, `pg_depend`                        |
| Identity vs a sequence default          | `pg_attribute.attidentity`                         |
| A domain's base type, an enum's members | `pg_type.typtype`, `pg_enum`                       |

`information_schema` has no concept of an index — it is a SQL-standard view set and indexes are not in the standard — which is the single reason `pg_catalog` is not optional here. `atttypmod` is also
where a `vector`'s dimension lives.

One property of `information_schema` shapes §8: it filters to what the connecting role may access. A restricted role therefore produces a _smaller_ snapshot rather than an error, and "cannot see it"
is indistinguishable from "it is not there". The introspector records the role and the schema list it used in the result, so an empty diff can be trusted or disbelieved on the evidence.

**MySQL** — `information_schema.TABLES`, `.COLUMNS`, `.STATISTICS`, `.KEY_COLUMN_USAGE`, `.REFERENTIAL_CONSTRAINTS`. MySQL does expose indexes through `information_schema.STATISTICS`, so there is no
second catalog to read for them. Both `DATA_TYPE` and `COLUMN_TYPE` are read, because `DATA_TYPE` is `tinyint` and `COLUMN_TYPE` is `tinyint(1)`, and `tinyint(1)` is the only evidence a column was
meant to be a boolean. `COLUMNS.EXTRA` carries `auto_increment` and the generated-column expression.

**SQLite** — `sqlite_master` for the object list and the original `sql` text, then `PRAGMA table_info` / `index_list` / `index_info` / `index_xinfo` / `foreign_key_list`. Two SQLite specifics matter:

- `table_info.pk` is a **1-based ordinal**, not a flag, which is how a composite key's _order_ is recovered — and order is normative per `../migrations/SPEC.md` §1.1, so this is the only dialect where
  the key order comes free.
- A declared type in SQLite is arbitrary text under type affinity rules, so the reverse map is over the declared text rather than over a fixed set (§3).

`sqlite_master.sql` is the last resort for anything the pragmas do not expose — a partial index's `WHERE`, a generated column's expression, a `WITHOUT ROWID` marker. Parsing it is a fallback and every
use of it is a warning, because it is the original text and may be formatted any way at all.

`PRAGMA foreign_key_list` does not expose a constraint name. The normalized snapshot therefore uses the same deterministic `<table>_<column>_…_fkey` name as the declaration path. This is the one
snapshot name that is reconstructed rather than read; without it, the same SQLite constraint would diff against itself.

`_zmdb_migrations` is excluded by default on every dialect. It is zmdb's own bookkeeping, it is not in anybody's declarations, and a default that includes it makes the first `check` on every project
report drift.

## 3. The reverse type table

**Postgres.** Aliases collapse; the right-hand column is what lands in the snapshot.

| Catalog type                                              | Maps to                             | Note                              |
| --------------------------------------------------------- | ----------------------------------- | --------------------------------- |
| `integer`, `int4`                                         | `integer`                           |                                   |
| `bigint`, `int8`                                          | `bigint`                            |                                   |
| `smallint`, `int2`                                        | `integer`                           | widened — warn                    |
| `numeric`, `decimal`                                      | `numeric` + precision               |                                   |
| `character varying`, `varchar` (length)                   | `varchar` + `Length<n>`             |                                   |
| `character varying` (no length)                           | `text`                              | unlimited, so `varchar` would lie |
| `text`                                                    | `text`                              |                                   |
| `character`, `bpchar`                                     | `varchar`                           | blank padding lost — warn         |
| `boolean`, `bool`                                         | `boolean`                           |                                   |
| `timestamp with time zone`                                | `timestamp`                         |                                   |
| `timestamp without time zone`                             | `timestamp`                         | **see below**                     |
| `json`, `jsonb`                                           | `json`                              |                                   |
| enum (`typtype = 'e'`)                                    | `jsonEnum` + members from `pg_enum` |                                   |
| `citext`                                                  | `ExtensionType` `citext`            |                                   |
| `vector`                                                  | `ExtensionType` `vector(n)`         | `n` from `atttypmod`              |
| domain (`typtype = 'd'`)                                  | its base type                       | constraint lost — warn            |
| `uuid`, `inet`, `bytea`, `tsvector`, any array, any range | —                                   | omitted (see the policy below)    |

Pay particular attention to `timestamp without time zone`. The forward map emits `TIMESTAMPTZ` deliberately, because plain `TIMESTAMP` in Postgres stores the wall clock and forgets the offset. So a
round trip through zmdb _changes that column's type_, which is an improvement and a surprise, and the warning says so rather than letting a `pull` quietly rewrite a table's semantics on the next
`push`.

**MySQL.**

| Catalog type                            | Maps to                 | Note                                   |
| --------------------------------------- | ----------------------- | -------------------------------------- |
| `int`, `mediumint`                      | `integer`               |                                        |
| `bigint`                                | `bigint`                |                                        |
| `tinyint(1)`                            | `boolean`               | the `COLUMN_TYPE` read exists for this |
| `tinyint`, `smallint` (other widths)    | `integer`               | widened — warn                         |
| `decimal`                               | `numeric` + precision   |                                        |
| `varchar(n)`                            | `varchar` + `Length<n>` |                                        |
| `text`, `mediumtext`, `longtext`        | `text`                  | the size class is lost — warn          |
| `datetime(3)`                           | `timestamp`             |                                        |
| `datetime` (other fsp)                  | `timestamp`             | forward emits `DATETIME(3)` — warn     |
| `timestamp`                             | `timestamp`             | **see below**                          |
| `json`                                  | `json`                  |                                        |
| `enum(...)`                             | `jsonEnum` + members    |                                        |
| `set`, `bit`, `blob`, `binary`, spatial | —                       | omitted                                |

MySQL's `TIMESTAMP` converts to the session time zone and stops in 2038, which is exactly why the forward map chose `DATETIME(3)`. Same shape of surprise as the Postgres row, same warning.

**SQLite.** The map is over the declared text, upper-cased, because affinity means the text is not drawn from a fixed set:

| Declared text                     | Maps to                 | Note                                     |
| --------------------------------- | ----------------------- | ---------------------------------------- |
| `INTEGER`                         | `integer` or `serial`   | `serial` only under §5's exact rule      |
| `TEXT`                            | `text`                  |                                          |
| `VARCHAR(n)`                      | `varchar` + `Length<n>` | SQLite ignores the length; zmdb does not |
| `REAL`, `NUMERIC`, `DECIMAL(p,s)` | `numeric`               |                                          |
| `BLOB`                            | —                       | omitted                                  |
| anything else                     | its affinity            | warn, naming the declared text           |

The last row is not laziness: SQLite accepted the column, so refusing to snapshot it would make the snapshot less true than the database. Applying SQLite's own affinity rules and saying so is the
answer.

### The unrepresentable policy, in one rule

**Widen with a warning and a `// TODO` comment when the app type can round-trip the stored value. Omit the property with a warning when it cannot.** That is the whole rule, and it decides every row
above without a second list:

- Widened: a domain (the base type round-trips; the constraint is enforced by the database, so the declaration being weaker is a validation gap rather than data loss), `smallint`, `char(n)`, a `text`
  size class, a `datetime` precision.
- Omitted: `bytea` and `blob` (a `Buffer` is not a `string`, and `text` mangles it), arrays, `bit`, `set`, `tsvector`, ranges, `money`, geometry where PostGIS is not among the declared extensions.

And in both cases the column **stays in the snapshot** with its catalog type verbatim (§1), so `diff` sees it unchanged rather than as a drop. The `// TODO` comment names the catalog type, so the
person editing the generated file can see what was widened without re-reading the database.

## 4. Defaults are expressions, and they are kept verbatim

```ts
interface ColumnSnapshot {
  /**
   * The catalog spelling exactly as returned (`character varying`, `tinyint(1)`, `TEXT`).
   * Present on an introspected snapshot; `type` remains the normalized abstract type used by diff.
   */
  readonly catalogType?: string;
  /** The catalog's default expression, exactly as reported. Never evaluated. */
  readonly default?: string;
}
```

`diff` compares `type`, not `catalogType`. The latter is evidence for warnings and generated comments: aliases can normalize to one abstract type without erasing what the server actually said. If no
abstract type can represent the column, `type` retains the catalog spelling too; such a column cannot clean-diff against a declaration because no declaration can express it, which is the accurate
outcome.

A default in a catalog is a SQL expression string — `now()`, `CURRENT_TIMESTAMP`, `'user'::text`, `uuid_generate_v4()`, `nextval('users_id_seq')` — and none of those is a value. Evaluating one means
running it, which introspection must not do, and a faithful round trip has to reproduce the _expression_ rather than a photograph of what it returned once.

It lives on the snapshot and not on the IR, and that is the asymmetry `reflect/SPEC.md` §8 already records from the other side: `HasDefault` says a column has a default, not which one, because a tag
payload is a type-level literal and a default may be any expression the dialect accepts. So a declaration emitted from a snapshot carries `HasDefault` plus a comment holding the expression, and
re-stating it in DDL is a deliberate human act rather than something a generator guesses.

`nextval('…')` is not recorded as a default at all. It is how Postgres spells `serial`, it is consumed by §5, and recording it twice would make `push` emit both a `SERIAL` and a redundant `DEFAULT`.

**`diff` does not compare defaults, and this section is where that is frozen.** Servers normalise these strings: MySQL rewrites the case of `CURRENT_TIMESTAMP`, Postgres appends `::text` casts and
reformats whitespace. Comparing verbatim therefore reports an `alter` after a server upgrade that changed nothing, and comparing loosely means writing an expression normaliser for four root dialect
families' expression grammars — the same trade `../schema-objects/SPEC.md` §1.1 refuses for index expressions, for the same reason.

So the default is recorded, shown by `pull`, printed in the generated comment, and not diffed. When a drift report is requested, its normalization boundary explicitly removes `default` and
`catalogType` evidence before delegating to `diff`: the normalized abstract `type` is compared, while two server spellings of the same default remain review evidence rather than schema drift.

## 5. Recognising a generated key column, per dialect

- **Postgres** — either `column_default` matching `nextval('…')`, or `pg_attribute.attidentity` in `('a', 'd')` for `GENERATED ALWAYS`/`BY DEFAULT AS IDENTITY`. Both map to `Serial`. They are
  different DDL and the snapshot has one representation, so an identity column produces a warning: regenerating emits `SERIAL`, which is a sequence-backed default rather than an identity attribute,
  and that is a real change to the column even though every insert behaves the same.
- **MySQL** — `COLUMNS.EXTRA` contains `auto_increment`.
- **SQLite** — exactly a column declared `INTEGER PRIMARY KEY` on a table that is not `WITHOUT ROWID`, which is the rowid alias. The near misses all map to plain `integer`: `INT PRIMARY KEY` has
  integer affinity but is not the alias, an `INTEGER` column inside a composite key is not the alias, and neither is `INTEGER PRIMARY KEY` on a `WITHOUT ROWID` table. This rule is stated exactly
  because every part of it is easy to get wrong in the direction that emits a `Serial` for a column the database does not generate.

## 6. The emitted declaration

**One printer, not a second one.** `scripts/codemod-tagged-schema.mjs` already turns column facts into a tagged property, and it already solves the two problems a fresh printer would rediscover: the
tag order, and that nullability is `(T & Tags) | null` with the tags _inside_, because TypeScript distributes an intersection over a union and `null & Unique` reduces to `never` — silently dropping
the nullability. `emitDeclarations` is that printer promoted to a library function, and the codemod becomes a caller.

A second printer is the four-walkers problem from `schema-core/src/ir/SPEC.md` §1, in a new place.

Tag order, frozen as the codemod already emits it: the base type, `Sql<…>` or `Ext<…>`, `Length<…>`, then `Serial` or `HasDefault` (never both — `Serial` implies it), `PrimaryKey`, `Unique`,
`Sensitive`, `References<…>`, the constraint tags in their vocabulary order, and `Rule<…>` last.

**One file per table**, named from the physical table name. A single file grows to thousands of lines and makes every regeneration a conflict in one place; a name derived from the database needs no
naming decision at generation time. An `index.ts` barrel re-exports them, which is the file a person imports.

**The interface name is cosmetic, and that is deliberate.** Deriving `User` from `users` is the naming strategy run backwards, and a strategy is not invertible: `snakeCasePlural` is not injective, and
no rule recovers `person` from `people` without the irregular table that produced it. So the emitter does not invert anything. It splits on `_`, PascalCases, and singularises through the same small
explicit rule set and irregular table used by OpenAPI component naming.

That pure lower-level function is exported from `@zmdb/query-compiler/naming`, allowing both the emitter and `@zmdb/schema-core/openapi` to reuse it without reversing the package graph. Where the
result is not a safe or unique TypeScript identifier, the emitter uses a deterministic fallback and warns.

The safety here is structural rather than careful: `Table<'…'>` always carries the physical table name verbatim, so an imperfect interface name costs nothing beyond aesthetics and can never produce a
wrong query. The one risky inversion in this module is confined to an identifier nothing reads.

**Property names are the physical column names, and inversion is not attempted there either** — for the same reason, with a better remedy. A project that wants camelCase properties turns a naming
strategy on and renames the properties by hand, and `Physical<'…'>` from the naming epic is what makes each of those a local edit rather than a schema change.

**The header names the source and carries no timestamp.**

```ts
// Generated by zmdb introspection from a postgres database. Do not edit; regenerate instead.
// Snapshot version 1. Hand edits are overwritten wholesale.
```

No timestamp, no server version, no absolute path, and no hand-edit preservation. A timestamp makes every regeneration a diff, which turns "no drift" into a commit and trains everyone to ignore the
file. Claiming to preserve hand edits would mean a merge, and a generator that merges is a generator that is sometimes wrong about which side won.

The source dialect comes from the required `EmitOptions.dialect`; a `SchemaSnapshot` is deliberately dialect-neutral and cannot supply it without contaminating every declared snapshot with connection
metadata.

## 7. Determinism

Tables sorted by name. Tags in §6's fixed order. The output run through the repository formatter, so a regeneration produces no incidental whitespace diff and the file looks like the rest of the
codebase. Nothing in the output moves between two runs against the same database.

Columns are emitted **in name order**, not in ordinal position, and this is a deliberate departure from what the epic asked for. `emitDeclarations` takes a `SchemaSnapshot`, whose columns are already
sorted by name (`../migrations/SPEC.md` §1), so ordinal position is not available at that point — and carrying it into the snapshot would be worse than losing it: a column's ordinal is a fact about
physical layout that no zmdb DDL controls, since a column added by a migration lands last, so recording it would make a diff report a change every time two databases reached the same schema by
different routes.

Legibility is worth less than a snapshot that does not lie.

## 8. The drift check

`detectDrift(live, declared, opts)` is one normalization boundary around the migration comparator, not a second comparator:

```ts
onlyInDatabase = diff(normalizedDeclared, normalizedLive);
onlyInDeclarations = diff(normalizedLive, normalizedDeclared);
clean = onlyInDatabase.length === 0 && onlyInDeclarations.length === 0;
```

The two lists retain `ChangeOp` payloads, so a finding names the table, column and differing types rather than reducing the result to a boolean. As migration `diff` gains an operation, drift sees it
through both calls without another implementation.

Normalization has three explicit rules:

1. Table selection reuses the catalog reader's glob matcher. With no `exclude`, `_zmdb_migrations` is omitted. An explicit list replaces the default, so a caller adding custom bookkeeping patterns
   also names the ledger when it should remain excluded.
2. `catalogType` and `default` are removed from the compared copies. Catalog aliases have already collapsed into the abstract `type`, and §4 makes defaults evidence rather than a compared field.
   Neither input snapshot is mutated.
3. With `{ dialect: 'mysql' }`, a live non-unique btree index is omitted only when its name is the foreign key name or `<foreign-key>_idx` and its plain column list exactly equals that foreign key's
   columns. That is the index InnoDB creates or zmdb emits solely to support the constraint. A differently named, partial, expression, unique or differently shaped index remains.

The shipped migration comparator currently reports table presence, column presence, normalized type changes and declared extensions. The richer ordered-key, foreign-key and index evidence is preserved
by normalization for the migration slices that add their `ChangeOp` arms; drift does not pre-implement them.

Not compared: default expressions (§4); objects in schemas outside `schemas`; and objects the connecting role cannot see, which `information_schema` reports as absent (§2). The migration ledger and
configured bookkeeping tables are removed before comparison.

Also not reported by the current migration comparator: check constraints, triggers, procedures, grants, partial-index predicates and collations. The eventual command says so in its own output.
Implying completeness is how a green `check` becomes the reason nobody looked.

Exit behaviour, since this runs in CI:

| Code | Meaning                                                    |
| ---- | ---------------------------------------------------------- |
| 0    | no drift                                                   |
| 1    | drift; the op list is the output, and `--json` emits it    |
| 2    | introspection itself failed — unreachable, unauthorised, … |

Two codes rather than one, because CI treats every non-zero alike and "the database was unreachable" must not be reported to a human as "your schema has drifted".

## 9. The CLI boundary

This epic ships the library and stops there: `Introspector`, `snapshot`, `emitDeclarations` and `detectDrift`. `zmdb pull` and `zmdb check` belong to the CLI epic, where §2.6's invariant says a
command is argument parsing plus one library call — so a command that grows a catalog query or a private comparison is a command doing this module's job. The driver and the schema list come from the
resolved config (#492). Neither side keeps a private copy of the catalog SQL.

## 10. Non-goals (rejected)

- **Introspecting triggers, procedures, grants or policies.** There is no snapshot field for them, and §8 says so rather than half-reading them.
- **Preserving hand edits across a regeneration.** §6.
- **Inverting a naming strategy.** §6 — not invertible, and the emitter does not need it to be.
- **Evaluating a default expression.** §4.
- **Diffing default expressions.** §4 — the drift normalization removes them rather than guessing whether two dialect expressions are equivalent.
- **A hand-written SQL parser for `sqlite_master.sql`.** It is a last resort for facts the pragmas do not carry, every use warns, and it is never the source for a fact a pragma reports.

## 11. Database-package boundary (issue #666)

This section supersedes the central `createIntrospector(dialect: Dialect)` dispatch for the epic #665 target. The current dispatch remains shipped behavior until the implementation children land.

### 11.1 Vendor-neutral protocol

`@zmdb/query-compiler/introspect` keeps the catalog result types, strict row-field helpers, declaration emitter and two-snapshot drift algorithm. It exports no official introspector and knows no
official database name.

```ts
export interface IntrospectionDriver {
  execute(query: CompiledQuery): Promise<readonly Record<string, unknown>[]>;
}

export interface IntrospectOptions {
  readonly schemas?: readonly string[];
  readonly include?: readonly string[];
  readonly exclude?: readonly string[];
}

export interface Introspector<Name extends string = string> {
  readonly name: Name;
  snapshot(driver: IntrospectionDriver, options?: IntrospectOptions): Promise<CatalogSchemaSnapshot>;
  normalizeForDrift(snapshot: CatalogSchemaSnapshot, role: 'live' | 'declared'): SchemaSnapshot;
}
```

The selected `SqlDialect<Name>` carries one `Introspector<Name>`. Callers use `dialect.introspector.snapshot(...)`; there is no factory, registry, string switch, dynamic package lookup or
import-side-effect registration. `normalizeForDrift` owns catalog noise that only one database can identify. `detectDrift` remains generic and compares the two normalized snapshots.

`emitDeclarations` receives the selected `SqlDialect` rather than a string. It uses `dialect.name` only in generated provenance and consumes already-normalized catalog facts; it does not dispatch
catalog parsing or reverse type maps.

### 11.2 One owner for every current catalog path

| Current unit                                                         | Future owner                                                                                              |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `common.ts` catalog snapshots, errors and strict row helpers         | `@zmdb/migrations/introspect`                                                                             |
| `emit.ts` and `tagged-property.ts` deterministic TypeScript emission | `@zmdb/migrations/declarations`                                                                           |
| `drift.ts` generic exclusion and comparison                          | `@zmdb/migrations/introspect`                                                                             |
| `drift.ts` MySQL implicit foreign-key support-index removal          | `@zmdb/mysql` via `normalizeForDrift`                                                                     |
| `postgres.ts` and its parser/catalog tests                           | `@zmdb/postgres`                                                                                          |
| `mysql.ts` and `__fixtures__/mysql-8.4.11.json`                      | `@zmdb/mysql`                                                                                             |
| `sqlite.ts` and its pragma/catalog tests                             | `@zmdb/sqlite`                                                                                            |
| `index.ts` Cockroach wrapper over the PostgreSQL reader              | `@zmdb/cockroach`, implemented by composing the public PostgreSQL reader and explicit Cockroach overrides |
| `index.ts` SingleStore wrapper over the MySQL reader                 | `@zmdb/singlestore`, implemented by composing the public MySQL reader and explicit SingleStore overrides  |
| `index.ts` SQL Server unsupported branch                             | replaced by `@zmdb/mssql` catalog implementation                                                          |
| `index.ts` public result/protocol exports                            | `@zmdb/migrations/introspect`                                                                             |

`introspect.spec.ts` is split by assertion ownership: common malformed-row, deterministic-filtering and generic result-shape tests move with `@zmdb/migrations`; SQLite and MySQL expectation rows move
to those packages. `postgres.spec.ts` moves in full. `emit.spec.ts` moves to the declarations subpath except for any database-specific normalization fixture, which moves to that database package.

### 11.3 Package requirements

Each database package exports its named introspector by identity and embeds it in its dialect object:

```ts
export const postgresIntrospector: Introspector<'postgres'>;
export const postgres: SqlDialect<'postgres'>; // postgres.introspector === postgresIntrospector
```

Equivalent identity rules apply to the other five packages. A family child may reuse a parent catalog query or parser only through a public frozen parent export. The child still owns:

- a real-server fixture proving inherited queries against the child server;
- explicit normalization for every observed catalog difference;
- its own `name`, warnings, refusals and evidence; and
- a test that parent objects are unchanged after the child loads.

Blind delegation is not qualification. SQL Server must read columns, identity, keys, indexes, defaults and foreign keys before `@zmdb/mssql` can be supported. MySQL's captured fixture remains a
deterministic parser test but does not replace its required live lane.

### 11.4 Failure and evidence policy

Catalog queries are parameterized `CompiledQuery` values. A malformed row throws `CatalogRowError` before partial output is returned. A requested construct that the package deliberately cannot
represent produces a stable warning only when the snapshot remains exact; inability to produce an exact snapshot is an explicit `UnsupportedFeatureError`, never an omitted object.

Every package's required server lane must:

1. create the package's representative schema through its own migration dialect;
2. introspect through its exported public object;
3. compare keys, foreign keys, indexes, generated/default facts and package-specific objects;
4. normalize and obtain a clean generic drift report; and
5. run from the packed package in an external consumer.

A required lane fails if its service is absent. An optional developer invocation may report a visible skip, but that result is not support evidence.

## 12. Generic tooling owner after extraction (#626)

The generic catalog protocols, common row validation, drift operation, selection rules and declaration emitter move to `@zmdb/migrations/introspect` and `@zmdb/migrations/declarations`.
Database-specific readers still move to the database packages frozen in §11.

Accordingly, §11.2's `index.ts` public result/protocol owner is `@zmdb/migrations/introspect`, not `@zmdb/query-compiler`. `emit.ts` and `tagged-property.ts` move to the declarations subpath, which
owns the sole `oxfmt` edge. The old query-compiler introspection subpath has no permanent forwarding owner; release governance chooses its removal version.
