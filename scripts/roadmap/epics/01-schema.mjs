// Schema-side capability gaps: keys and indexes, physical naming, extensions, introspection,
// stored routines. Every one of these is a claim about what a *declaration* can say, which is why
// they belong to `@zmdb/schema-core` first and to the DDL emitter second.

export const SCHEMA_EPICS = [
  {
    key: 'keys',
    title: '[EPIC] Composite primary keys and expression indexes',
    labels: ['enhancement', 'area:schema', 'parity:mikro-orm'],
    pages: ['composite-keys', 'guide-case-insensitive-unique'],
    packages: ['@zmdb/schema-core', '@zmdb/query-compiler', '@zmdb/repository'],
    motivation: `
A join table has two primary-key columns and a case-insensitive unique email needs an index on
\`lower(email)\`. zmdb can express neither, and the composite half is worse than missing — it is
wrong in a way that compiles.

\`PrimaryKeyOf<T>\` already resolves a two-column key to \`{ orgId, userId }\`, and
\`packages/repository/src/tagged-schema.type-test.ts:85-94\` asserts that \`findById\` accepts it.
At runtime \`BaseRepository.pkColumn\` (packages/repository/src/index.ts:165) reads
\`schema.primaryKey[0]\` and throws the rest away, so that call compiles into
\`WHERE "org_id" = $1\` with an *object* as the parameter. The DDL side is no better: the emitter
writes \`PRIMARY KEY\` inline per column, so a two-column key produces

    CREATE TABLE "memberships" ("org_id" INTEGER PRIMARY KEY, "role" TEXT NOT NULL, "user_id" INTEGER PRIMARY KEY)

which Postgres rejects outright ("multiple primary keys for table are not allowed") and which MySQL
and SQLite mis-accept as something the declaration did not say. \`primaryKeyOf\` in
\`packages/schema-core/src/relations/index.ts:97\` takes \`[0]\` as well, so a relation pointing at a
composite parent silently joins on half a key.

The index half is a smaller, self-contained gap: \`IndexDef\` (packages/query-compiler/src/schema-objects/index.ts:13)
takes \`columns: readonly string[]\` and quotes each one as an identifier, so no functional index can
be emitted at all. Both halves are the same shape of problem — the key and index vocabulary assumes
one bare column name where SQL allows a list and an expression.
`,
    dod: [
      'A declaration with two `PrimaryKey` columns emits one table-level `PRIMARY KEY (a, b)` in all three dialects, and the snapshot/diff round-trips it.',
      '`findById`, `update` and `delete` build an all-columns `WHERE` for a composite key, and reject a partial key with a message naming the missing column instead of querying on half of it.',
      'A relation whose parent has a composite key either joins on every column or is refused at derivation time with a diagnostic naming the key it cannot use — never silently joins on one column.',
      '`IndexDef` accepts an expression, `createIndexDdl` emits `CREATE UNIQUE INDEX ... ON "users" (lower("email"))`, and the expression survives snapshot → diff → DDL unchanged.',
      'Both docs pages flip to `supported`, and the composite-key page documents the partial-key error as part of the contract.',
    ],
    invariants: [
      '§2.9 one front-end: the key list is read out of the `TypeIR` the reflection already produces. No second place learns what a primary key is, and `yarn verify:one-walker` still passes.',
      '§2.5 no `as`: a composite key is an object type derived from the declaration, so nothing needs to assert its shape. A partial key is a *runtime* input and gets a runtime error, not a cast.',
      '§2.4 explicit SQL: the emitted `WHERE` names every key column and parameterises every value; no dialect gets a hand-rolled string.',
      '§1 cost model: key resolution happens once when the schema is built, not per call. `pkColumn` is a getter today — its replacement must not recompute a list per query.',
    ],
    subs: [
      {
        key: 'spec',
        title: '[Spec Freeze] composite keys and expression indexes across IR, DDL, repository and relations',
        labels: ['spec'],
        goal: `
Freeze the semantics of a multi-column key and an expression index at all four boundaries that read
them, before any code changes. No runtime code lands in this sub-issue.

The output is spec text that answers, unambiguously: what a composite key looks like in the IR, what
DDL it produces per dialect, what \`findById\` accepts and rejects, what happens to a relation whose
parent key has two columns, and how an expression index is represented so that a snapshot diff can
tell \`(email)\` from \`(lower(email))\`.
`,
        why: `
The four boundaries currently disagree, and each one is independently defensible — which is exactly
why a spec has to decide rather than a patch. \`PrimaryKeyOf\` says a composite key is an object;
the repository says it is one column; the DDL emitter says it is a per-column flag; relations say it
is \`primaryKey[0]\`. Any implementation that starts before those are reconciled will make three of
them agree with the fourth by accident.
`,
        files: [
          '`packages/schema-core/src/ir/SPEC.md` — a "Keys" section: `SchemaIR.primaryKey` is the ordered key list and the per-column `primaryKey` flag is derived from it, never the reverse.',
          '`packages/query-compiler/src/migrations/SPEC.md` — table-level `PRIMARY KEY (...)` emission, and what `diff` produces when a key changes.',
          '`packages/query-compiler/src/schema-objects/SPEC.md` — the `IndexDef` expression form and its quoting rules.',
          '`packages/repository/SPEC.md` — `findById`/`update`/`delete` with a composite key, including the partial-key error text.',
          '`packages/schema-core/src/relations/SPEC.md` — relations against a composite parent key.',
        ],
        api: `
// The frozen vocabulary. Written here as the spec's normative form; no implementation yet.

// schema-core/src/ir: the key is a list, ordered by declaration order. Order is part of the
// contract because it decides both the DDL column order and the index SQL picks.
interface SchemaIR {
  readonly primaryKey: readonly string[]; // already this shape — the spec pins the ordering rule
}

// query-compiler/src/migrations: the snapshot has to carry the key, because a diff that only sees
// per-column flags cannot tell "key changed from (a) to (a,b)" from "column b became a key too".
interface TableSnapshot {
  readonly name: string;
  readonly columns: readonly ColumnSnapshot[];
  readonly primaryKey: readonly string[]; // NEW
}

// query-compiler/src/schema-objects: an index column is a name or an expression. An expression is
// emitted verbatim inside the parens and is NOT quoted as an identifier.
type IndexColumn = string | { readonly expr: string };

interface IndexDef {
  readonly name: string;
  readonly table: string;
  readonly columns: readonly IndexColumn[];
  readonly unique?: boolean;
  readonly where?: string;
}

// repository: what a caller may pass. A composite key is an object with every key column present.
// A missing column is an error, not a partial filter.
declare function findById<T extends DeclaredTable>(id: PrimaryKeyOf<T>): Promise<Entity<T> | undefined>;
`,
        steps: [
          'Write the "Keys" section of `packages/schema-core/src/ir/SPEC.md`: `primaryKey` is ordered, non-empty for a keyed table, and the single source; state explicitly that the per-column `primaryKey: boolean` in `ColumnIR` is a projection of it and that nothing may read the flag to reconstruct the list.',
          'Decide and record the DDL form per dialect: one-column keys keep the inline `PRIMARY KEY` they emit today (so no existing golden SQL changes), and two-or-more columns emit a trailing `PRIMARY KEY ("a", "b")` in declaration order. Write both golden statements into the spec verbatim.',
          'Record what `diff` emits when a key changes: Postgres and MySQL get `ALTER TABLE ... DROP CONSTRAINT` / `ADD PRIMARY KEY`, SQLite cannot alter a key at all and must produce a refusal the runner surfaces rather than a silently skipped op. Name the refusal message in the spec.',
          'Specify the partial-key error: which exception type, and the exact message shape (`memberships.findById requires every key column; missing: user_id`). It has to name the missing column, because the failure mode it replaces was a query on half a key.',
          'Specify relation behaviour: a relation whose parent key has more than one column joins on all of them when `via` supplies the same number of columns, and is refused at derivation with a diagnostic when it does not. Write the diagnostic text.',
          'Specify the expression-index form: `{ expr }` is emitted verbatim between the parens, is never passed through `quoteIdentifier`, and is compared as an opaque string by `diff` — so `lower(email)` and `LOWER(email)` are two different indexes and the spec says so.',
          'Add the checklist items for the slices that follow, so `yarn validate:spec` tracks them; leave them unchecked (the gate only requires that a *changed* package has no unresolved items when it lands, so open the checklist in the same PR that closes it or keep the items in the sub-issue rather than the SPEC until then).',
        ],
        tests: [
          'None. This sub-issue lands documentation only; `npx vitest run` must show the same test count before and after.',
          '`yarn validate:spec` must pass, which is the real gate here: it parses every `SPEC.md` and fails on a malformed or unresolved checklist.',
        ],
        dod: [
          'All five SPEC.md sections written and reviewed.',
          'Golden DDL for one-column and multi-column keys written into the spec verbatim, per dialect.',
          'Partial-key error message and relation refusal diagnostic fixed in text.',
          'No runtime code, no test changes, no docs-site changes.',
          '`yarn validate:spec` green.',
        ],
      },
      {
        key: 'tests',
        title: '[Tests Freeze] failing tests for composite keys and expression indexes',
        labels: ['spec'],
        blockedBy: ['spec'],
        goal: `
Land the tests the frozen spec implies, red, before any implementation. Every test must fail for the
reason the spec names — not because a symbol is missing. Where a new field is required to make a
test compile (\`TableSnapshot.primaryKey\`, \`IndexColumn\`), add the *type* in this sub-issue and
leave the behaviour unimplemented so the failure is an assertion failure rather than a
\`TypeError\`.
`,
        why: `
The repo's rule is spec → failing tests → implementation (ARCHITECTURE §6, PRD REQ-NF-10), and this
epic is the case that shows why: two of the four boundaries currently pass their own tests while
being wrong, because each was tested against its own single-column assumption. Writing the red tests
first is what makes the existing green tests' blind spot visible.
`,
        files: [
          '`packages/query-compiler/src/migrations/migrations.spec.ts` — composite `CREATE TABLE`, key change diff, SQLite refusal.',
          '`packages/query-compiler/src/schema-objects/schema-objects.spec.ts` — expression index DDL and quoting.',
          '`packages/repository/src/repository.spec.ts` — composite `findById`/`update`/`delete` and the partial-key error.',
          '`packages/schema-core/src/relations/populate.spec.ts` — multi-column join and the refusal diagnostic.',
          '`packages/schema-core/src/ir/ir.type-test.ts` — `PrimaryKeyOf` for one, two and zero key columns.',
        ],
        api: `
// Add only the types the tests need to compile. No behaviour.
export type IndexColumn = string | { readonly expr: string };

export interface TableSnapshot {
  readonly name: string;
  readonly columns: readonly ColumnSnapshot[];
  readonly primaryKey: readonly string[];
}
`,
        tests: [
          '`emits one table-level PRIMARY KEY for a two-column key` — the whole `CREATE TABLE` string per dialect, not a fragment: the defect is a *second* `PRIMARY KEY` appearing, and a substring match would pass either way.',
          '`keeps the inline PRIMARY KEY for a single-column key` — pins the no-regression half, in all three dialects.',
          '`diffs a key that gained a column into a drop and an add` — Postgres and MySQL.',
          '`refuses to alter a primary key on sqlite, naming the table` — the op is reported, not skipped.',
          '`emits a functional unique index without quoting the expression` — `CREATE UNIQUE INDEX "users_email_lower" ON "users" (lower("email"))`.',
          '`treats two spellings of the same expression as two indexes` — `lower(email)` vs `LOWER(email)` diff to two ops, because the compiler is not a SQL parser and must not pretend to normalise.',
          '`finds a row by every column of a composite key` — asserts the compiled SQL and the parameter list, so a key that degrades to one column fails here.',
          '`rejects a partial composite key, naming the column that is missing` — `expect(...).rejects.toThrow(/missing: user_id/)`.',
          "`updates and deletes by a composite key` — both statements' `WHERE` names both columns.",
          '`joins a relation on every column of a composite parent key` — the compiled `ON` clause.',
          '`refuses a relation whose via list is shorter than the parent key` — the diagnostic text from the spec.',
          'Type-level in `ir.type-test.ts`: `Expect<Equal<PrimaryKeyOf<Membership>, { orgId: number; userId: number }>>` and `Expect<Equal<PrimaryKeyOf<User>, number>>`.',
        ],
        steps: [
          'Write every test above so it fails on the assertion, and record the actual current output next to each expectation in a comment — for the DDL case that is the double-`PRIMARY KEY` string, which is the artefact the epic exists to remove.',
          'Add `IndexColumn` and `TableSnapshot.primaryKey` as types only; keep `snapshot()` producing what it produces today so the failures stay behavioural.',
          'Mark the suite so CI is honest about it: either land the whole tests-freeze inside the first implementation slice, or use `it.fails` for the ones that cannot be green yet and convert them in the slice that fixes each. Do not use `.skip` — a skipped test is invisible in the summary line.',
          'Update `tests/api-coverage/mapping.mjs` only if a test title it already cites changes. Do not re-point upstream MikroORM composite-key suites at these tests yet; that happens in the docs slice, when the behaviour is real.',
        ],
        dod: [
          'Every spec claim has at least one named test.',
          'Each new test fails on an assertion, with the current wrong output recorded in a comment.',
          '`node scripts/typecheck.mjs` green — the type-level tests compile, including the `@ts-expect-error` cases.',
          'No production behaviour changed.',
        ],
      },
      {
        key: 'ddl',
        title: 'Composite primary keys through snapshot, diff and DDL',
        labels: ['enhancement'],
        blockedBy: ['tests'],
        goal: `
Make a multi-column key emit valid SQL in all three dialects and survive a migration round trip. At
the end of this slice a two-column declaration produces one \`PRIMARY KEY ("org_id", "user_id")\`,
\`diff\` reports a key change as a real op, and SQLite refuses an impossible alter instead of
dropping it on the floor.
`,
        why: `
This is the slice with a live correctness bug behind it, so it goes first: today the emitted DDL is
rejected by Postgres, which means composite keys are not merely undocumented but unusable. It is
also the only slice that changes \`SchemaSnapshot\`, so doing it first keeps the snapshot format from
changing twice.
`,
        files: [
          '`packages/query-compiler/src/migrations/index.ts` — `SnapshotableSchema`, `snapshot()`, `TableSnapshot`, `diff()`, `emitUp()`, `emitDown()`, `columnDdl`.',
          '`packages/query-compiler/src/migrations/runner.ts` — surface a refused op rather than skipping it.',
          '`packages/schema-core/src/ir/index.ts` — `schemaFromIr` must pass the ordered key list into the snapshotable shape.',
        ],
        api: `
export interface TableSnapshot {
  readonly name: string;
  readonly columns: readonly ColumnSnapshot[];
  /** Ordered. Empty for a keyless table. A one-element list still emits inline, for byte-compat. */
  readonly primaryKey: readonly string[];
}

export type ChangeOp =
  // … existing ops …
  | { readonly kind: 'set_primary_key'; readonly table: string; readonly columns: readonly string[] }
  | { readonly kind: 'drop_primary_key'; readonly table: string };
`,
        steps: [
          'Extend `SnapshotableSchema` so the producer hands over the ordered key list, and make `snapshot()` record it on `TableSnapshot`. Keep column sorting as it is — the snapshot is sorted for stability, and the key list is what carries order now.',
          'Bump the snapshot `version` only if the new field cannot be read as optional by the existing runner. Prefer making it required in the type and defaulting it from the per-column flags when reading an old snapshot, so no stored snapshot is invalidated; write down which choice you made and why in the migrations SPEC.',
          'In `emitUp` for `create_table`: emit inline `PRIMARY KEY` when the key has exactly one column (unchanged golden SQL), and a trailing `PRIMARY KEY (...)` when it has more. Suppress the per-column `PRIMARY KEY` in the multi-column case — that is the double-clause bug.',
          'Keep `NOT NULL` correct: a key column is implicitly `NOT NULL`, and the current code suppresses `NOT NULL` next to inline `PRIMARY KEY`. In the table-level form the columns still need their `NOT NULL`, so the suppression must move with the clause.',
          'Handle SERIAL/AUTO_INCREMENT interaction: MySQL requires an `AUTO_INCREMENT` column to be a key, and only one may exist. A composite key containing a `Serial` column is legal in MySQL only if that column comes first; either emit it that way or refuse with a message. Pick one in the spec and implement it.',
          'Teach `diff` to compare key lists and emit `drop_primary_key` / `set_primary_key`. Emit them in an order the database accepts: drop before add, and after any column additions the new key needs.',
          'Implement `emitUp`/`emitDown` for the two new ops per dialect, and make SQLite return a refusal the runner reports — SQLite cannot alter a key without a table rebuild, and pretending otherwise is worse than failing.',
          'Run `yarn verify:one-walker`: this slice touches column metadata, and the exemption list names the files allowed to. If a new file needs to read it, that is a spec conversation, not a list edit.',
        ],
        tests: [
          'Convert every `migrations.spec.ts` test from the tests-freeze slice to green.',
          '`emits one table-level PRIMARY KEY for a two-column key` — full statement, three dialects.',
          '`keeps the inline PRIMARY KEY for a single-column key` — no existing golden SQL changed.',
          '`keeps NOT NULL on every column of a table-level key`.',
          '`round-trips a composite key through snapshot, diff and emit with no ops on the second pass` — the idempotence property that catches a key the snapshot forgot.',
          '`reads a pre-existing snapshot that has no primaryKey field` — the compatibility path, whichever choice the spec made.',
        ],
        dod: [
          'All three dialects emit valid, executable `CREATE TABLE` for a composite key (verify the Postgres one against a real server if one is to hand; the sqlite one via `node:sqlite` in the E2E suite).',
          '`diff` produces key ops and the runner applies or refuses them explicitly.',
          'No existing golden SQL in the suite changed.',
          '`npx vitest run` green; `yarn verify:one-walker` green.',
        ],
      },
      {
        key: 'repo',
        title: 'Composite keys in the repository: findById, update, delete and the partial-key error',
        labels: ['enhancement'],
        blockedBy: ['tests'],
        goal: `
Replace the single-column key assumption in \`BaseRepository\` with the whole key, so that the
composite \`findById\` the type-tests already bless does what it claims. A partial key becomes a
named error instead of a query with an object as a parameter.
`,
        why: `
\`pkColumn\` (packages/repository/src/index.ts:165) is read by \`findById\`, \`update\`, \`delete\`
and the populate path. Changing it in one place fixes all of them, and leaving it changes the others
into the same bug in four spellings. The error case matters as much as the happy one: the current
failure is silent, and silence is what let a blessed type-test coexist with a broken runtime.
`,
        files: [
          '`packages/repository/src/index.ts` — `pkColumn` → `primaryKeyColumns`, `findById`, `update`, `delete`, `upsert` conflict target defaults, the populate parent-key read.',
          '`packages/repository/src/typed-methods/typed-writes.type-test.ts` — extend with a composite-key repository.',
          '`packages/repository/SPEC.md` — the section frozen in the spec slice.',
        ],
        api: `
class BaseRepository<T extends DeclaredTable> {
  /** Ordered key columns, resolved once at construction. Throws if the schema has no key. */
  private readonly keyColumns: readonly string[];

  /** One column → the bare value; two or more → every column, all required. */
  findById(id: PrimaryKeyOf<T>): Promise<Entity<T> | undefined>;
}

/** Thrown when a composite key is given with a column missing. */
export class IncompleteKeyError extends Error {
  readonly table: string;
  readonly missing: readonly string[];
}
`,
        steps: [
          'Resolve the key list once in the constructor, not per call — a getter that rebuilds a list on every `findById` is a per-request allocation for a value that cannot change (§1 cost model).',
          'Write one private `keyWhere(id)` that returns the where object, and route `findById`, `update`, `delete` and the `upsert` default conflict target through it. Four call sites reading the key list directly is how this bug got four spellings.',
          'For a single-column key, accept the bare value exactly as today, and *also* accept the one-property object form if the spec said so — decide in the spec, do not leave it to the reader of the code.',
          'For a composite key, require every column: check with `Object.hasOwn` so an inherited property cannot satisfy a key column (this is the same hazard as issue #364, where `Object.prototype` keys reached an operator allowlist).',
          'Throw `IncompleteKeyError` naming the table and every missing column. Export it from `@zmdb/repository` and re-export from `zmdb`, then add it to the umbrella `exports` list so `yarn verify:exports` sees it.',
          'Audit the populate path: `packages/schema-core/src/relations/index.ts:97` is the relation side (next slice), but the repository also reads a parent key when attaching rows. Make it use the same resolved list.',
          'Check the `update` DTO derivation: `packages/schema-core/src/ir/index.ts:652` filters key columns out of the update variant. With a composite key that filter must drop every key column, not just the first.',
        ],
        tests: [
          'Convert the `repository.spec.ts` composite tests to green.',
          '`finds a row by every column of a composite key` — compiled SQL plus parameters.',
          '`rejects a partial composite key, naming the column that is missing`.',
          '`ignores an inherited property when checking a composite key` — pass an object created with a prototype carrying `userId`, assert the error still names it missing.',
          '`updates and deletes by a composite key`.',
          '`keeps the bare-value form working for a single-column key` — the regression guard for every existing caller.',
          '`drops every key column from UpdateDTO` — type-level, in `typed-writes.type-test.ts`.',
        ],
        dod: [
          '`keyColumns` resolved once; no per-call list construction.',
          'One `keyWhere` helper, four call sites, no direct `primaryKey[0]` reads left in the package (`grep -rn "primaryKey\\[0\\]" packages/repository/src` returns nothing).',
          '`IncompleteKeyError` exported and reachable from `zmdb`; `yarn verify:exports` green.',
          '`npx vitest run` and `node scripts/typecheck.mjs` green.',
        ],
      },
      {
        key: 'relations',
        title: 'Relations and populate across a composite parent key',
        labels: ['enhancement'],
        blockedBy: ['tests', 'repo'],
        goal: `
Make a relation whose parent key has more than one column either join on all of them or refuse with
a diagnostic that names the key. Delete the \`primaryKey[0]\` read in
\`packages/schema-core/src/relations/index.ts:97\`, which currently joins on half a key without
saying so.
`,
        why: `
A half-key join returns rows — the wrong rows — which is the worst available failure mode. It cannot
be caught by a type test, because the types are satisfied, and it cannot be caught by a golden SQL
test that was written against a single-column fixture. So the fix is paired with a refusal: where
multi-column joining is not supported, the derivation says so out loud.
`,
        files: [
          '`packages/schema-core/src/relations/index.ts` — `primaryKeyOf`, `resolveRelation`, `compilePopulate`.',
          '`packages/schema-core/src/relations/SPEC.md`',
          '`packages/query-compiler/src/joins/index.ts` — multi-column `ON` support if the join builder cannot express it yet.',
        ],
        api: `
interface ResolvedRelation {
  readonly name: string;
  readonly targetTable: string;
  /** Ordered, parallel to \`targetKey\`. A one-element list is the common case. */
  readonly parentKey: readonly string[];
  readonly targetKey: readonly string[];
  readonly toMany: boolean;
}
`,
        steps: [
          'Change `parentKey`/`targetKey` to ordered lists and update every consumer. Keep the field names — the churn is in the arity, and renaming would hide which call sites were audited.',
          'Where `via` names fewer columns than the parent key, refuse at derivation time with the spec diagnostic. Do not pad, do not guess an order.',
          'Teach the join compiler a multi-column `ON`: `ON "m"."org_id" = "o"."id" AND "m"."user_id" = "u"."id"`. If `joinableSelectFrom` cannot express it, extend it in this slice and add golden SQL for a two-column join.',
          'Audit `compilePopulate`: batching a to-many populate by parent key means an `IN` over tuples for a composite key. Postgres accepts `(a, b) IN ((1,2),(3,4))`; MySQL accepts it; SQLite does not. Emit per-dialect, or refuse for SQLite with the same explicitness as the DDL slice.',
          'Re-check `RELATION_KINDS`: `manyToMany` already throws, and the new refusal must not accidentally change that message — `packages/schema-core/src/relations/populate.spec.ts` asserts it.',
        ],
        tests: [
          '`joins a relation on every column of a composite parent key` — golden `ON` clause.',
          '`refuses a relation whose via list is shorter than the parent key`.',
          '`batches a to-many populate over a composite key with a tuple IN` — Postgres and MySQL golden SQL.',
          '`refuses a composite-key populate on sqlite, naming the dialect`.',
          '`still throws the many-to-many message` — the existing assertion, unchanged.',
        ],
        dod: [
          'No `primaryKey[0]` read left in `@zmdb/schema-core` (`grep` clean).',
          'Multi-column `ON` emitted and golden-tested; per-dialect populate behaviour implemented or explicitly refused.',
          '`npx vitest run` green.',
        ],
      },
      {
        key: 'index-expr',
        title: 'Expression indexes: IndexDef takes an expression, not only a column name',
        labels: ['enhancement'],
        blockedBy: ['tests'],
        goal: `
Let an index be declared over an expression so \`CREATE UNIQUE INDEX "users_email_lower" ON "users"
(lower("email"))\` can be emitted, and make the expression survive snapshot → diff → DDL as an
opaque string.
`,
        why: `
This is what the case-insensitive-unique guide needs, and it is deliberately narrow: the compiler
does not parse SQL and must not start. An expression is a string the caller owns, emitted verbatim
inside the parens, compared by exact equality in a diff. Anything cleverer — normalising case,
re-quoting identifiers inside the expression — would be a SQL parser in the migration path, and the
first thing it would do is disagree with the database about something.
`,
        files: [
          '`packages/query-compiler/src/schema-objects/index.ts` — `IndexDef`, `createIndexDdl`.',
          '`packages/query-compiler/src/migrations/index.ts` — index ops in the snapshot/diff, if indexes are snapshotted.',
          '`packages/query-compiler/src/schema-objects/SPEC.md`',
        ],
        api: `
export type IndexColumn = string | { readonly expr: string };

export interface IndexDef {
  readonly name: string;
  readonly table: string;
  readonly columns: readonly IndexColumn[];
  readonly unique?: boolean;
  readonly where?: string;
}
`,
        steps: [
          'Widen `columns` to `readonly IndexColumn[]` and map each entry: a string goes through `quoteId` as today, an `{ expr }` is emitted verbatim.',
          'Document, in the SPEC and in a comment at the emit site, that the caller is responsible for quoting identifiers *inside* an expression — and that this is a deliberate boundary, not an omission.',
          'Check the escape-hatch gate: emitting a caller-supplied string into DDL is exactly the kind of thing `yarn verify:escape-hatches` counts. It is not an `as`, but if a `// boundary:` comment is warranted anywhere it is here — state the trust assumption (schema DDL is authored, not user input) explicitly.',
          'Make `diff` treat expressions as opaque: two spellings are two indexes. Add the test that pins it, so nobody later adds a normaliser without arguing for it.',
          'Support the composite case: mixed `[{ expr: "lower(\\"email\\")" }, "tenant_id"]` in one index.',
        ],
        tests: [
          '`emits a functional unique index without quoting the expression`.',
          '`mixes an expression and a plain column in one index`.',
          '`treats two spellings of the same expression as two indexes`.',
          '`quotes a plain column name exactly as before` — regression guard for every existing index test.',
        ],
        dod: [
          '`IndexColumn` exported from `@zmdb/query-compiler/schema-objects`.',
          'Golden DDL for expression, mixed and plain indexes in all three dialects.',
          '`yarn verify:escape-hatches` green (and the trust boundary documented if a comment was added).',
        ],
      },
      {
        key: 'docs',
        title: '[Docs] composite keys and case-insensitive unique — pages, coverage, upstream mapping',
        labels: ['documentation'],
        docs: true,
        blockedBy: ['ddl', 'repo', 'relations', 'index-expr'],
        goal: `
Flip both pages from \`todo\` to \`supported\`, replace their workaround sections with the real API,
and re-point the upstream test suites that are currently argued against because zmdb could not do
this.
`,
        why: `
A gap page that stops being true is worse than a missing page: it tells a reader to write the
two-statement workaround when \`findById({ orgId, userId })\` now works. And the api-coverage gate
carries out-of-scope rationales that were honest only while the gap existed — leaving them says we
chose not to do something we just did.
`,
        files: [
          "`docs-site/pages.mjs` — `composite-keys` and `guide-case-insensitive-unique` to `status: 'supported'`, notes removed.",
          '`docs-site/content/composite-keys.md`, `docs-site/content/guide-case-insensitive-unique.md` — rewrite.',
          '`tests/api-coverage/mapping.mjs` — MikroORM composite-key suites move from `oos(...)` to named tests.',
          '`README.md` — the todo/supported page counts in the status block.',
        ],
        steps: [
          'Rewrite both pages against the shipped API, with runnable examples. Include the partial-key error and the SQLite key-alter refusal — a page that documents only the happy path is how the next reader finds the sharp edge in production.',
          'Flip the two `status` fields and delete their `note`s. `yarn verify:docs-coverage` will fail if a supported page still carries a gap note.',
          'Search `tests/api-coverage/mapping.mjs` for out-of-scope rationales mentioning composite keys and replace each with the exact title of a test that now covers it. The gate fails if a cited title does not exist, which is the point.',
          'Update the docs counts in `README.md` (`190 supported / 86 todo` today) and re-run `node docs-site/build.mjs` to get the real numbers rather than doing the arithmetic by hand.',
          'Grep the rest of the docs for the old claim: `grep -rn "composite" docs-site/content` will find pages that say it is unsupported in passing.',
        ],
        tests: [
          'No new unit tests. The gates are the test here.',
          '`node docs-site/build.mjs` — page count changes and both pages build.',
          '`yarn verify:docs-coverage` — green with the notes removed.',
          '`yarn verify:api-coverage` — green with the rationales replaced by real test titles.',
        ],
        dod: [
          'Both pages `supported`, no gap notes, workarounds replaced by the real API.',
          'Every upstream composite-key suite that was argued against now names a test.',
          'README counts match `docs-site/build.mjs` output.',
          'All fourteen `verify:*` gates green.',
        ],
      },
    ],
  },

  {
    key: 'naming',
    title: '[EPIC] Naming strategy — physical names decided at build time',
    labels: ['enhancement', 'area:schema', 'parity:mikro-orm'],
    pages: ['naming-strategy'],
    packages: ['@zmdb/schema-core', '@zmdb/compiler', '@zmdb/query-compiler'],
    motivation: `
Table and column names are used exactly as declared. A team whose database is \`user_accounts\` with
\`created_at\` has to write those names in the TypeScript declaration, which means the property names
in application code are snake_case too — or they maintain a hand-written mapping, which is the
schema drift zmdb exists to delete.

Every other ORM solves this with a naming strategy, and every other ORM pays for it at runtime: a
per-query name lookup, or a proxy, or a result-row rewrite. zmdb cannot do that (§2.1, north star 1),
and it does not have to. A declaration is a type, the reflection reads it once at build time, and the
emitted IR can carry the *physical* name beside the property name. The strategy runs in the
transformer, not in the request.

That single design decision is what this epic is about, and it is why the work is not "add a hook to
the query compiler".
`,
    dod: [
      'A `zmdb.config.ts` naming strategy maps property names to physical names at AOT time, and the emitted `SchemaIR` carries both.',
      'Every SQL-producing path uses the physical name; every derived type uses the property name. No runtime name transformation anywhere on the hot path.',
      'An explicit name in the declaration always wins over the strategy, and a collision produced by the strategy is a build error naming both properties.',
      'Built-in strategies for snake_case and pluralised table names, plus a user function; all three are pure and run once per build.',
      'The `naming-strategy` page documents the build-time model, including what happens to a raw SQL string a caller writes by hand.',
    ],
    invariants: [
      '§1 cost model: naming is type-check/build-time work. A benchmark before and after must show no per-query delta — if it does, the strategy has leaked into runtime.',
      '§2.9 one front-end: the strategy runs where the IR is produced, so both the DDL and the emitted validator read the same physical names. Two independent name resolutions would be the four-walkers problem again.',
      '§2.2 no runtime reflection: the strategy is a build-time function of names, never of a value inspected at runtime.',
      '§2.4 explicit SQL: a caller who writes a column name in a raw fragment gets the physical name they typed. The epic must say so rather than silently rewriting strings.',
    ],
    subs: [
      {
        key: 'spec',
        title: '[Spec Freeze] build-time naming strategy: where it runs and what it may not touch',
        labels: ['spec'],
        goal: `
Freeze the model: a naming strategy is a pure function applied once, in the reflection, producing an
IR that carries both names. Decide and write down every consequence — collisions, explicit
overrides, relation column names, index names, raw SQL fragments, and what a snapshot records.
`,
        why: `
The tempting implementation is a hook in the query compiler, because that is where names are turned
into SQL. It is also the implementation that puts a function call on the hot path for every column
of every row, forever. Freezing "build time, in the IR" first is what stops that, and it has
consequences the spec has to spell out — a snapshot, for instance, must record physical names or
every migration diff after a strategy change will be a rename storm.
`,
        files: [
          '`packages/schema-core/src/ir/SPEC.md` — `ColumnIR.physicalName` / `SchemaIR.physicalTable` and the rule that SQL reads one, types read the other.',
          '`packages/compiler/src/reflect/SPEC.md` — where the strategy is applied during reflection.',
          '`packages/query-compiler/src/migrations/SPEC.md` — snapshots record physical names.',
        ],
        api: `
// zmdb.config.ts (loaded by @zmdb/compiler/config, not at runtime)
export interface NamingStrategy {
  /** Property name → column name. Called once per column per build. */
  readonly column?: (property: string, context: { table: string }) => string;
  /** Declared table name → physical table name. */
  readonly table?: (declared: string) => string;
  /** Derived object names, so an index is not the only thing left in camelCase. */
  readonly index?: (table: string, columns: readonly string[], unique: boolean) => string;
}

export interface ZmdbConfig {
  readonly naming?: NamingStrategy | 'snake_case' | 'snake_case_plural';
}

// The IR carries both. Types derive from the property name; SQL uses the physical one.
interface ColumnIR {
  readonly name: string;          // property name, as declared
  readonly physicalName: string;  // what SQL uses; === name when no strategy applies
}
`,
        steps: [
          'Write the "Physical names" section of the IR spec: both fields always present, `physicalName === name` when no strategy is configured, and a hard rule that nothing outside the IR producer may compute a physical name.',
          "Decide the override mechanism. A `Sql<...>` tag already carries the column type; the spec must say whether an explicit column name is a new tag (`Column<'created_at'>`) or a property of an existing one, and it must state that explicit beats strategy.",
          'Specify collision detection: two properties mapping to one physical name is a build error naming both. Write the message. This is the failure a snake_case strategy produces for `createdAt` and `created_at` in the same interface.',
          'Specify relation and index naming: a foreign-key column and a generated index name are derived from other names, so they must be derived from *physical* names, or a snake_case database ends up with a camelCase index.',
          'Specify snapshot behaviour: `SchemaSnapshot` records physical names only, and the spec states what happens when a strategy changes under an existing snapshot (it is a rename diff, and the runner should be able to say so rather than emitting drop+add).',
          'Specify the raw-SQL boundary explicitly: a string a caller writes in `where`, `IndexDef.expr` or a check constraint is not rewritten. Say it in the spec and repeat it on the docs page.',
          'Specify config loading: the strategy comes from `zmdb.config.ts`, whose canonical loader is `@zmdb/compiler/config`. Name that dependency so no adapter invents a second loader.',
        ],
        tests: ['None — spec text only.', '`yarn validate:spec` green.'],
        dod: [
          'IR, reflect and migrations SPEC sections written.',
          'Override mechanism, collision error text, index/FK derivation and the raw-SQL boundary all decided in prose.',
          'The dependency on the config loader named, with the sub-issue it belongs to.',
          'No code.',
        ],
      },
      {
        key: 'tests',
        title: '[Tests Freeze] naming strategy — failing tests across reflection, DDL and derived types',
        labels: ['spec'],
        blockedBy: ['spec'],
        goal: 'Land red tests for every claim in the naming spec, including the two that are easiest to get wrong: a collision must fail the build, and a derived index name must use physical names.',
        files: [
          '`packages/compiler/src/reflect/reflect.spec.ts` — reflection applies the strategy.',
          '`packages/compiler/src/reflect/__fixtures__/` — a fixture interface in camelCase.',
          '`packages/query-compiler/src/migrations/migrations.spec.ts` — DDL and snapshot use physical names.',
          '`packages/schema-core/src/ir/ir.type-test.ts` — derived types keep property names.',
        ],
        tests: [
          '`applies the column strategy once, into the IR` — `physicalName` is `created_at` while `name` stays `createdAt`.',
          '`leaves physicalName equal to name when no strategy is configured` — the default path, so the field is never a surprise.',
          '`lets an explicit column name beat the strategy`.',
          '`fails the build when two properties collide on one physical name, naming both`.',
          '`emits DDL with physical names and derives Entity with property names` — one declaration, both assertions, which is the whole point of carrying two names.',
          '`derives an index name from physical names`.',
          '`records physical names in the snapshot`.',
          '`does not rewrite a raw SQL fragment` — a `where` string with a camelCase name is emitted as written.',
          "Type-level: `Expect<Equal<keyof Entity<User>, 'id' | 'createdAt'>>` — the strategy must not leak into the type surface.",
        ],
        steps: [
          'Add a camelCase fixture under `packages/compiler/src/reflect/__fixtures__/` — note that `fixtures/` is outside the vitest include globs, so it is compiled by the reflection session, not run.',
          'Write a benchmark-shaped assertion for the cost claim: capture the compiled SQL for a select before and after a strategy is configured and assert the *emitted text* differs while the compile path does no extra work. A timing test would be flaky; an "identical call count" test is not.',
          'Leave filesystem-backed config loading outside the reflection unit tests (pass a literal strategy object); `@zmdb/compiler/config` has its own contract tests.',
        ],
        dod: [
          'Every spec claim has a named failing test.',
          'A camelCase reflection fixture exists.',
          '`node scripts/typecheck.mjs` green.',
        ],
      },
      {
        key: 'reflect',
        title: 'Apply the naming strategy in the reflection, carrying both names in the IR',
        labels: ['enhancement'],
        blockedBy: ['tests'],
        goal: 'Add `physicalName`/`physicalTable` to the IR and populate them in the reflector, with collision detection as a build diagnostic. After this slice the IR is complete and no SQL has changed yet.',
        why: 'Splitting "the IR carries the name" from "SQL uses the name" keeps the risky half small. If the two land together, a bug in either shows up as wrong SQL and there is no way to tell which half produced it.',
        files: [
          '`packages/schema-core/src/ir/index.ts` — `ColumnIR`, `SchemaIR`, the IR vocabulary tables and `vocabulary.type-test.ts`.',
          '`packages/compiler/src/reflect/index.ts` — apply the strategy while building `schemaIrFromType`.',
          '`packages/compiler/src/reflect/index.ts` `#refuse` path — the collision diagnostic.',
        ],
        api: `
export interface ReflectOptions {
  readonly limits?: Partial<ReflectLimits>;
  /** Resolved from zmdb.config.ts by the caller. Absent means identity. */
  readonly naming?: NamingStrategy;
}
`,
        steps: [
          'Add the fields to `ColumnIR`/`SchemaIR` as required, defaulting to the declared name. Update `vocabulary.type-test.ts`, which pins the IR key names.',
          'Thread `naming` through `ReflectOptions` → `Reflector` → `schemaIrFromType`. It is one more field on an options object that already merges `DEFAULT_LIMITS`.',
          'Apply the strategy exactly once per column and once per table, and assert that in a test by passing a counting function.',
          'Report a collision through the existing diagnostic channel (`#refuse` / `ReflectDiagnostic`) so it reaches `TransformDiagnostic` and fails a build the way an unsupported type does. Do not throw — the transformer collects diagnostics per call site.',
          'Note the known defect in that channel: `EmitDiagnostic.path` carries an emitted-source expression rather than a property chain. Do not extend that confusion into the reflect diagnostic — the collision message must name the two *property* names.',
        ],
        tests: [
          'The reflect tests from the tests-freeze slice go green.',
          '`applies the column strategy exactly once per column` — counting function.',
          '`reports a collision as a diagnostic, not an exception`.',
          '`vocabulary.type-test.ts` updated and compiling.',
        ],
        dod: [
          'IR carries both names everywhere it is produced (reflection, `schemaIrsFrom` test helper, codegen).',
          'Collision is a build diagnostic naming both properties.',
          '`npx vitest run`, `node scripts/typecheck.mjs` green.',
        ],
      },
      {
        key: 'sql',
        title: 'Every SQL path reads the physical name',
        labels: ['enhancement'],
        blockedBy: ['reflect'],
        goal: 'Switch the DDL emitter, the query compiler boundary, the snapshot and the derived index/FK names over to `physicalName`, leaving derived TypeScript types on the property name.',
        why: 'This is the slice that makes the feature real, and it is where a missed call site produces a query that references a column the database does not have. `yarn verify:one-walker` exists precisely because column metadata reads spread; use it as the checklist of files to audit.',
        files: [
          '`packages/schema-core/src/ir/index.ts` — `schemaFromIR`, which is what the DDL boundary consumes.',
          '`packages/query-compiler/src/migrations/index.ts` — `snapshot`, `emitUp`, `columnDdl`.',
          '`packages/query-compiler/src/schema-objects/index.ts` — generated index and constraint names.',
          '`packages/repository/src/index.ts` — where a DTO property becomes a column in a compiled statement.',
        ],
        steps: [
          'Run `yarn verify:one-walker` and read its exemption list: those files are the complete set that may read column metadata, which makes them the complete set to audit.',
          'At the repository boundary, translate DTO property names to physical names once per statement, from a map built at construction — not per column per row.',
          'Make `where`, `orderBy`, `groupBy` and projection paths all go through that one translation. A missed one is a runtime SQL error, so add a test per path rather than trusting the audit.',
          'Result rows come back keyed by physical name. Decide per the spec how a row becomes an `Entity` (aliasing in the SELECT list is the zero-cost option: `SELECT "created_at" AS "createdAt"` costs nothing at runtime and keeps the row shape correct without a rewrite).',
          'Benchmark: run the existing repository/validation benchmarks before and after and check the delta is noise. Record the numbers in the PR — north star 1 makes this a correctness check, not a nicety.',
        ],
        tests: [
          '`emits DDL with physical names and derives Entity with property names`.',
          '`aliases a physical column back to its property name in the select list` — golden SQL.',
          '`filters, orders and groups by physical names` — one test per path.',
          '`records physical names in the snapshot`.',
          '`derives an index name from physical names`.',
          '`does not rewrite a raw SQL fragment`.',
        ],
        dod: [
          'Every SQL-producing path audited against the one-walker list, with a test per path.',
          'Row → entity mapping costs nothing per row (aliasing or equivalent), demonstrated by benchmark parity.',
          '`npx vitest run`, `yarn verify:one-walker`, `yarn verify:bench` green.',
        ],
      },
      {
        key: 'strategies',
        title: 'Built-in snake_case and pluralising strategies, wired through the config file',
        labels: ['enhancement'],
        blockedBy: ['sql', 'cli:config'],
        goal: 'Ship the two strategies people actually want, resolved from `zmdb.config.ts` by the transformer and the codegen CLI, so a project turns this on with one line and no runtime cost.',
        why: 'A `NamingStrategy` interface with no implementations is a hook, not a feature. The two built-ins are also the test cases that expose the collision and acronym problems every hand-rolled snake_case function gets wrong.',
        blockedByNote: 'Uses the canonical loader from `@zmdb/compiler/config`.',
        files: [
          '`packages/schema-core/src/naming/index.ts` (new) + `SPEC.md`',
          '`packages/schema-core/package.json` — a `./naming` subpath.',
          '`packages/compiler/src/unplugin/index.ts` and `src/codegen/` — read `naming` from the loaded config.',
        ],
        api: `
export const snakeCase: NamingStrategy;
export const snakeCasePlural: NamingStrategy;
export function resolveNaming(config: ZmdbConfig['naming']): NamingStrategy;
`,
        steps: [
          'Implement `snakeCase` with the cases that break naive implementations: `createdAt` → `created_at`, `HTTPStatus` → `http_status`, `id2` → `id2`, `userID` → `user_id`, and a name already in snake_case is unchanged (idempotence).',
          'Implement pluralisation as a small explicit rule set plus an irregular table, and document that it is deliberately not a linguistics library — `person` → `people` if the table says so, otherwise the user supplies a function.',
          'Add the `./naming` export and register it wherever the export inventory is checked (`yarn verify:exports` imports every subpath).',
          'Read `naming` from the config in both AOT routes — the unplugin transformer and project compiler — and prove they agree: the repo already has consumer fixtures for both routes (`fixtures/consumer-plugin`, `fixtures/consumer-cli`) and `yarn verify:fixtures` asserts they emit the same code.',
        ],
        tests: [
          '`snake_cases the names every hand-rolled implementation gets wrong` — table-driven over the cases above.',
          '`is idempotent on a name that is already snake_case`.',
          '`pluralises from an explicit rule set, and leaves an unknown word alone`.',
          '`resolves a strategy name from config, and a function as itself`.',
          'Fixture-level: both AOT routes emit the same physical names (`yarn verify:fixtures`).',
        ],
        dod: [
          'Both strategies shipped, exported from a documented subpath.',
          'Both AOT routes read the config and agree; `yarn verify:fixtures` green.',
          '`yarn verify:exports` green.',
        ],
      },
      {
        key: 'docs',
        title: '[Docs] naming strategy — the build-time model, written down',
        labels: ['documentation'],
        docs: true,
        blockedBy: ['strategies'],
        goal: "Flip `naming-strategy` to supported and explain the one thing that makes zmdb's answer different: the strategy runs at build time, so the physical name is baked into the emitted code and costs nothing per query.",
        files: [
          '`docs-site/pages.mjs`, `docs-site/content/naming-strategy.md`',
          '`tests/api-coverage/mapping.mjs` — MikroORM naming-strategy suites.',
          '`docs-site/content/migrate-from-mikro-orm.md` — the migration page should stop listing this as a gap.',
        ],
        steps: [
          'Write the page around the model, not the API: what runs when, why there is no runtime hook, and what that buys.',
          'Document the sharp edges: collisions are build errors, raw SQL is never rewritten, changing a strategy under an existing database is a rename migration.',
          'Re-point the upstream naming-strategy suites in `tests/api-coverage/mapping.mjs` at real test titles.',
          'Update the migration-from-MikroORM page and the README counts.',
        ],
        tests: ['`node docs-site/build.mjs`, `yarn verify:docs-coverage`, `yarn verify:api-coverage` green.'],
        dod: [
          'Page supported, no gap note, build-time model explained with the sharp edges.',
          'Upstream suites re-pointed; migration page updated; README counts refreshed.',
        ],
      },
    ],
  },
];
