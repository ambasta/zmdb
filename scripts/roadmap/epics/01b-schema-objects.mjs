// The rest of the schema-side gaps: extension-backed column types, the missing DDL-to-declaration
// direction, and stored routines. Each of these widens what a declaration or a snapshot can contain.

export const SCHEMA_OBJECT_EPICS = [
  {
    key: 'extensions',
    title: '[EPIC] Database extensions and extension-backed column types (vector, geometry, citext)',
    labels: ['enhancement', 'area:schema', 'area:dialects'],
    pages: ['db-extensions', 'guide-vector-search', 'guide-postgis'],
    packages: ['@zmdb/schema-core', '@zmdb/query-compiler'],
    motivation: `
\`SqlType\` is a closed union of eleven types (packages/schema-core/src/index.ts:21) and \`ddlType\`
resolves a column through \`DDL_TYPES[dialect][col.type]\` (packages/query-compiler/src/migrations/index.ts:197).
Both are the right design for a fixed vocabulary and both make \`vector(1536)\`, \`geometry(Point,4326)\`
and \`citext\` unreachable: there is no name for them and no DDL mapping to give them.

Three docs pages depend on this and two of them say so outright — the vector-search and PostGIS guides
each note that they depend on database extensions. That is the actual shape of the gap: an embedding
column is not an exotic requirement any more, and a data layer that cannot declare one cannot be used
for the most common thing people build in 2026.

There are two halves and they are separable. The first is \`CREATE EXTENSION IF NOT EXISTS\` as a
first-class migration object, ordered before anything that uses it. The second is a way for a column
to have a type the core vocabulary does not enumerate — which is a decision about whether \`SqlType\`
stays closed. \`packages/schema-core/src/custom-types\` already handles the *value* half of a custom
type (\`CustomType<Wire, TS, DB>\` with encode/decode), so the missing piece is specifically the DDL
type and the operator surface, not serialisation.
`,
    dod: [
      'An extension is a declared schema object; `CREATE EXTENSION IF NOT EXISTS "vector"` is emitted, ordered before any table that uses one of its types, and `diff` treats adding one as an op.',
      'A column can carry an extension-backed type with parameters (`vector(1536)`, `geometry(Point, 4326)`) that survives declaration → IR → snapshot → DDL, without `SqlType` becoming an open string.',
      'The distance operators vector search needs (`<->`, `<=>`, `<#>`) are available in `orderBy` and in a select expression, parameterised, with the operator set closed rather than caller-supplied.',
      'The PostGIS predicates the guide needs (`ST_DWithin`, `ST_Contains`) are reachable with the geometry column typed on both sides.',
      'A non-Postgres dialect refuses an extension type with a message naming the dialect, rather than emitting DDL that cannot run.',
      'All three pages flip to supported, with a working similarity-search example and an index (`ivfflat`/`hnsw`) on the vector column.',
    ],
    invariants: [
      '§2.4 explicit SQL: a distance operator is emitted from a closed set, never interpolated from a caller string. Issue #364 is the precedent — an operator allowlist reachable by a user-controlled key is a real vulnerability, and this epic adds operators to exactly that kind of surface.',
      '§2.5 no `as`: an extension type must be expressible in the tag vocabulary so a `number[]` embedding column is typed without a cast.',
      '§2.9 one front-end: the parameterised type is read from the declaration once; `ddlType` and the validator must not each parse `vector(1536)`.',
      '§1 cost model: an embedding column is 1536 floats. Nothing may copy or validate it per element on a read path unless the caller asked for validation — and if it does validate, the cost must be stated in the docs.',
    ],
    subs: [
      {
        key: 'spec',
        title: '[Spec Freeze] extensions as schema objects, and how a column names a type SqlType does not list',
        labels: ['spec'],
        goal: `
Decide the extension-type mechanism and freeze it: whether \`SqlType\` gains members, gains an
escape, or is replaced by something composable — and what carries a type parameter like a vector
dimension. Then freeze extension ordering, the operator set, and the per-dialect refusals. No code.
`,
        why: `
This is a vocabulary decision with a long tail, so it is worth getting right once. Widening
\`SqlType\` with \`'vector' | 'geometry' | 'citext'\` is the smallest change and puts Postgres
extension types in the core vocabulary of a library that also targets MySQL and SQLite. Opening it to
\`string\` deletes the exhaustiveness checking that makes \`DDL_TYPES\` safe. A third option — a
branded extension-type descriptor that lives alongside \`SqlType\` — keeps the core closed at the cost
of touching every consumer of \`ColumnSnapshot.type\`.

The dimension parameter is a second decision of the same kind: \`length\` already exists on
\`ColumnSnapshot\` for \`varchar\`, and a vector dimension is the same idea, but \`geometry(Point, 4326)\`
takes two parameters of different kinds. Deciding this before implementation is what stops a
\`params: string[]\` field that becomes a dumping ground.
`,
        files: [
          '`packages/schema-core/src/ir/SPEC.md` — the extension-type vocabulary and its IR carriage.',
          '`packages/query-compiler/src/schema-objects/SPEC.md` — extensions as objects, and their ordering.',
          '`packages/query-compiler/src/SPEC.md` — the operator additions.',
        ],
        api: `
/** An extension-backed column type, kept out of the closed \`SqlType\` union. */
export interface ExtensionType {
  readonly extension: string;             // 'vector' | 'postgis' | 'citext'
  readonly name: string;                  // 'vector' | 'geometry'
  readonly args?: readonly (string | number)[];  // [1536] | ['Point', 4326]
}

/** The declaration-side tag. */
export type Ext<E extends string, N extends string, A extends readonly (string | number)[] = []> =
  { readonly __zmdbExt?: [E, N, A] };

export interface ExtensionDef {
  readonly name: string;
  readonly schema?: string;
  readonly version?: string;
}
`,
        steps: [
          'Choose the vocabulary mechanism and write down what the other two options cost. Recommended framing: keep `SqlType` closed and add an `ExtensionType` alternative to `ColumnSnapshot.type`, because that keeps `DDL_TYPES` exhaustively checked (the property that makes it safe) and confines the change to the places that resolve a type name.',
          'Specify the type-parameter form (`args`) and how it is rendered per parameter kind: a number is emitted bare, a string identifier bare, a string literal quoted. `geometry(Point, 4326)` is the test case that distinguishes these.',
          'Specify extension ordering in `emitUp`: extensions first, then types that depend on them, then tables, then indexes. State that this ordering is part of the contract because a `vector` column in a table created before the extension fails.',
          'Specify `diff` for extensions: adding one is an op; removing one is *not* automatically emitted as `DROP EXTENSION`, because dropping an extension can cascade to objects the snapshot does not own. Decide and justify.',
          'Specify the operator set: `<->` (L2), `<=>` (cosine), `<#>` (inner product) for pgvector, and the PostGIS predicates as functions rather than operators. Require them to be a closed enum in the compiler surface, and reference #364 explicitly as the reason no caller-supplied operator string is acceptable.',
          'Specify the vector index forms (`ivfflat` with `lists`, `hnsw` with `m`/`ef_construction`) and how `IndexDef` carries a method and options — this is a third `IndexDef` extension after the expression form, so coordinate the shape with that epic.',
          'Specify the app/wire/DB triple for each type, since the project requires all three to be answered: a vector is `number[]` in Node, a `vector` column in Postgres, and an array of numbers in OpenAPI/JSON Schema (with the dimension as `minItems`/`maxItems`, which is free validation the declaration already implies). Do the same for geometry — probably GeoJSON on the wire — and citext (a plain string).',
          'Specify the refusal: `mysql` and `sqlite` reject an extension type at DDL time with a message naming the dialect and the type. Do not attempt a fallback mapping to `TEXT`; a silently degraded embedding column is a data-loss bug.',
        ],
        tests: ['None — spec only.', '`yarn validate:spec` green.'],
        dod: [
          'Vocabulary mechanism chosen with the alternatives costed in writing.',
          'Parameter rendering, extension ordering, diff policy, closed operator set, vector index options and the three-type triple for each new type all frozen.',
          'Per-dialect refusal specified, with no silent fallback.',
        ],
      },
      {
        key: 'tests',
        title: '[Tests Freeze] extension types — DDL, ordering, operators, refusals',
        labels: ['spec'],
        blockedBy: ['spec'],
        goal: 'Land failing tests for extension DDL and ordering, parameterised type rendering, distance operators in `orderBy` and projections, vector index DDL, the derived types, and every refusal.',
        files: [
          '`packages/query-compiler/src/migrations/migrations.spec.ts`',
          '`packages/query-compiler/src/schema-objects/schema-objects.spec.ts`',
          '`packages/query-compiler/src/query-compiler.spec.ts` — operators.',
          '`packages/schema-core/src/schema-core.spec.ts` and `json.type-test.ts` — derived types.',
        ],
        tests: [
          '`emits CREATE EXTENSION IF NOT EXISTS before any table that uses it` — asserts the statement order, not just presence.',
          '`renders a parameterised extension type` — `vector(1536)` and `geometry(Point, 4326)`, showing the two parameter kinds.',
          '`orders by a cosine distance with the query vector parameterised` — full SQL plus params, so an interpolated vector fails.',
          '`projects a distance as a selected column with an alias`.',
          '`emits an ivfflat index with its lists option` and `emits an hnsw index with m and ef_construction`.',
          '`emits ST_DWithin as a predicate with typed arguments`.',
          '`refuses an extension type on mysql, naming the dialect and the type`, and the same for sqlite.',
          '`refuses a caller-supplied distance operator string` — the #364-shaped test: an operator that is not in the closed set is rejected, including one reached via an inherited property.',
          '`derives number[] with the dimension as minItems and maxItems in JSON Schema`.',
          '`does not drop an extension on diff` — per the spec policy.',
          "Type-level: an embedding column is `number[]` with no cast; a geometry column's app type is what the spec chose.",
        ],
        steps: [
          'Write the operator-injection test deliberately in the shape of issue #364 (a prototype-inherited key reaching the allowlist), because that is the exact bug class this epic could reintroduce.',
          'Assert full statements including order for the extension test; an ordering bug is invisible to a presence assertion and fatal in a real migration.',
          'Add the `ExtensionType` types so tests compile, with `ddlType` still unaware of them so failures are behavioural.',
        ],
        dod: [
          'Ordering, parameter rendering, operators, index options, refusals and the injection case all have named failing tests.',
        ],
      },
      {
        key: 'ddl',
        title: 'Extensions as schema objects, and extension-backed column DDL',
        labels: ['enhancement'],
        blockedBy: ['tests'],
        goal: 'Implement `ExtensionDef` as a schema object with ordered emission, and teach the type resolution path to render an `ExtensionType` with its parameters — keeping `DDL_TYPES` exhaustively checked for the closed union.',
        files: [
          '`packages/query-compiler/src/schema-objects/index.ts` — `ExtensionDef`, `createExtensionDdl`.',
          '`packages/query-compiler/src/migrations/index.ts` — `ColumnSnapshot.type` widening, `ddlType`, `emitUp` ordering, `diff`.',
          '`packages/schema-core/src/ir/index.ts` and `src/tags/index.ts` — the `Ext` tag and its IR carriage.',
          '`packages/compiler/src/reflect/index.ts` — read the tag.',
        ],
        steps: [
          'Add the tag and read it in the reflection, carrying an `ExtensionType` into the IR. Keep `Sql<...>` untouched for the closed vocabulary — a column has one or the other, and the type makes that exclusive.',
          'Widen `ColumnSnapshot.type` to `SqlType | ExtensionType` and fix every consumer the compiler now flags. Do not add a default branch that swallows the new case; the exhaustiveness error at each site is the audit list.',
          'Render parameters per kind, and quote a string literal parameter — `geometry(Point, 4326)` has an unquoted identifier and a number, while a hypothetical string-literal parameter would need quoting, so implement the rule the spec chose rather than assuming everything is bare.',
          'Emit extensions first in `emitUp`, and make the ordering explicit in code (a phase list) rather than incidental to iteration order.',
          'Refuse on mysql/sqlite at DDL time with the specified message, and make sure the refusal is reported by the runner rather than skipped.',
          'Implement the vector index method and options on `IndexDef`, coordinating with the expression-index change so `IndexDef` grows once.',
          'Derive the JSON Schema / OpenAPI shape for each new type, including the dimension as `minItems`/`maxItems`, and make sure the validator emitted for a vector column does not walk 1536 elements on a read path unless validation was requested.',
        ],
        tests: [
          'All DDL, ordering, index and refusal tests go green.',
          '`keeps DDL_TYPES exhaustive over SqlType` — a type-level test that adding a `SqlType` member without a DDL mapping is a compile error.',
          '`does not validate a vector element-wise on the default read path` — assert via a counting validator or by inspecting the emitted validator.',
        ],
        dod: [
          'Extensions emitted in a documented phase order; parameterised types rendered per kind.',
          '`SqlType` still closed and `DDL_TYPES` still exhaustive, proven by a type-test.',
          'Refusals explicit on mysql and sqlite; `IndexDef` grown once, with the expression epic.',
        ],
      },
      {
        key: 'operators',
        title: 'Distance operators and spatial predicates, from a closed set',
        labels: ['enhancement'],
        blockedBy: ['ddl'],
        goal: 'Add the pgvector distance operators and the PostGIS predicates the guides need, as a closed enum reachable from `orderBy`, `where` and projections, with every operand parameterised.',
        why: 'This is the security-sensitive slice. The existing operator allowlist has already had a prototype-pollution-shaped bug (#364); adding operators to it, plus a function-call surface, is exactly where that class of bug returns.',
        files: [
          '`packages/query-compiler/src/index.ts` — the where/orderBy/projection compilers.',
          '`packages/query-compiler/src/operators/index.ts` (or wherever the allowlist lives).',
          '`packages/query-compiler/src/functions/index.ts` (new, if spatial predicates need a function surface).',
        ],
        api: `
export type DistanceOp = 'l2' | 'cosine' | 'innerProduct';
export function distance<C extends string>(column: C, op: DistanceOp, query: readonly number[]): OrderExpr;
export function stDWithin(column: string, point: GeoPoint, metres: number): WhereFragment;
`,
        steps: [
          'Map the three distance operators to their SQL tokens through a plain object literal with a `satisfies Record<DistanceOp, string>` so a missing entry is a compile error, and look it up only after checking the key is in the set with `Object.hasOwn` — the two-step is what prevents an inherited key resolving.',
          'Parameterise the query vector. A 1536-element vector interpolated into SQL is both an injection surface and a plan-cache disaster; bind it.',
          "Decide the parameter encoding for a vector: pgvector accepts a string literal form `'[1,2,3]'`. Encode it in the driver/codec layer using the existing `CustomType` machinery rather than in the SQL string.",
          'Add spatial predicates as typed functions, not as an open function-call builder. An open builder is a second query language and a second injection surface; the guides need two predicates, so ship two.',
          'Type the operands: a distance operator on a non-vector column is a compile error, and `ST_DWithin` requires a geometry column. This is where the extension type earns its keep.',
        ],
        tests: [
          'All operator tests go green.',
          '`refuses a caller-supplied distance operator string`, including the inherited-property case.',
          '`binds the query vector as a parameter` — assert the params array contains the encoded vector and the SQL contains a placeholder.',
          'Type-level: a distance operator on a text column, and `ST_DWithin` on a non-geometry column, are both compile errors.',
        ],
        dod: [
          'Operators closed, looked up safely, and type-constrained to the right column types.',
          'Query vectors bound as parameters, encoded through the custom-type layer.',
          'Two spatial predicates shipped; no open function-call builder.',
        ],
      },
      {
        key: 'docs',
        title: '[Docs] extensions, vector similarity search and PostGIS geometry',
        labels: ['documentation'],
        docs: true,
        blockedBy: ['ddl', 'operators'],
        goal: 'Flip all three pages to supported, with a complete, runnable similarity-search example including the index, and honest per-dialect scope.',
        files: [
          '`docs-site/pages.mjs`, `docs-site/content/db-extensions.md`, `docs-site/content/guide-vector-search.md`, `docs-site/content/guide-postgis.md`',
          '`docs-site/content/custom-types.md` — cross-link, since the value codec half lives there.',
        ],
        steps: [
          'Write the vector guide as an end-to-end recipe: declare the column, emit the extension and the table, build the `hnsw` index, insert embeddings, query nearest neighbours with a bound vector. A partial example on this page is useless — the whole point is that it works.',
          "State the index trade-off plainly (recall versus build time and memory) and point at pgvector's own documentation for tuning rather than paraphrasing it.",
          'Document that these types are Postgres-only, and what happens on mysql/sqlite (a refusal, named).',
          'Document the extension-ordering guarantee in the migration, since that is what makes the DDL work.',
          'Document the validation cost of a large vector and how to avoid paying it.',
          'Refresh README counts.',
        ],
        tests: ['`node docs-site/build.mjs`, `yarn verify:docs-coverage` green.'],
        dod: [
          'Three pages supported; the vector guide is end-to-end and runnable; Postgres-only scope stated; validation cost documented.',
        ],
      },
    ],
  },

  {
    key: 'introspect',
    title: '[EPIC] Introspection — the DDL-to-declaration direction',
    labels: ['enhancement', 'area:schema', 'area:cli', 'parity:drizzle', 'parity:mikro-orm'],
    pages: ['schema-first'],
    packages: ['@zmdb/query-compiler', '@zmdb/schema-core'],
    motivation: `
zmdb only runs one way. A declaration becomes a snapshot, a snapshot becomes DDL, and there is no
path back — the \`schema-first\` page says it outright: "schema objects are the only source of truth,
there is no DDL-to-schema direction".

That closes the door on every existing database. A team with a live schema cannot adopt zmdb
incrementally; they would have to hand-write declarations for every table and then hope the two agree.
Which is schema drift — the exact problem in the project's one-line pitch — reintroduced at the moment
of adoption.

The valuable output is not a snapshot, it is *TypeScript*. zmdb's declarations are types, so
introspection here means generating \`interface User extends Table<'users'>\` with the right tags. That
makes this the inverse of the reflection: the reflection reads a type and produces an IR, and this
reads a catalog and produces a type. It also gives the project something no other ORM's introspection
can do — because in every other ORM the generated artefact is a runtime schema object, and here it is
a declaration that can then be checked against the database it came from.

That check is the second half: once introspection exists, drift becomes detectable. A CI step can
introspect the real database, compare it to the declarations, and fail on a difference.
`,
    dod: [
      'A dialect-specific catalog reader produces a `SchemaSnapshot` from a live database: tables, columns, types, nullability, defaults, primary keys, foreign keys, indexes.',
      'A TypeScript emitter turns a snapshot into declaration source: one interface per table with the right tags, correct app types, and a deterministic, formatted output.',
      'A round trip is proven: declaration → DDL → real database → introspect → declaration produces an equivalent declaration, tested against real sqlite and real Postgres.',
      'A drift check compares an introspected snapshot to the declared one and reports the differences in both directions.',
      'Types the emitter cannot represent are reported as named warnings with a `// TODO` in the output, never silently dropped or widened to `unknown`.',
      '`schema-first` flips to supported with an incremental-adoption guide.',
    ],
    invariants: [
      '§2.9 one front-end: introspection produces the *same* `SchemaSnapshot` the declaration path produces, so `diff` works across a declared and an introspected snapshot with no translation layer.',
      '§2.5 no `as`: catalog rows are external data and must be validated, not asserted. This is a validation boundary and the project has a validator for it.',
      '§2.4 explicit SQL: catalog queries are ordinary compiled queries, parameterised, not string-built.',
      'Generated code is checked in and read by humans: it must be deterministic (stable ordering) and formatted by the repo formatter, or every regeneration is a diff.',
    ],
    nonGoals: [
      'Introspecting views, triggers, or stored routine bodies into declarations (the routines epic owns routines).',
      'Round-tripping arbitrary hand-written SQL DDL. The input is a live database, not a `.sql` file.',
      'Preserving hand edits to generated files across regeneration. The output is generated; edits belong in a separate file.',
    ],
    subs: [
      {
        key: 'spec',
        title: '[Spec Freeze] the catalog-to-snapshot mapping and the declaration emitter',
        labels: ['spec'],
        goal: "Freeze what is read from each dialect's catalog, how each database type maps back to a `SqlType` and an app type, what the emitted declaration looks like, and what happens to anything unrepresentable. No code.",
        why: 'The reverse type mapping is not the forward one inverted. Forward, `Sql<\'text\'>` becomes `TEXT`; backward, Postgres reports `character varying`, `varchar`, `text`, `citext` and a dozen aliases, several of which map to the same `SqlType` and one of which (a domain type, or an enum) maps to none. A spec that says "map the type back" will produce an emitter that widens the awkward cases to `unknown` and calls it success.',
        files: [
          '`packages/query-compiler/src/introspect/SPEC.md` (new)',
          "`packages/schema-core/src/ir/SPEC.md` — the declaration emitter's output shape.",
        ],
        api: `
export interface Introspector {
  readonly dialect: Dialect;
  snapshot(driver: Driver, opts?: IntrospectOptions): Promise<SchemaSnapshot>;
}

export interface IntrospectOptions {
  readonly schemas?: readonly string[];   // default: the dialect's default schema
  readonly include?: readonly string[];   // table name globs
  readonly exclude?: readonly string[];   // e.g. migration bookkeeping tables
}

export interface EmitDeclarationsResult {
  readonly files: readonly { readonly path: string; readonly source: string }[];
  readonly warnings: readonly { readonly table: string; readonly column?: string; readonly reason: string }[];
}
export declare function emitDeclarations(snapshot: SchemaSnapshot, opts?: EmitOptions): EmitDeclarationsResult;
`,
        steps: [
          'Write the catalog query plan per dialect and name the sources: Postgres `information_schema` plus `pg_catalog` (the latter is needed for index expressions and extension types, which `information_schema` does not expose); MySQL `information_schema`; SQLite `sqlite_master` plus `PRAGMA table_info`/`index_list`/`foreign_key_list`.',
          'Write the reverse type table per dialect, listing the aliases that collapse to one `SqlType`, and specify the policy for a type with no mapping: a warning plus a `// TODO` comment and the closest representable type, or a warning plus omission of the column. Choose omission for anything whose misrepresentation would lose data, and say which those are.',
          'Specify default-value handling. A column default in the catalog is a SQL expression string, and `HasDefault` in the declaration is a flag. Decide whether the expression is preserved (needed for a faithful round trip) and where it lives on `ColumnSnapshot`.',
          'Specify how a serial/identity column is recognised per dialect — Postgres reports a sequence default or an identity attribute, MySQL an `auto_increment` extra, SQLite an `INTEGER PRIMARY KEY` — and that it maps back to `Serial`.',
          'Specify the emitted declaration exactly: file layout (one file, or one per table), interface naming (singular PascalCase from a plural table, which needs the naming strategy inverted — name that dependency), tag order, and the header comment marking the file generated.',
          'Specify determinism: tables sorted, columns in ordinal position, tags in a fixed order. Say that the output is formatted with the repo formatter so a regeneration produces no incidental diff.',
          'Specify the drift check output: what is compared, what is ignored (bookkeeping tables), and the exit behaviour, since this will run in CI.',
          'Specify the relationship to the CLI: this epic ships the library; the `pull` command belongs to the CLI epic. Name the dependency in that direction so neither builds a private copy.',
        ],
        tests: ['None — spec only.', '`yarn validate:spec` green.'],
        dod: [
          'Per-dialect catalog sources named, including why `pg_catalog` is needed alongside `information_schema`.',
          'Reverse type table with alias collapsing and an explicit unrepresentable policy.',
          'Default, serial/identity, naming-inversion, determinism and drift-check behaviours frozen.',
          'The CLI boundary named.',
        ],
      },
      {
        key: 'tests',
        title: '[Tests Freeze] introspection — real databases, and the round trip',
        labels: ['spec'],
        blockedBy: ['spec'],
        goal: 'Land failing tests driven by real databases where possible: sqlite via `node:sqlite` in-process, Postgres against the benchmark harness container when available, and recorded catalog fixtures for MySQL.',
        why: 'Introspection is the one feature that cannot be honestly tested against a fake. A hand-written fixture of what we *think* `information_schema` returns tests our assumption, not the database. The repo already runs real sqlite E2E and a real Postgres benchmark, so real testing is established practice here.',
        files: [
          '`packages/query-compiler/src/introspect/introspect.spec.ts` (new) — sqlite, real.',
          '`packages/query-compiler/src/introspect/postgres.spec.ts` (new) — gated on a reachable server.',
          '`packages/query-compiler/src/introspect/__fixtures__/` — recorded catalog rows for MySQL, captured from a real server and annotated with when and from what version.',
          '`packages/query-compiler/src/introspect/emit.spec.ts` (new) — declaration emission snapshots.',
        ],
        tests: [
          '`reads tables, columns, nullability and primary keys from a real sqlite database`.',
          '`reads a composite primary key in declaration order`.',
          '`reads foreign keys with their referential actions`.',
          '`reads indexes including a unique one and an expression one`.',
          '`recognises a serial column per dialect` — three cases.',
          '`preserves a column default expression`.',
          '`round-trips a declaration through DDL, a real database and back` — the headline test: emit DDL, apply to real sqlite, introspect, emit declarations, and assert the result is equivalent to the input (compare snapshots, not source text).',
          '`emits deterministic, formatted declaration source` — two runs, identical bytes.',
          '`warns and comments rather than widening an unrepresentable type` — a Postgres domain or enum type.',
          '`excludes bookkeeping tables from the drift check`.',
          '`reports drift in both directions` — a column only in the database, and one only in the declarations.',
          '`skips the Postgres suite with an explicit message when no server is reachable` — so a skip is visible rather than a silent pass.',
        ],
        steps: [
          'Build the round-trip test first and let it drive the rest — it is the property that matters and it exercises every reader.',
          'Capture the MySQL catalog fixtures from a real server (the benchmark harness can run one via podman) and record the server version in the fixture file. A fixture with no provenance is an assumption.',
          "Make the Postgres gate explicit and loud when it skips; the repo's honesty policy on DNF benchmark cases is the right model for a skipped test suite too.",
        ],
        dod: [
          'Round-trip test written against a real database; per-dialect readers covered; MySQL fixtures have recorded provenance.',
          'Determinism, warnings and drift both directions all have named failing tests.',
          'A skipped Postgres suite announces itself.',
        ],
      },
      {
        key: 'readers',
        title: 'Catalog readers per dialect',
        labels: ['enhancement'],
        blockedBy: ['tests'],
        goal: 'Implement the three catalog readers, producing the same `SchemaSnapshot` the declaration path produces, with catalog rows validated rather than asserted.',
        files: [
          '`packages/query-compiler/src/introspect/index.ts` (new) — the `Introspector` interface and dispatch.',
          '`packages/query-compiler/src/introspect/postgres.ts`, `mysql.ts`, `sqlite.ts` (new)',
        ],
        steps: [
          'Query the catalog through the ordinary compiled-query path with bound parameters. A catalog query built by string concatenation over a caller-supplied schema name is an injection in a tool people will point at production.',
          'Validate every catalog row with the project validator before using it — these are `Record<string, unknown>` from a driver, and `as` is not available (§2.5).',
          'Produce the snapshot in the same normalised form the declaration path produces (sorted the same way), so `diff` works across the two without translation. Test that explicitly rather than assuming.',
          'Read the pieces the newer epics added: composite key order, foreign keys with actions, expression indexes, extension types. Where an epic has not landed, leave a clearly marked gap rather than a partial read.',
          "Handle SQLite's looseness: types are affinities and a column can have no type at all. Map by affinity rules and warn where the mapping is lossy.",
          'Handle Postgres identity versus serial: they are different mechanisms with different catalog signatures and both map to `Serial`; note the asymmetry in a comment because it will look like a bug later.',
        ],
        tests: [
          'All reader tests go green.',
          '`produces a snapshot that diffs cleanly against the declared snapshot for the same schema` — the normalisation property.',
          '`validates catalog rows and reports a malformed one` — feed a driver double returning a wrong-shaped row.',
        ],
        dod: [
          'Three readers implemented, parameterised, with validated rows.',
          'Snapshot normalisation proven by a clean diff against the declaration path.',
          'SQLite affinity and Postgres identity/serial handled with comments explaining the asymmetries.',
        ],
      },
      {
        key: 'emit',
        title: 'Emit TypeScript declarations from a snapshot',
        labels: ['enhancement'],
        blockedBy: ['readers'],
        goal: 'Turn a snapshot into declaration source: interfaces with tags, deterministic ordering, formatted output, and warnings for anything unrepresentable.',
        why: 'This is the artefact users actually want, and it is generated code humans will read and check in. Determinism and formatting are therefore functional requirements, not polish: a generator whose output reorders between runs makes every regeneration a review burden and eventually gets run once and hand-edited.',
        files: [
          '`packages/query-compiler/src/introspect/emit.ts` (new)',
          '`packages/schema-core/src/naming/index.ts` — the inverse naming (physical → property), if the naming epic has landed.',
        ],
        steps: [
          "Emit one interface per table extending `Table<'physical_name'>`, with the property name from the inverse naming strategy and the physical name preserved so the round trip holds.",
          'Emit tags in a fixed order (`Sql`, then `Serial`, then `PrimaryKey`, then `HasDefault`, then validation tags) so two runs agree.',
          'Emit relations as typed properties where a foreign key is unambiguous, and skip them with a warning where it is not — a guessed relation in generated code is worse than an absent one.',
          'Format the output with the repo formatter (`oxfmt`) by invoking it on the generated text rather than by hand-matching its style, so the generator cannot drift from `yarn fmt:check`.',
          'Emit a header marking the file generated, naming the command that produced it, and stating that edits will be overwritten.',
          'Collect warnings structurally (table, column, reason) and also emit a `// TODO:` comment at the site, so the information exists both in the tool output and in the file.',
          'Never emit `unknown` for a type it could not map. Omit the column, warn, and comment — a silently `unknown` column type type-checks and then fails at runtime, which is the worst combination.',
        ],
        tests: [
          'Emission tests go green.',
          '`emits deterministic, formatted declaration source` — two runs byte-identical, and `yarn fmt:check` clean on the output.',
          '`omits and warns rather than emitting unknown`.',
          '`skips an ambiguous relation with a warning`.',
          '`round-trips a declaration through DDL, a real database and back`.',
        ],
        dod: [
          'Output deterministic, formatter-clean and marked generated.',
          'No `unknown` fallbacks; warnings both structural and in-file.',
          'Round trip green against real sqlite.',
        ],
      },
      {
        key: 'drift',
        title: 'Drift detection: compare a live database to the declarations',
        labels: ['enhancement'],
        blockedBy: ['readers'],
        goal: 'Ship a comparison that reports differences in both directions between an introspected snapshot and the declared one, with an exit status suitable for CI.',
        why: 'This is the payoff that only zmdb can offer: because declarations are types and introspection produces the same snapshot format, drift is a diff rather than a research project. It also turns the adoption story from "generate once and hope" into "generate, then keep it honest".',
        files: [
          '`packages/query-compiler/src/introspect/drift.ts` (new)',
          '`packages/query-compiler/src/migrations/index.ts` — reuse `diff`, do not write a second comparator.',
        ],
        api: `
export interface DriftReport {
  readonly onlyInDatabase: readonly ChangeOp[];
  readonly onlyInDeclarations: readonly ChangeOp[];
  readonly clean: boolean;
}
export declare function detectDrift(live: SchemaSnapshot, declared: SchemaSnapshot, opts?: DriftOptions): DriftReport;
`,
        steps: [
          'Implement drift as two `diff` calls in opposite directions, reusing the existing comparator. A second comparator would drift from the first, which would be an unusually literal failure.',
          'Filter bookkeeping tables (the migration ledger) by default, with the list configurable and documented.',
          'Report in a form a human can act on: which table, which column, what differs. A boolean is useless in CI output.',
          "Decide and document what counts as drift versus noise: a default expression that the database normalised (`'now()'` versus `now()`), a type alias, an index the database created to support a foreign key. Each of these will produce a false positive on the first real database, so handle them explicitly.",
        ],
        tests: [
          'Drift tests go green.',
          '`reports drift in both directions`.',
          '`ignores a default expression the database normalised` — the first false positive anyone will hit.',
          '`ignores an index MySQL created to support a foreign key`.',
          '`excludes the migration ledger`.',
        ],
        dod: ['Drift reuses `diff`; report is actionable; known false-positive classes handled explicitly and tested.'],
      },
      {
        key: 'docs',
        title: '[Docs] schema-first — adopting zmdb on an existing database',
        labels: ['documentation'],
        docs: true,
        blockedBy: ['emit', 'drift'],
        goal: 'Flip `schema-first` to supported and write it as an adoption guide: introspect, review the generated declarations, keep them honest with a drift check in CI.',
        files: [
          '`docs-site/pages.mjs`, `docs-site/content/schema-first.md`',
          '`docs-site/content/migrate-from-mikro-orm.md` / `migrate-from-drizzle.md` — introspection is the first step of either.',
        ],
        steps: [
          'Write the guide in the order a real adoption happens: point it at a database, read the warnings, hand-fix what could not be represented, wire the drift check.',
          'Be explicit about the limits: generated files are overwritten, hand edits belong elsewhere, and views/triggers/routines are not introspected.',
          'Document the false-positive classes in drift detection, so the first CI failure is understood rather than worked around.',
          'Cross-link the migration-from-X pages, which currently have no answer for an existing database.',
          'Note that the `pull` command lives in the CLI docs, and link it rather than duplicating it.',
          'Refresh README counts.',
        ],
        tests: ['`node docs-site/build.mjs`, `yarn verify:docs-coverage`, `yarn verify:api-coverage` green.'],
        dod: [
          'Page supported and written as an adoption path; limits and drift false positives documented; migration pages cross-linked.',
        ],
      },
    ],
  },

  {
    key: 'routines',
    title: '[EPIC] Stored procedures and functions — DDL and a typed call site',
    labels: ['enhancement', 'area:schema'],
    pages: ['stored-routines'],
    packages: ['@zmdb/query-compiler', '@zmdb/repository'],
    motivation: `
There is no procedure or function DDL emitter and no typed way to call one. For a team whose business
logic already lives in the database — which is most teams with a database older than their current
framework — that is a hard stop: the routines cannot be managed by zmdb's migrations, and calling one
means dropping out of the typed path entirely.

The two halves have different characters. Managing routine *bodies* in migrations is genuinely awkward:
a body is opaque text in a dialect-specific language, so a diff can only compare strings, and
\`CREATE OR REPLACE\` semantics differ per dialect. Calling a routine with types, on the other hand, is
squarely in this project's wheelhouse — a signature is a type, arguments are validated at the boundary,
and the result set is a declared shape. The second half is where the value is, and it does not depend
on the first.
`,
    dod: [
      'A routine is a declared schema object with a name, parameters, a return shape and a body; `CREATE FUNCTION` / `CREATE PROCEDURE` is emitted per dialect.',
      "A body change is detected by the diff and re-emitted with the dialect's replace semantics; SQLite, which has neither, refuses with a named message.",
      '`callFunction`/`callProcedure` compile to `SELECT fn($1)` / `CALL p($1)` with arguments bound and validated against the declared parameter types.',
      'The result of a function call is typed from the declaration, and a set-returning function is typed as rows.',
      "MySQL's `DELIMITER` problem and Postgres's dollar-quoting are handled by the emitter, not by the caller.",
      '`stored-routines` flips to supported, documenting the per-dialect differences and being honest that a body is opaque text.',
    ],
    invariants: [
      '§2.4 explicit SQL: arguments are bound, never interpolated. A routine call assembled from strings is an injection in a place that often runs with elevated privileges.',
      '§2.3 validation at the boundary: arguments are validated against declared parameter types before the call; the result set is validated like any other read.',
      '§2.5 no `as`: the result type comes from the declaration, not from a cast at the call site.',
      '§2.6 no over-abstraction: zmdb does not attempt to understand or generate routine bodies. A body is text the user owns, and the docs say so.',
    ],
    nonGoals: [
      'Translating TypeScript into a routine body.',
      'Parsing a routine body to derive its signature — the signature is declared.',
      'Introspecting existing routine bodies (the introspection epic explicitly excludes them).',
      'Triggers, which have their own semantics and would be a separate epic.',
    ],
    subs: [
      {
        key: 'spec',
        title: '[Spec Freeze] routine declaration, DDL per dialect, and the call surface',
        labels: ['spec'],
        goal: 'Freeze the routine object, its per-dialect DDL including quoting and replace semantics, the diff behaviour for an opaque body, and the typed call surface. No code.',
        why: 'The dialects differ more here than anywhere else in the roadmap: Postgres has `CREATE OR REPLACE FUNCTION` with dollar-quoted bodies and a language clause; MySQL has no `OR REPLACE`, requires `DROP` first, and its client protocol needs `DELIMITER` handling for a body containing semicolons; SQLite has no stored routines at all. One emitter cannot be written from a description that glosses these.',
        files: [
          '`packages/query-compiler/src/schema-objects/SPEC.md` — routines.',
          '`packages/repository/SPEC.md` — the call surface.',
        ],
        api: `
export interface RoutineDef {
  readonly kind: 'function' | 'procedure';
  readonly name: string;
  readonly params: readonly { readonly name: string; readonly type: SqlType; readonly mode?: 'in' | 'out' | 'inout' }[];
  /** Functions only. \`setof\` marks a table-valued function. */
  readonly returns?: { readonly type: SqlType | 'void'; readonly setof?: boolean };
  readonly language?: string;   // 'plpgsql' | 'sql' | …
  readonly body: string;        // opaque; the user owns it
}

export declare function callFunction<Args extends readonly unknown[], R>(name: string, args: Args): CompiledQuery;
export declare function callProcedure<Args extends readonly unknown[]>(name: string, args: Args): CompiledQuery;
`,
        steps: [
          "Write the emitted DDL per dialect verbatim, including Postgres dollar-quoting (and how a body containing `$$` is handled — a tagged delimiter like `$zmdb$`), the language clause, and MySQL's parameter syntax.",
          'Specify replace semantics: Postgres `CREATE OR REPLACE`; MySQL `DROP ... IF EXISTS` then `CREATE`, and note that this is not atomic, which matters during a deploy — say what the runner does about it.',
          'Specify the MySQL `DELIMITER` question precisely. `DELIMITER` is a client-side directive, not SQL, so a driver executing one statement at a time does not need it — but a body with internal semicolons may still break a naive multi-statement path. Decide whether the emitted DDL is one statement (correct for a driver) or a script (needs delimiters), and note which consumers get which.',
          'Specify SQLite: refuse, with a message naming the dialect and the routine. Do not emulate.',
          'Specify diff for an opaque body: compare normalised text (trailing whitespace only — anything more is parsing) and re-emit on any difference. State that a formatting-only change therefore causes a re-emit, and that this is deliberate because the alternative is a SQL parser.',
          'Specify parameter binding and `out`/`inout` handling. `out` parameters are dialect-specific and awkward; decide whether they are supported now or refused, and if refused, say so in the non-goals.',
          'Specify the typed call: how the declaration provides the argument tuple type and the result type, and what a set-returning function returns.',
          'Specify the security note: a routine often runs with definer rights, so calling one with unvalidated arguments is a privilege-escalation surface. Argument validation is therefore mandatory, not optional, and the spec should say that in those terms.',
        ],
        tests: ['None — spec only.', '`yarn validate:spec` green.'],
        dod: [
          'Per-dialect DDL verbatim including quoting and replace semantics; the `DELIMITER` question resolved with reasoning.',
          'Opaque-body diff policy stated with its consequence accepted.',
          '`out` parameter decision made; SQLite refusal specified.',
          'Typed call surface and the mandatory-validation security rationale frozen.',
        ],
      },
      {
        key: 'tests',
        title: '[Tests Freeze] routines — DDL, quoting, diffs, calls, refusals',
        labels: ['spec'],
        blockedBy: ['spec'],
        goal: 'Land failing tests for routine DDL in both supported dialects, the quoting edge cases, the body diff, the typed call SQL, argument validation and the SQLite refusal.',
        files: [
          '`packages/query-compiler/src/schema-objects/schema-objects.spec.ts`',
          '`packages/query-compiler/src/migrations/migrations.spec.ts` — body diff.',
          '`packages/repository/src/repository.spec.ts` — the call surface.',
        ],
        tests: [
          '`emits CREATE OR REPLACE FUNCTION with a dollar-quoted body` — full statement.',
          '`chooses a safe dollar-quote tag when the body contains $$`.',
          '`emits a MySQL function as a drop-then-create pair`.',
          '`emits a procedure with in, out and inout parameters` — or asserts the refusal, per the spec.',
          '`refuses a routine on sqlite, naming the routine`.',
          '`re-emits a routine when its body changes` and `does not re-emit when only trailing whitespace differs`.',
          '`compiles a function call to SELECT with bound arguments` — full SQL and params.',
          '`compiles a procedure call to CALL with bound arguments`.',
          '`types a set-returning function as rows`.',
          '`validates arguments against the declared parameter types before calling` — including the case that would otherwise reach a definer-rights routine unvalidated.',
          '`calls a real function` — sqlite is out (no routines), so this is a real-Postgres test, gated and loud when skipped.',
          'Type-level: a call with a wrong argument arity or type is a compile error.',
        ],
        steps: [
          'Write the `$$`-in-body test deliberately: it is the quoting bug that produces a syntax error at deploy time on a body that looked fine in review.',
          'Gate the real-Postgres test the same way the introspection epic does, and make the skip visible.',
        ],
        dod: [
          'Every DDL, quoting, diff, call, validation and refusal claim has a named failing test; the real-Postgres test is gated and announces a skip.',
        ],
      },
      {
        key: 'ddl',
        title: 'Routine DDL and body diffing',
        labels: ['enhancement'],
        blockedBy: ['tests'],
        goal: 'Emit routine DDL for Postgres and MySQL with correct quoting and replace semantics, snapshot routine definitions, diff bodies, and refuse on SQLite.',
        files: [
          '`packages/query-compiler/src/schema-objects/index.ts` — `RoutineDef`, `createRoutineDdl`, `dropRoutineDdl`.',
          '`packages/query-compiler/src/migrations/index.ts` — routine carriage in the snapshot, diff and emit ordering.',
        ],
        steps: [
          'Choose the dollar-quote tag by scanning the body for candidate tags and picking one that does not occur. Do not assume `$$` is safe; the scan is five lines and prevents a class of deploy failure.',
          'Order routine emission after tables (a routine body may reference them) and before anything that calls one. Add it to the same explicit phase list the extensions slice introduced.',
          'Normalise the body only as far as the spec allows before comparing — trailing whitespace, nothing else — and comment that the restraint is deliberate.',
          "Implement MySQL's drop-then-create and surface the non-atomicity in the runner's output for that op, so a deploy that fails between the two is diagnosable.",
          'Refuse on SQLite through the same reporting path the other refusals use, so a runner surfaces it rather than skipping.',
        ],
        tests: [
          'All DDL and diff tests go green.',
          '`chooses a safe dollar-quote tag when the body contains $$`.',
          '`orders routine creation after the tables it references`.',
        ],
        dod: [
          'Both supported dialects emit correct routine DDL with safe quoting; SQLite refuses.',
          'Body diff is text-only with the restraint documented; MySQL non-atomicity surfaced.',
        ],
      },
      {
        key: 'call',
        title: 'Typed routine calls with validated arguments',
        labels: ['enhancement'],
        blockedBy: ['tests'],
        goal: 'Compile `callFunction`/`callProcedure` with bound, validated arguments and a result type taken from the declaration, including set-returning functions.',
        why: 'This is the half that delivers value without depending on managing bodies in migrations: a team whose routines already exist gets a typed, validated call path immediately.',
        files: [
          '`packages/query-compiler/src/index.ts` — the call compilers.',
          '`packages/repository/src/index.ts` — the repository-level surface and result validation.',
        ],
        steps: [
          'Compile to `SELECT "fn"($1, $2)` and `CALL "p"($1, $2)`, quoting the routine name and binding every argument. Never interpolate an argument, and never accept a routine name that is not a declared routine — a caller-supplied name is a call to anything the connection can reach.',
          'Validate arguments against declared parameter types before compiling, and cite the definer-rights rationale in a comment so the check is not later removed as redundant.',
          'Type the result from the declaration: a scalar function returns a scalar, a `setof` function returns rows, a procedure returns nothing (or `out` parameters, if supported).',
          'Validate the result set like any other read result, through the existing validator.',
          'Handle the transaction case: a procedure that commits internally interacts badly with an outer transaction. Document it, and refuse or warn per the spec.',
        ],
        tests: [
          'All call tests go green.',
          '`refuses a routine name that is not declared`.',
          '`validates arguments against the declared parameter types before calling`.',
          '`calls a real function` — gated real Postgres.',
          'Type-level: wrong arity and wrong argument type are compile errors.',
        ],
        dod: [
          'Calls compiled with bound arguments and validated inputs and outputs; result types derived, not cast.',
          'Undeclared routine names refused; transaction interaction documented.',
        ],
      },
      {
        key: 'docs',
        title: '[Docs] stored procedures and functions',
        labels: ['documentation'],
        docs: true,
        blockedBy: ['ddl', 'call'],
        goal: 'Flip `stored-routines` to supported, documenting the typed call path first, body management second, and the per-dialect truth throughout.',
        files: ['`docs-site/pages.mjs`, `docs-site/content/stored-routines.md`'],
        steps: [
          'Lead with calling an existing routine, because that is the common case and the one that works everywhere the dialect supports routines at all.',
          'Document body management honestly: the body is opaque text, a formatting change causes a re-emit, MySQL replace is not atomic, SQLite is unsupported.',
          'Document the security rationale for argument validation — definer rights make this more than hygiene.',
          'State the non-goals (no body generation, no signature inference, no triggers, no routine introspection) and link the introspection page which excludes them.',
          'Refresh README counts.',
        ],
        tests: ['`node docs-site/build.mjs`, `yarn verify:docs-coverage` green.'],
        dod: [
          'Page supported; call path documented first; per-dialect caveats and the security rationale stated; non-goals listed.',
        ],
      },
    ],
  },
];
