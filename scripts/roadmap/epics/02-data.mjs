// Read/write path gaps: expression-valued writes, filters that apply themselves, referential
// actions, streaming and cancellation, and the two caching layers. All of these are query-compiler
// and repository work, and all of them are places where the convenient implementation is a runtime
// cost the cost model forbids.

export const DATA_EPICS = [
  {
    key: 'setexpr',
    title: '[EPIC] Expression-valued writes — SET col = col + 1 without a read',
    labels: ['enhancement', 'area:query', 'parity:drizzle', 'parity:kysely'],
    pages: ['guide-increment-decrement', 'guide-toggle-boolean', 'guide-bulk-update'],
    packages: ['@zmdb/query-compiler', '@zmdb/repository'],
    motivation: `
\`updateTable(...).set(row)\` (packages/query-compiler/src/index.ts:172) takes a row of *values*.
Every value becomes a placeholder, which is right for \`SET "name" = $1\` and impossible for
\`SET "views" = "views" + 1\`.

The consequence is that the three most common write patterns in any application cannot be expressed:
incrementing a counter, toggling a boolean, and a bulk update computed from the row's own columns.
The workaround the docs currently show is read-then-write, which is not equivalent — it is a lost
update under concurrency, and no amount of care in application code fixes that. The database has an
atomic answer and zmdb cannot reach it.

There is a second, quieter cost: without expression SET, \`upsert\`'s \`DO UPDATE SET\` cannot
reference the proposed row (\`excluded\`), so an upsert that should merge has to overwrite.
`,
    dod: [
      '`set()` accepts an expression alongside a value, per column, and the type system knows which columns an expression may reference.',
      '`SET "views" = "views" + $1` is emitted with the increment parameterised, in all three dialects, and the column reference quoted.',
      'A boolean toggle emits `NOT "flag"` (Postgres/SQLite) and `NOT `flag`` / `!`flag`` as appropriate for MySQL, chosen per dialect rather than by string interpolation.',
      '`upsert` can reference the proposed row in its update clause: `excluded."col"` on Postgres/SQLite, `VALUES("col")` (or the 8.0.19+ alias form) on MySQL.',
      '`BaseRepository` exposes the atomic form — `increment`/`decrement` or an expression-accepting `update` — with validation that still runs on the value operands.',
      'All three guide pages flip to `supported` and stop recommending read-then-write.',
    ],
    invariants: [
      '§2.4 explicit SQL, and this is the epic where it bites: an expression is emitted, so the emitter must own quoting and parameterisation. A caller-supplied SQL string as the escape hatch is acceptable only if `yarn verify:escape-hatches` sees it and the trust boundary is documented.',
      '§2.3 validation at the boundary: an expression has no value to validate, so `create`/`update` validation must skip expression operands without skipping the value ones. Silently dropping validation for the whole row would be a regression.',
      '§1 cost model: expression building happens when the statement is compiled. No per-row work, no AST interpretation at execute time.',
      '§2.5 no `as`: the expression type must be derivable from the column type, so `views + 1` is a type error on a `boolean` column at compile time rather than a database error at runtime.',
    ],
    subs: [
      {
        key: 'spec',
        title: '[Spec Freeze] the expression vocabulary for SET, and what it may reference',
        labels: ['spec'],
        goal: `
Decide and freeze the smallest expression vocabulary that covers increment, decrement, toggle,
string concat, coalesce and \`excluded\` references — and the rule that decides what is *not* in it.
An open-ended SQL expression builder is a different, much larger project; this spec exists to draw
that line and justify where.
`,
        why: `
The two failure modes are symmetric. Too narrow (an \`increment\` method only) and the next request
is \`SET balance = balance - amount WHERE balance >= amount\`, and the API grows a method per verb.
Too broad (a general expression AST) and zmdb has a second query language, with its own dialect
differences and its own escaping bugs, on the write path. The spec has to pick a middle and say what
makes something in or out.
`,
        files: [
          '`packages/query-compiler/src/SPEC.md` — a "Write expressions" section.',
          '`packages/repository/SPEC.md` — the repository-level surface and the validation rule.',
        ],
        api: `
/** A value or a computed expression, per column. Values stay parameterised exactly as today. */
export type SetValue<T> = T | ColumnExpr<T>;

/** Deliberately closed. Each variant maps to SQL the emitter fully owns. */
export type ColumnExpr<T> =
  | { readonly op: 'add' | 'sub' | 'mul'; readonly column: string; readonly by: T }
  | { readonly op: 'not'; readonly column: string }
  | { readonly op: 'concat'; readonly column: string; readonly with: string }
  | { readonly op: 'coalesce'; readonly column: string; readonly fallback: T }
  | { readonly op: 'proposed'; readonly column: string };  // excluded."col" / VALUES(\`col\`)

export function inc<T extends number>(by?: T): ColumnExpr<T>;
export function dec<T extends number>(by?: T): ColumnExpr<T>;
export function not(): ColumnExpr<boolean>;
export function proposed<T>(): ColumnExpr<T>;
`,
        steps: [
          'Write the inclusion rule: a variant is in the vocabulary when it maps to one operator on the *same* column in every supported dialect, and out when it needs a dialect-specific rewrite beyond an operator token. Then record which of the six variants each dialect spells differently.',
          'Fix the implicit-column convention: `inc(1)` on the `views` key of a `set()` object references `views`. Say so, so the API does not need a column name repeated at every call site — and specify that a cross-column reference is *not* in the vocabulary for this epic (that is the wider expression builder, and it is a non-goal).',
          'Record the exact SQL per variant per dialect, including MySQL string concat (`CONCAT`, not `||`) and boolean negation.',
          'Record the `proposed` (upsert) spelling per dialect and note the MySQL 8.0.20 deprecation of `VALUES()` in favour of the row alias — decide which one is emitted and whether a minimum server version is now part of the contract.',
          'Specify validation: for `create`/`update`, an expression operand is validated as the operand type (a number for `inc`), and the column itself is exempt from the row-level check. State what happens when a column is `NOT NULL` and the expression could produce null (`coalesce` cannot, `concat` with a nullable column can).',
          'Specify the type rule that makes `not()` on a number a compile error, and write the type-test that will prove it.',
          'Declare the non-goals in the spec so the next reader does not relitigate them: cross-column references, subqueries in SET, `RETURNING` computed values, and a general expression AST.',
        ],
        tests: ['None — spec only.', '`yarn validate:spec` green.'],
        dod: [
          'Vocabulary frozen with an inclusion rule, not just a list.',
          'Per-variant, per-dialect SQL written down verbatim, including the MySQL divergences.',
          'Validation and nullability rules decided; non-goals recorded.',
        ],
      },
      {
        key: 'tests',
        title: '[Tests Freeze] expression SET — golden SQL per dialect and the type errors',
        labels: ['spec'],
        blockedBy: ['spec'],
        goal: 'Land the failing golden-SQL tests for all six variants across three dialects, the upsert `proposed` cases, the repository-level tests, and the type-level tests that pin what must *not* compile.',
        why: 'Expression emission is exactly the kind of code where a substring assertion passes while the statement is wrong. Every test here asserts the full statement text and the parameter array, because the parameter array is where a mis-ordered placeholder shows up.',
        files: [
          '`packages/query-compiler/src/query-compiler.spec.ts` and/or a new `src/expressions/expressions.spec.ts`',
          '`packages/repository/src/repository.spec.ts`',
          '`packages/repository/src/typed-methods/typed-writes.type-test.ts`',
          '`packages/repository/src/sqlite-e2e.spec.ts` — a real atomic increment against `node:sqlite`.',
        ],
        tests: [
          '`increments a column without reading it first` — full `UPDATE ... SET "views" = "views" + $1 WHERE ...` plus `params`, three dialects.',
          '`decrements with a default step of one`.',
          '`toggles a boolean with the dialect negation operator` — three dialects, since MySQL differs.',
          '`concatenates onto a column using the dialect concat form` — `||` vs `CONCAT`.',
          '`coalesces a nullable column to a fallback`.',
          '`mixes an expression column and a value column in one SET` — asserts placeholder ordering, which is the failure a single-column test cannot see.',
          '`references the proposed row in an upsert update clause` — `excluded."stock"` and the MySQL form.',
          '`increments atomically against a real database` — sqlite E2E: two sequential increments from a known start, asserting the stored value, so the test would catch a read-then-write implementation.',
          '`validates the operand of an expression and skips the row check for that column` — repository level.',
          'Type-level: `@ts-expect-error` on `not()` for a numeric column, `inc()` for a boolean column, and `proposed()` outside an upsert.',
        ],
        steps: [
          'Write every test red, with the current failure recorded in a comment (today `set({ views: inc(1) })` does not compile at all, so note that these start as compile failures and add the minimal types in this slice to make them assertion failures instead).',
          'Add the `SetValue`/`ColumnExpr` types and the `inc`/`dec`/`not`/`proposed` constructors as types + stubs that throw `not implemented`, so failures are behavioural.',
          'For the sqlite E2E test, follow the existing pattern in `sqlite-e2e.spec.ts` — a real `DatabaseSync`, real DDL, real rows.',
        ],
        dod: [
          'Every vocabulary variant has golden SQL in three dialects; every type rule has a type-test.',
          'One test asserts mixed value/expression placeholder ordering.',
          'One test proves atomicity against a real database.',
          '`node scripts/typecheck.mjs` green.',
        ],
      },
      {
        key: 'compiler',
        title: 'Expression SET in the compiler: emission, quoting and placeholder ordering',
        labels: ['enhancement'],
        blockedBy: ['tests'],
        goal: 'Implement the frozen vocabulary in `updateTable(...).set()` so all three dialects emit correct SQL with correctly ordered parameters, and `onConflict` can reference the proposed row.',
        files: [
          "`packages/query-compiler/src/index.ts` — `set()`, the UPDATE emitter, `onConflict`'s update clause.",
          '`packages/query-compiler/src/expressions/index.ts` (new) — the constructors and the per-dialect emitter.',
          '`packages/query-compiler/src/quoting.ts` — reuse, do not reimplement, identifier quoting.',
        ],
        api: `
export function inc<T extends number>(by?: T): ColumnExpr<T>;
export function dec<T extends number>(by?: T): ColumnExpr<T>;
export function not(): ColumnExpr<boolean>;
export function concat(withValue: string): ColumnExpr<string>;
export function coalesce<T>(fallback: T): ColumnExpr<T>;
export function proposed<T>(): ColumnExpr<T>;

/** Emitted fragment plus the parameters it contributed, in order. */
interface EmittedExpr { readonly sql: string; readonly params: readonly unknown[]; }
`,
        steps: [
          "Discriminate an expression from a value by a brand symbol, not by shape: a caller storing `{ op: 'add' }` as JSON in a column must not have it interpreted as an expression. Use a non-enumerable symbol property and check it with `typeof v === 'object' && v !== null && BRAND in v`.",
          'Emit through one function that returns `{ sql, params }` and append params in emission order — the mixed-column test exists to catch the version that collects params separately from SQL.',
          'Quote the referenced column with the dialect quoter, and never interpolate the operand: `"views" + $1`, not `"views" + 1`.',
          'Route MySQL divergences through the existing dialect switch rather than a new one: negation and `CONCAT` are the two, plus the `proposed` spelling.',
          'For `onConflict`, allow `proposed()` in the update object. Reject `proposed()` in a plain `UPDATE` with a message saying it is only valid in an upsert — the type-test asserts the compile error, and the runtime check catches the untyped path.',
          'Do not let this leak into the WHERE compiler. The operator allowlist there is a security boundary (see #364) and is not part of this change; if a shared helper is tempting, check that no user-controlled key can reach the expression path through it.',
        ],
        tests: [
          'All compiler tests from the tests-freeze slice go green.',
          "`does not treat a plain object column value as an expression` — a JSON column whose value is `{ op: 'add', column: 'x', by: 1 }` is inserted as data.",
          '`rejects proposed() outside an upsert with a message naming the method`.',
        ],
        dod: [
          'All six variants emit correct SQL in three dialects with correct parameter order.',
          'Expression detection is brand-based and proven not to capture plain data.',
          '`yarn verify:escape-hatches` green; no new `as` in the emitter.',
          '`npx vitest run` green.',
        ],
      },
      {
        key: 'repo',
        title: 'Atomic writes on the repository, with validation that still runs',
        labels: ['enhancement'],
        blockedBy: ['compiler'],
        goal: 'Expose expression writes through `BaseRepository` so application code gets an atomic increment without dropping to the compiler, and make DTO validation treat expression operands correctly.',
        why: 'The repository is where validation lives, and validation is the part most likely to be quietly disabled by this feature: the obvious implementation validates the `set` object against `UpdateDTO`, sees an object where a number belongs, and either throws on a legal call or is loosened until it throws on nothing.',
        files: [
          '`packages/repository/src/index.ts` — `update`, `updateMany`, `upsert`, and the validation call site.',
          '`packages/repository/src/typed-methods/index.ts` — the typed write surface.',
          '`packages/repository/SPEC.md`',
        ],
        api: `
class BaseRepository<T extends DeclaredTable> {
  update(id: PrimaryKeyOf<T>, patch: UpdatePatch<T>): Promise<Entity<T>>;
  updateMany(where: WhereDTO<T>, patch: UpdatePatch<T>): Promise<number>;
  /** Sugar for the overwhelmingly common case; compiles to the same statement. */
  increment(id: PrimaryKeyOf<T>, column: NumericColumnOf<T>, by?: number): Promise<Entity<T>>;
}

type UpdatePatch<T> = { readonly [K in keyof UpdateDTO<T>]?: SetValue<UpdateDTO<T>[K]> };
`,
        steps: [
          "Split the patch into value columns and expression columns before validating, validate the value columns against `UpdateDTO`, and validate each expression's operand against the column type. Do not widen the DTO validator to accept objects.",
          'Derive `NumericColumnOf<T>` from the IR so `increment` cannot name a text column — a runtime check here would be a type-system failure.',
          'Make sure hooks see something coherent: `beforeUpdate` receives a patch that may contain expressions, and a hook that reads `patch.views` expecting a number now gets a branded object. Decide (in the SPEC) whether hooks see the raw patch or a marker, and document it — this is a breaking change to the hook contract and the SPEC is where that belongs.',
          'Check the `RETURNING` path: an expression update should return the computed value, which Postgres and SQLite give for free and MySQL does not. Document the MySQL difference rather than emulating it with a follow-up SELECT that would break atomicity.',
          'Re-export `inc`/`dec`/`not`/`coalesce`/`concat`/`proposed` from `zmdb` and add them to the export inventory.',
        ],
        tests: [
          '`validates the operand of an expression and skips the row check for that column`.',
          '`increments through the repository and returns the computed row` — Postgres/sqlite; a documented-difference test for MySQL.',
          '`passes expressions to beforeUpdate in the documented form`.',
          'Type-level: `increment` rejects a non-numeric column; `UpdatePatch` accepts a value or an expression per column.',
          '`exports the expression constructors from the umbrella package` — covered by `yarn verify:exports`.',
        ],
        dod: [
          'Atomic increment reachable from `zmdb` in one call.',
          'Validation still runs on every value operand; the hook contract change is documented in the SPEC.',
          '`yarn verify:exports`, `npx vitest run`, `node scripts/typecheck.mjs` green.',
        ],
      },
      {
        key: 'docs',
        title: '[Docs] increment/decrement, boolean toggle and bulk update',
        labels: ['documentation'],
        docs: true,
        blockedBy: ['compiler', 'repo'],
        goal: 'Flip the three guide pages to supported, and replace the read-then-write workaround with the atomic form — including an explicit note that the old workaround was not equivalent.',
        files: [
          '`docs-site/pages.mjs`, `docs-site/content/guide-increment-decrement.md`, `docs-site/content/guide-toggle-boolean.md`, `docs-site/content/guide-bulk-update.md`',
          '`docs-site/content/upsert.md` — the `DO UPDATE SET` section can now show a real merge.',
          '`tests/api-coverage/mapping.mjs` — Drizzle and Kysely SET-expression suites.',
        ],
        steps: [
          'Rewrite all three guides against the shipped API, with the emitted SQL shown per dialect — these pages are read by people who need to know what hits the database.',
          'Say plainly why the previous advice is withdrawn: read-then-write loses updates under concurrency. A guide that silently swaps the example teaches nothing.',
          'Document the MySQL `RETURNING` difference and the `VALUES()`/alias decision, including any minimum server version.',
          'Re-point the upstream suites in `tests/api-coverage/mapping.mjs`; several Drizzle update suites are argued against today on exactly this basis.',
          'Refresh the README docs counts from `node docs-site/build.mjs`.',
        ],
        tests: ['`node docs-site/build.mjs`, `yarn verify:docs-coverage`, `yarn verify:api-coverage` green.'],
        dod: [
          'Three pages supported; emitted SQL shown per dialect; the withdrawn advice explained.',
          'Upstream suites re-pointed; README counts refreshed.',
        ],
      },
    ],
  },

  {
    key: 'filters',
    title: '[EPIC] Entity filters and soft delete — a predicate the schema carries',
    labels: ['enhancement', 'area:query', 'parity:mikro-orm'],
    pages: ['entity-filters'],
    packages: ['@zmdb/schema-core', '@zmdb/repository', '@zmdb/query-compiler'],
    motivation: `
Soft delete and multi-tenancy are the same feature: every read of a table must carry a predicate the
caller did not write. zmdb has no way to attach one, so \`deletedAt IS NULL\` has to be repeated at
every call site — and the one place it is forgotten is a data leak, not a bug report.

MikroORM answers this with filters that can be enabled globally, per request, and parameterised.
Doing it zmdb's way has a constraint the others do not accept: the predicate has to be applied where
the statement is compiled, be visible in the emitted SQL, and cost nothing per row. It also has to be
*auditable* — a developer looking at a query needs a way to see that a filter was applied, because a
predicate applied invisibly is only comfortable until the first time it is wrong.
`,
    dod: [
      'A filter is declared with a table and applies to every `find`/`list`/`count`/`populate` read of it, including when the table is the *target* of a join or populate.',
      'Filters take parameters resolved per call (a tenant id), and a filter whose parameter is missing is an error, not an omitted predicate.',
      'A caller can disable a named filter explicitly for one call, and that disabling is visible at the call site.',
      'Writes are covered by the spec: whether `update`/`delete` are filtered is decided and enforced, not left to the reader.',
      '`softDelete` is shipped as a built-in filter plus the `delete`-becomes-`update` behaviour, with a way to read deleted rows deliberately.',
      'The `entity-filters` page flips to supported and documents the join/populate behaviour, which is where every implementation of this feature leaks.',
    ],
    invariants: [
      '§2.4 explicit SQL: the filter predicate appears in the compiled SQL, and the compiled SQL is what tests assert. No hidden post-filtering of result rows.',
      '§1 cost model: the predicate is combined with the caller WHERE at compile time. Per-row filtering in JavaScript is not an acceptable fallback for any dialect.',
      '§2.9 one front-end: a filter is part of the schema IR, so both the repository and the populate compiler read the same declaration.',
      '§2.3 boundary validation: filter parameters are validated like any other input, because a tenant id is user-controlled.',
    ],
    subs: [
      {
        key: 'spec',
        title: '[Spec Freeze] filter semantics: scope, joins, writes, and how a filter is disabled',
        labels: ['spec'],
        goal: `
Freeze what a filter is, where it applies and — the hard part — what happens when a filtered table
appears on the far side of a join or a populate. Decide the write-path rule and the disabling
mechanism. No code.
`,
        why: `
Filters are easy to specify for a single-table read and treacherous everywhere else. If \`users\` is
soft-deletable and \`posts.populate('author')\` runs a join, does the join carry
\`author.deleted_at IS NULL\`? If it does, an inner join silently drops posts; if it does not, the
soft delete leaks. Both answers are defensible and the spec must pick one, per relation kind, and
say what the alternative costs.
`,
        files: [
          '`packages/schema-core/src/ir/SPEC.md` — filters in the IR.',
          '`packages/repository/SPEC.md` — the read/write application rules and the disabling API.',
          '`packages/schema-core/src/relations/SPEC.md` — join and populate behaviour.',
        ],
        api: `
export interface FilterDef<P = void> {
  readonly name: string;
  /** Compiled to a WHERE fragment. Receives the resolved parameters. */
  readonly where: (params: P) => WhereFragment;
  /** Applied unless explicitly disabled. */
  readonly enabled?: boolean;
  /** Whether it also constrains UPDATE and DELETE. Decided per filter, defaulted by the spec. */
  readonly appliesToWrites?: boolean;
}

// Per-call escape, deliberately verbose so it is visible in review:
users.find({ role: 'admin' }, { filters: { softDelete: false } });
users.find({}, { filters: { tenant: { tenantId: ctx.tenantId } } });
`,
        steps: [
          'Define where a filter lives: on the declaration (a tag), in the repository options, or both. Prefer the declaration for soft delete (it is a property of the table) and the options for a request-scoped tenant, and say which is which.',
          "Decide the join/populate rule per relation kind and write the emitted SQL for each: to-one via join, to-many via a batched second query. The batched case is easier — the filter joins the second query's WHERE. The single-query join case is the one that needs a decision about `LEFT JOIN ... AND` versus `WHERE`.",
          'Decide the write rule. Default `appliesToWrites: true` for a tenant filter (an unfiltered `updateMany` crosses tenants — a security bug) and state the soft-delete case separately, since `delete` on a soft-deletable table is itself redefined.',
          'Specify the missing-parameter error: a filter declared with parameters and called without them throws, naming the filter. A filter that silently becomes `TRUE` when a parameter is absent is the leak this whole feature is supposed to prevent.',
          'Specify the disabling API and require it to be explicit per filter name. Reject a blanket `{ filters: false }`: it would be the one call that leaks after someone adds a second filter years later.',
          'Specify aggregate and count behaviour: `count`, `exists` and every aggregation are reads and are filtered. Say so, because these are the paths that get forgotten.',
          'Specify the audit affordance: how a developer confirms a filter was applied. Compiled-SQL inspection is the honest answer, so name the API that returns it.',
        ],
        tests: ['None — spec only.', '`yarn validate:spec` green.'],
        dod: [
          'Declaration site, join/populate rule per relation kind, write rule, missing-parameter error, disabling API, aggregate coverage and audit affordance all frozen in prose with example SQL.',
        ],
      },
      {
        key: 'tests',
        title: '[Tests Freeze] entity filters — the leak cases first',
        labels: ['spec'],
        blockedBy: ['spec'],
        goal: 'Write the failing tests, ordering them so the leak cases come first: populate, join, count, aggregate, `updateMany`, `deleteMany`. The single-table `find` case is the easy one and proves the least.',
        files: [
          '`packages/repository/src/filters/filters.spec.ts` (new)',
          '`packages/schema-core/src/relations/populate.spec.ts`',
          '`packages/repository/src/sqlite-e2e.spec.ts` — a real soft-delete round trip.',
        ],
        tests: [
          '`applies a declared filter to every single-table read` — find, findById, list, count, exists, each asserting compiled SQL.',
          '`applies the target filter when populating a to-one relation` — the join SQL.',
          '`applies the target filter to the batched query of a to-many populate`.',
          '`applies a filter to an aggregation and a group-by`.',
          '`applies a write filter to updateMany and deleteMany` — the cross-tenant case.',
          '`throws when a parameterised filter is called without its parameter, naming the filter`.',
          '`disables one named filter for one call and leaves the others applied` — two filters, one disabled.',
          '`soft-deletes by updating rather than deleting, and hides the row from subsequent reads` — sqlite E2E, real rows.',
          '`reads soft-deleted rows only when the filter is explicitly disabled` — sqlite E2E.',
          "Type-level: an unknown filter name in `{ filters: { ... } }` is a compile error; a parameterised filter's params are typed.",
        ],
        steps: [
          'Write each test asserting the whole compiled statement — a filter that lands in the wrong clause (`WHERE` instead of the join `ON`) produces working SQL with wrong results, so a substring assertion is worthless here.',
          'Include one test that would catch post-filtering in JavaScript: assert `LIMIT` interacts correctly with the filter (filter in SQL means `LIMIT 10` returns 10 live rows; post-filtering returns fewer).',
          'Add the types needed to compile, with stubs, so failures are behavioural.',
        ],
        dod: [
          'Every leak path has a named failing test asserting full SQL.',
          'One test distinguishes SQL filtering from post-filtering via `LIMIT`.',
          '`node scripts/typecheck.mjs` green.',
        ],
      },
      {
        key: 'reads',
        title: 'Filters on every read path, including joins and populate',
        labels: ['enhancement'],
        blockedBy: ['tests'],
        goal: 'Implement filter declaration, parameter resolution and application across `find`/`findById`/`list`/`count`/`exists`/aggregations/populate, with the join placement the spec chose.',
        files: [
          '`packages/repository/src/filters/index.ts` (new) — resolution and combination.',
          '`packages/repository/src/index.ts` — every read entry point.',
          '`packages/schema-core/src/relations/index.ts` — populate and join.',
          '`packages/schema-core/src/ir/index.ts` — carry filters declared on the table.',
        ],
        api: `
interface RepositoryOptions {
  readonly filters?: readonly FilterDef<never>[];
}
interface ReadOptions<T> {
  readonly filters?: FilterOverrides<T>;
}
`,
        steps: [
          'Resolve the active filter set once per call: declared filters, minus explicit disables, plus parameters. Combine with the caller WHERE by conjunction in one place, so a new read method cannot forget.',
          'Make forgetting impossible structurally: route every read through one internal `compileRead` that takes the filter set, rather than adding a filter call to seven methods. A test cannot prove the eighth method is covered; a single choke point can.',
          'Apply target filters in populate: for the batched to-many path, conjoin into the second query; for the joined to-one path, place the predicate where the spec says and add the golden SQL.',
          'Validate filter parameters through the existing boundary validator — a tenant id arrives from a request.',
          'Throw on a missing parameter, naming the filter, before any SQL is compiled.',
          'Expose the audit affordance the spec named (a compiled-SQL accessor or a debug hook) and use it in the tests, so the affordance is proven to work rather than merely documented.',
        ],
        tests: [
          'All read tests from the tests-freeze slice go green.',
          "`routes every read method through the same filter application` — a test that enumerates the repository's read methods and asserts each emits the predicate, so a newly added method fails until it uses the choke point.",
        ],
        dod: [
          'One choke point for read compilation; every read method proven filtered by an enumerating test.',
          'Populate and join behaviour matches the spec, with golden SQL.',
          'Missing parameters throw before compilation.',
        ],
      },
      {
        key: 'writes',
        title: 'Write-path filters and soft delete',
        labels: ['enhancement'],
        blockedBy: ['reads'],
        goal: 'Apply filters to `update`/`updateMany`/`delete`/`deleteMany` per the spec, and ship soft delete as a built-in filter that redefines `delete` as an update.',
        why: 'The write half is the security half. An unfiltered `updateMany` under a tenant filter is a cross-tenant write, which is worse than the read leak it mirrors.',
        files: [
          '`packages/repository/src/index.ts` — write entry points.',
          '`packages/repository/src/filters/soft-delete.ts` (new)',
          '`packages/schema-core/src/tags/index.ts` — a `SoftDelete` tag if the spec put the declaration on the type.',
        ],
        api: `
export const softDelete: (column: string) => FilterDef<void>;

class BaseRepository<T> {
  /** With soft delete active this issues UPDATE ... SET deleted_at = now(). */
  delete(id: PrimaryKeyOf<T>): Promise<void>;
  /** Always a real DELETE, whatever filters are active. Named so it cannot be reached by accident. */
  hardDelete(id: PrimaryKeyOf<T>): Promise<void>;
}
`,
        steps: [
          'Route writes through one choke point as the reads slice did, and apply filters whose `appliesToWrites` is true.',
          'Implement soft delete as a filter plus a `delete` override, and add `hardDelete` as the deliberate escape. Keep the timestamp dialect-correct: `Date` in Node, `TIMESTAMPTZ` in Postgres, ISO string in OpenAPI — the project rule for every timestamp.',
          'Decide and implement what a soft-deleted row does to a unique constraint. A soft-deleted `users.email` still occupies the unique index, so a re-registration fails; document it, and point at the partial-unique-index answer (`WHERE deleted_at IS NULL`) which `IndexDef.where` already supports.',
          'Make `upsert` coherent with soft delete: an upsert that collides with a soft-deleted row should be specified, not discovered.',
          'Check hook interaction: `beforeDelete`/`afterDelete` fire for a soft delete, and the SPEC says which.',
        ],
        tests: [
          'All write tests from the tests-freeze slice go green.',
          '`soft-deletes by updating rather than deleting, and hides the row from subsequent reads` — sqlite E2E.',
          '`hardDelete removes the row even with soft delete active`.',
          '`fires delete hooks for a soft delete` — per the SPEC decision.',
          '`documents the unique-constraint interaction` — a test showing the partial unique index workaround working.',
        ],
        dod: [
          'Write filters applied through one choke point; soft delete and `hardDelete` shipped.',
          'Unique-constraint and upsert interactions specified and tested.',
          'Timestamp handling dialect-correct.',
        ],
      },
      {
        key: 'docs',
        title: '[Docs] entity filters — including the parts that leak',
        labels: ['documentation'],
        docs: true,
        blockedBy: ['reads', 'writes'],
        goal: 'Flip `entity-filters` to supported, and write the page around the cases that go wrong: joins, populate, aggregates, writes, unique constraints.',
        files: [
          '`docs-site/pages.mjs`, `docs-site/content/entity-filters.md`',
          '`docs-site/content/soft-delete.md` if one exists, otherwise cross-link from the delete/CRUD pages.',
          '`tests/api-coverage/mapping.mjs` — MikroORM filter suites.',
        ],
        steps: [
          'Document the multi-tenancy recipe end to end, with the request-scoped parameter, because that is what people will use this for.',
          'Document the join/populate rule with the emitted SQL, and the soft-delete unique-constraint interaction with the partial-index answer.',
          'Document the audit affordance — how to see the predicate in the compiled SQL.',
          'Re-point MikroORM filter suites; refresh the README counts.',
        ],
        tests: ['`node docs-site/build.mjs`, `yarn verify:docs-coverage`, `yarn verify:api-coverage` green.'],
        dod: [
          'Page supported; join/populate/write/unique behaviours all documented with SQL; upstream suites re-pointed.',
        ],
      },
    ],
  },

  {
    key: 'cascade',
    title: '[EPIC] Referential actions — ON DELETE / ON UPDATE in the DDL',
    labels: ['enhancement', 'area:schema', 'parity:mikro-orm', 'parity:drizzle'],
    pages: ['cascading'],
    packages: ['@zmdb/schema-core', '@zmdb/query-compiler'],
    motivation: `
A relation declares which columns join, and nothing about what happens when the parent row goes away.
So the emitted DDL has no \`ON DELETE\` clause, which means every foreign key is \`NO ACTION\`, which
means deleting a parent fails with a constraint violation the application has to pre-empt by deleting
children by hand in the right order.

The important thing about this gap is where the answer belongs. Application-level cascading — the
repository deleting children before parents — is the wrong answer twice over: it is not atomic
without a transaction the caller may not have, and it is a per-delete cost for something the database
does for free. The right answer is in the DDL, which means it is a declaration problem: the relation
needs somewhere to say \`ON DELETE CASCADE\` and the migration diff needs to notice when it changes.
`,
    dod: [
      'A relation declares a referential action for delete and for update, and the emitted `FOREIGN KEY` carries it.',
      'All five SQL actions are supported where the dialect supports them, and refused with a named message where it does not.',
      "`diff` detects a changed action and emits the drop/add constraint pair the dialect requires; SQLite's inability to alter a constraint is reported rather than skipped.",
      'The foreign key itself is emitted — including a composite one, which means this epic reads the key list the composite-key epic introduces.',
      '`cascading` flips to supported, documents the database-level model, and says explicitly that zmdb does not emulate cascades in application code.',
    ],
    invariants: [
      '§1 cost model: cascading is database work. No repository-side child deletion, ever, however convenient.',
      '§2.9 one front-end: the action is part of the relation declaration in the IR, read once.',
      '§2.4 explicit SQL: the clause is emitted, golden-tested per dialect, and never assembled from user strings.',
    ],
    subs: [
      {
        key: 'spec',
        title: '[Spec Freeze] referential actions, per dialect, including what SQLite cannot alter',
        labels: ['spec'],
        goal: 'Freeze how a referential action is declared, the exact DDL per dialect, the diff behaviour, and the refusals. Decide the composite-FK form. No code.',
        why: 'The dialects genuinely differ — SQLite enforces foreign keys only when `PRAGMA foreign_keys=ON` and cannot alter a constraint at all; MySQL requires an index on the referencing column and silently creates one; `SET DEFAULT` is not supported by InnoDB. A spec that says "emit ON DELETE CASCADE" and stops will produce three different behaviours from one declaration.',
        files: ['`packages/schema-core/src/relations/SPEC.md`', '`packages/query-compiler/src/migrations/SPEC.md`'],
        api: `
export type ReferentialAction = 'cascade' | 'restrict' | 'set null' | 'set default' | 'no action';

interface RelationDef {
  readonly onDelete?: ReferentialAction;
  readonly onUpdate?: ReferentialAction;
}
`,
        steps: [
          'Write the emitted `FOREIGN KEY ... REFERENCES ... ON DELETE x ON UPDATE y` per dialect, including the constraint naming convention (a generated name must be deterministic, or every diff is a rename).',
          'Record the dialect exceptions explicitly: InnoDB rejects `SET DEFAULT`; SQLite requires the pragma for enforcement and cannot alter a constraint; MySQL creates a supporting index. Say what zmdb does about each — refuse, warn, or emit the index itself.',
          'Specify `SET NULL` against a `NOT NULL` column as a build-time error, since the database will only find it at delete time.',
          'Specify the composite FK form (`FOREIGN KEY ("a","b") REFERENCES t ("x","y")`) and name the dependency on the composite-key epic.',
          'Specify the diff: an action change is drop-constraint + add-constraint on Postgres and MySQL, and a refusal on SQLite.',
          'Specify whether zmdb turns the SQLite pragma on for the caller. Enabling it silently changes the behaviour of an existing database; leaving it off makes the emitted DDL decorative. Pick one, and write the reasoning down.',
        ],
        tests: ['None — spec only.', '`yarn validate:spec` green.'],
        dod: [
          'DDL per dialect, constraint naming, every dialect exception, the `SET NULL`/`NOT NULL` error, the composite form and the SQLite pragma decision all frozen.',
        ],
      },
      {
        key: 'tests',
        title: '[Tests Freeze] referential actions — golden DDL, diffs, refusals',
        labels: ['spec'],
        blockedBy: ['spec'],
        goal: 'Land failing golden-DDL tests for every action in every dialect, the diff pair, each refusal, and a real sqlite E2E proving a cascade actually cascades.',
        files: [
          '`packages/query-compiler/src/migrations/migrations.spec.ts`',
          '`packages/schema-core/src/relations/relations.spec.ts`',
          '`packages/repository/src/sqlite-e2e.spec.ts`',
        ],
        tests: [
          '`emits ON DELETE CASCADE on the foreign key` — three dialects, full statement.',
          '`emits every supported referential action` — table-driven over the five, with the InnoDB `SET DEFAULT` refusal.',
          '`names a generated constraint deterministically` — same schema twice, same name.',
          '`emits a composite foreign key referencing a composite key`.',
          '`refuses SET NULL on a NOT NULL column at build time`.',
          '`diffs a changed action into a drop and an add`.',
          '`refuses to alter a constraint on sqlite, naming the table`.',
          '`creates the supporting index MySQL requires` — or asserts the documented alternative.',
          '`cascades a real delete` — sqlite E2E with the pragma per the spec decision: insert parent + children, delete parent, assert children gone.',
        ],
        steps: [
          'Write all tests red; note that the current output has no `ON DELETE` clause at all, and record whether a `FOREIGN KEY` clause is emitted today (if it is not, this epic adds it, and the spec should have said so).',
          'For the E2E test, assert the pragma state explicitly — a cascade test that passes because the pragma happens to be on elsewhere proves nothing.',
        ],
        dod: ['Every action, refusal and diff has a named failing test; one E2E proves real cascading.'],
      },
      {
        key: 'ddl',
        title: 'Emit foreign keys with referential actions, and diff them',
        labels: ['enhancement'],
        blockedBy: ['tests', 'keys:ddl'],
        goal: 'Implement the FK clause with actions across the three dialects, deterministic constraint naming, the composite form, the diff pair and every refusal the spec named.',
        blockedByNote: 'Composite foreign keys need the ordered key list from the composite-key epic.',
        files: [
          '`packages/query-compiler/src/migrations/index.ts` — `columnDdl`, `emitUp`, `emitDown`, `diff`, plus FK snapshot carriage.',
          '`packages/query-compiler/src/schema-objects/index.ts` — constraint naming, and the MySQL supporting index.',
          '`packages/schema-core/src/relations/index.ts` — carry `onDelete`/`onUpdate` from the declaration into the IR.',
        ],
        api: `
interface ForeignKeySnapshot {
  readonly name: string;
  readonly columns: readonly string[];
  readonly references: { readonly table: string; readonly columns: readonly string[] };
  readonly onDelete: ReferentialAction;
  readonly onUpdate: ReferentialAction;
}
`,
        steps: [
          'Add `ForeignKeySnapshot` to `TableSnapshot` so a diff can see an action change. This is the second snapshot change in the roadmap — coordinate with the composite-key slice so the format changes once.',
          'Generate constraint names deterministically from table + columns + referenced table, truncated to the dialect identifier limit (63 in Postgres, 64 in MySQL) with a stable hash suffix rather than a plain truncation, or two long names collide.',
          'Emit the actions with an explicit per-dialect map, and refuse `SET DEFAULT` on MySQL with a message that names the engine limitation.',
          'Validate `SET NULL` against column nullability at IR time and report it as a build diagnostic.',
          'Implement the diff ops and their `emitDown`, and make SQLite refuse loudly.',
          'Handle ordering in `emitUp`: a table referencing another must be created after it, or the FK fails. If the emitter does not topologically sort tables today, that is part of this slice — and a cycle must be reported, not looped on.',
        ],
        tests: [
          'All tests from the tests-freeze slice go green.',
          '`orders CREATE TABLE so a referencing table comes second`.',
          '`reports a cycle in table references instead of hanging`.',
          '`keeps constraint names within the dialect identifier limit and distinct` — two long table names.',
        ],
        dod: [
          'Actions emitted and diffed in all three dialects; refusals explicit; names deterministic and length-safe.',
          'Table creation topologically ordered with cycle detection.',
          '`npx vitest run` green.',
        ],
      },
      {
        key: 'docs',
        title: '[Docs] cascading — the database does it, and we say so',
        labels: ['documentation'],
        docs: true,
        blockedBy: ['ddl'],
        goal: 'Flip `cascading` to supported and write it as a database-level feature, including the dialect differences and the explicit statement that zmdb does not emulate cascades in application code.',
        files: [
          '`docs-site/pages.mjs`, `docs-site/content/cascading.md`',
          '`docs-site/content/anti-patterns.md` — application-level cascade emulation belongs in the argued-against list.',
          '`tests/api-coverage/mapping.mjs`',
        ],
        steps: [
          'Write the page with the emitted DDL per dialect and per action.',
          'Document the SQLite pragma decision prominently — a reader whose cascades do nothing will land on this page.',
          'Document `SET DEFAULT` on MySQL, the supporting index, and the `SET NULL`/`NOT NULL` build error.',
          'Add the application-level-cascade argument to the anti-patterns page, since that is the thing readers will ask for next.',
          'Re-point the upstream cascade suites; refresh README counts.',
        ],
        tests: ['`node docs-site/build.mjs`, `yarn verify:docs-coverage`, `yarn verify:api-coverage` green.'],
        dod: ['Page supported with per-dialect DDL and every caveat; anti-patterns page updated; suites re-pointed.'],
      },
    ],
  },

  {
    key: 'streaming',
    title: '[EPIC] Streaming reads and query cancellation',
    labels: ['enhancement', 'area:query', 'parity:drizzle', 'parity:kysely'],
    pages: ['streaming', 'query-cancellation'],
    packages: ['@zmdb/repository', '@zmdb/query-compiler'],
    motivation: `
\`Driver.execute\` returns \`Promise<readonly Record<string, unknown>[]>\` (packages/repository/src/index.ts:51).
The whole result set is an array, in memory, before the caller sees the first row — and there is no
way to say "stop".

Both halves of that signature are load-bearing gaps. A million-row export has to be paged by hand
with \`LIMIT\`/\`OFFSET\`, which re-runs the query per page and is quadratic on a large table. And a
report query that a client abandoned keeps running to completion, holding a connection, because
nothing in the interface can carry an \`AbortSignal\` to the server's \`pg_cancel_backend\`.

This is a driver-interface epic. That makes it small in surface and wide in blast radius: the
interface is public, drivers are third-party, and the change has to be additive enough that a driver
that does not implement streaming still works.
`,
    dod: [
      '`Driver` gains an optional streaming method; a driver without it still satisfies the interface and streaming falls back to a documented behaviour rather than a crash.',
      '`repository.stream(where, opts)` returns an `AsyncIterable` that yields validated entities and holds bounded memory over a result set larger than memory.',
      'Every read accepts an `AbortSignal`; aborting rejects the pending promise and asks the driver to cancel the server-side query, not just the client wait.',
      'The bundled Postgres and sqlite drivers implement both, using real cursors (`node-postgres` cursor / `DECLARE`) and `node:sqlite` stepping.',
      'Backpressure is real: a slow consumer does not accumulate rows without bound, proven by a test that measures.',
      'Both pages flip to supported and document the fallback and the per-dialect cancellation semantics.',
    ],
    invariants: [
      '§1 cost model: validation per streamed row uses the same AOT validator as `find`. No per-row schema lookup, no re-derivation.',
      '§2.6 no over-abstraction: the streaming method is one optional method on `Driver`, not a stream abstraction layer with adapters.',
      '§2.3 validation at the boundary: streamed rows are validated like any other read result. A stream is not a validation escape hatch.',
      'The public `Driver` interface is a contract: adding a *required* method breaks every third-party driver, so this must be optional with a documented fallback.',
    ],
    subs: [
      {
        key: 'spec',
        title: '[Spec Freeze] the streaming and cancellation contract on Driver',
        labels: ['spec'],
        goal: 'Freeze the `Driver` extension, the iteration contract (backpressure, early exit, cleanup), the cancellation semantics per dialect, and the fallback for a driver that implements neither.',
        why: 'This is the only epic in the roadmap that changes a public interface third parties implement. Getting the shape wrong is not a refactor later — it is a breaking change to every driver. And the cleanup semantics (what happens when a consumer `break`s out of a `for await`) are where streaming implementations leak connections.',
        files: [
          '`packages/repository/SPEC.md` — the `Driver` contract and `stream()`.',
          '`packages/query-compiler/SPEC.md` — anything the compiler must emit differently for a cursor.',
        ],
        api: `
export interface Driver {
  readonly dialect?: Dialect;
  execute(query: CompiledQuery, opts?: ExecuteOptions): Promise<readonly Record<string, unknown>[]>;
  /** Optional. A driver without it falls back per the SPEC. */
  stream?(query: CompiledQuery, opts?: ExecuteOptions): AsyncIterable<Record<string, unknown>>;
}

export interface ExecuteOptions {
  readonly signal?: AbortSignal;
  /** Rows fetched per round trip. The driver may clamp it. */
  readonly batchSize?: number;
}
`,
        steps: [
          'Freeze `ExecuteOptions` as an optional second parameter to `execute`, so cancellation reaches drivers without a new method. Confirm that an existing driver ignoring the parameter is still correct — it is, and the spec should say the signal is then advisory.',
          'Specify iteration cleanup: breaking out of a `for await` must call `return()` on the iterator, which must close the cursor and release the connection. Say what happens if the consumer neither drains nor breaks (a leak the driver cannot detect) and whether an explicit `using`/`Symbol.asyncDispose` form is offered.',
          'Specify the fallback for a driver with no `stream`: either buffer the whole result and yield from it (honest, but silently defeats the point) or throw a message naming the driver. Pick one — buffering with a documented warning is defensible; buffering silently is not.',
          'Specify cancellation per dialect: Postgres can cancel a running query on another connection; MySQL uses `KILL QUERY`; sqlite is synchronous and effectively cannot. Write down what abort does in each case, and be explicit that on sqlite it only prevents further stepping.',
          'Specify whether the compiler needs to change: a cursor over a `SELECT` needs no new SQL in `node-postgres`, but a `DECLARE ... CURSOR` approach needs an explicit transaction. Say which the bundled driver uses.',
          "Specify transaction interaction: a stream inside a transaction must use that transaction's connection, and a stream that outlives its transaction is an error.",
        ],
        tests: ['None — spec only.', '`yarn validate:spec` green.'],
        dod: [
          'Driver extension, iteration cleanup, no-stream fallback, per-dialect cancellation and transaction interaction all frozen.',
        ],
      },
      {
        key: 'tests',
        title: '[Tests Freeze] streaming and cancellation — bounded memory, real cleanup, real abort',
        labels: ['spec'],
        blockedBy: ['spec'],
        goal: 'Land failing tests that would actually catch a fake implementation: bounded memory over a large result, cursor closed on early break, abort that stops the server-side work, and validation still running per row.',
        why: 'A streaming implementation that buffers internally passes every naive test. The tests here are chosen to fail against that implementation: memory measurement, round-trip counting, and a cleanup assertion on early exit.',
        files: [
          '`packages/repository/src/streaming/streaming.spec.ts` (new)',
          '`packages/repository/src/sqlite-e2e.spec.ts` — real streaming over real rows.',
          '`packages/repository/src/fakes.ts` (or the existing fake driver) — a recording fake that counts round trips.',
        ],
        tests: [
          '`streams in batches rather than one round trip` — a recording fake asserting round-trip count for 1000 rows at `batchSize: 100`.',
          '`holds bounded memory over a result set larger than the batch size` — measure with `process.memoryUsage().heapUsed` against a generous threshold; the point is to fail for a full buffer, not to be precise.',
          '`closes the cursor when the consumer breaks early` — the fake records `return()`/close.',
          '`validates every streamed row with the same validator as find` — a row that fails validation surfaces the same error type.',
          '`rejects a pending read when its signal aborts`.',
          '`asks the driver to cancel the server-side query on abort` — the fake records the cancel call.',
          '`buffers with a warning when the driver has no stream method` — or asserts the throw, per the spec.',
          '`streams real rows from node:sqlite` — E2E, asserting order and count.',
          '`refuses to stream outside the transaction that owns the connection`.',
        ],
        steps: [
          "Extend the fake driver to record round trips, batch sizes, cancel calls and iterator cleanup. Most of these tests are assertions about the fake's log, which is the only way to prove a round-trip property without a real server.",
          'Keep the memory test robust: run enough rows that a full buffer is unambiguous, use a wide threshold, and note in a comment why the threshold is wide rather than tight.',
        ],
        dod: [
          'Every test would fail against a buffering implementation; the fake driver records what the assertions need.',
        ],
      },
      {
        key: 'iface',
        title: 'Driver interface, repository.stream and AbortSignal plumbing',
        labels: ['enhancement'],
        blockedBy: ['tests'],
        goal: 'Add `ExecuteOptions` and the optional `stream` to `Driver`, implement `repository.stream()` with per-row validation and correct cleanup, and thread `signal` through every read method.',
        files: [
          '`packages/repository/src/index.ts` — `Driver`, `ExecuteOptions`, `stream()`, every read signature.',
          '`packages/repository/src/streaming/index.ts` (new) — the iteration wrapper and cleanup.',
          '`packages/repository/SPEC.md`',
        ],
        api: `
class BaseRepository<T> {
  stream(where?: WhereDTO<T>, opts?: StreamOptions<T>): AsyncIterable<Entity<T>> & AsyncDisposable;
}
interface StreamOptions<T> extends ExecuteOptions {
  readonly order?: OrderByDTO<T>;
  readonly select?: ProjectionOf<T>;
}
`,
        steps: [
          'Add the optional `stream` and the `opts` parameter without breaking existing drivers — verify by compiling a driver that implements only the old shape, as a type-test.',
          'Implement the wrapper as an async generator that validates each row, and put the cursor close in a `finally` so an early `break`, a `throw` inside the loop, and an abort all clean up through one path.',
          'Implement `Symbol.asyncDispose` so `await using rows = repo.stream()` works, and document it as the recommended form.',
          "Thread `signal` through `find`/`findById`/`list`/`count`/aggregations, checking it before compiling and passing it to the driver. Reject with the standard `AbortError` shape (`name === 'AbortError'`) so callers can branch on it.",
          'Implement the no-stream fallback per the spec, with the warning emitted once per driver rather than per call.',
          'Keep per-row validation at AOT cost: resolve the validator once before iterating, not per row.',
        ],
        tests: [
          'The repository-level streaming tests go green.',
          '`compiles a driver that implements only execute` — type-test proving the additive change.',
          '`cleans up through one path for break, throw and abort` — three cases, same assertion.',
          '`warns once per driver about the streaming fallback`.',
        ],
        dod: [
          'Interface change additive and type-tested against an old-shape driver.',
          'Cleanup through a single `finally`; `asyncDispose` supported.',
          '`signal` accepted by every read method and rejecting with `AbortError`.',
        ],
      },
      {
        key: 'drivers',
        title: 'Real cursors and real cancellation in the bundled drivers',
        labels: ['enhancement'],
        blockedBy: ['iface'],
        goal: 'Implement `stream` and cancellation in the bundled Postgres and sqlite drivers so the feature is real rather than an interface.',
        why: 'An optional method nothing implements is documentation. Postgres is where the value is (real cursors, real `pg_cancel_backend`) and sqlite is where the tests can be honest without a server.',
        files: [
          '`packages/repository/src/drivers/postgres.ts`',
          '`packages/repository/src/drivers/sqlite.ts`',
          '`packages/repository/src/drivers/mysql.ts` if bundled.',
        ],
        steps: [
          'Postgres: stream with a cursor, fetching `batchSize` rows per round trip, and release the client in `finally`. Do not hold a client across an abandoned iterator — that is the pool exhaustion this feature would otherwise introduce.',
          'Postgres cancellation: on abort, issue the cancel request on a separate connection (the protocol-level cancel, which `pg` exposes) rather than only rejecting locally. Note in a comment that a local reject leaves the server working, because that is the bug this line prevents.',
          'sqlite: step the statement inside a generator, respecting `batchSize` as a yield granularity, and finalise the statement in `finally`. Abort can only stop further stepping; say so in a comment and in the docs.',
          'MySQL, if bundled: streaming query plus `KILL QUERY` on abort, using a second connection.',
          'Add a pool-safety test: iterate and abandon N streams and assert the pool is not exhausted.',
        ],
        tests: [
          '`streams real rows from node:sqlite` and the round-trip/memory tests go green against the real drivers.',
          '`releases the connection when an iterator is abandoned` — pool count before and after.',
          "`cancels the server-side query on abort` — against real Postgres if the benchmark harness's podman Postgres is available; otherwise a recording double, with the gap noted honestly in the test comment.",
        ],
        dod: [
          'Postgres and sqlite drivers stream with real cursors and clean up in `finally`.',
          "Cancellation reaches the server on Postgres; sqlite's limitation documented in code and docs.",
          'Pool safety proven by test.',
        ],
      },
      {
        key: 'docs',
        title: '[Docs] streaming and query cancellation',
        labels: ['documentation'],
        docs: true,
        blockedBy: ['iface', 'drivers'],
        goal: 'Flip both pages to supported, document the `await using` form, the per-dialect cancellation truth, and what a third-party driver must implement.',
        files: [
          '`docs-site/pages.mjs`, `docs-site/content/streaming.md`, `docs-site/content/query-cancellation.md`',
          '`docs-site/content/custom-driver.md` (or the driver page) — the new optional method.',
          '`tests/api-coverage/mapping.mjs`',
        ],
        steps: [
          'Show the `await using` form first and explain why it matters: an abandoned iterator holds a connection.',
          'Document cancellation per dialect without softening the sqlite case.',
          'Update the driver-authoring page with `stream` and `ExecuteOptions`, and state that both are optional and what the fallback costs.',
          'Re-point the upstream streaming suites; refresh README counts.',
        ],
        tests: ['`node docs-site/build.mjs`, `yarn verify:docs-coverage`, `yarn verify:api-coverage` green.'],
        dod: ['Both pages supported; `await using` documented; per-dialect cancellation honest; driver page updated.'],
      },
    ],
  },

  {
    key: 'cache',
    title: '[EPIC] Dataloaders and the result cache',
    labels: ['enhancement', 'area:query', 'perf', 'parity:mikro-orm'],
    pages: ['dataloaders', 'caching'],
    packages: ['@zmdb/repository', '@zmdb/schema-core'],
    motivation: `
Populate already batches: a to-many relation is one second query, not one per parent. What is missing
is batching across *call sites* — the N+1 that happens when a GraphQL resolver or a loop calls
\`findById\` a hundred times with a hundred ids. Each is a round trip, and nothing coalesces them.

The second half is a result cache with an explicit invalidation story. zmdb deliberately has no
identity map (it is on the anti-patterns page, and for good reasons: a per-request object graph with
implicit write-through is exactly the runtime machinery this project rejects). That makes an explicit,
opt-in, TTL-or-tag-invalidated cache the honest version of the same idea — and it has to stay
explicit, or it becomes the identity map through the back door.

The risk in this epic is not implementation difficulty. It is scope: a cache that is on by default,
or that invalidates by guessing, would silently serve stale data — and the argued-against identity map
would be back with worse ergonomics.
`,
    dod: [
      'A dataloader coalesces `findById` calls made in the same tick into one `WHERE id IN (...)`, preserving per-call results and errors.',
      "The loader is request-scoped by construction — there is no process-global loader that could leak one request's rows into another.",
      'A result cache is opt-in per call or per repository, with TTL, an explicit key, and a documented invalidation API.',
      'Writes through the repository invalidate by tag, and the rule for what a write invalidates is explicit rather than inferred.',
      'A pluggable store interface with an in-memory default; nothing in the core depends on Redis.',
      'Both pages flip to supported, and the caching page states the identity-map boundary plainly.',
    ],
    invariants: [
      '§2.7 no hidden state: nothing is cached unless the caller asked. A default-on cache is rejected.',
      'The anti-patterns page is binding: this epic must not reintroduce an identity map or a unit of work. If a slice starts to look like one, that is a spec conversation.',
      '§1 cost model: a cache miss must cost no more than the uncached path did. Key construction on the hot path is a real cost and must be measured.',
      '§2.3 validation at the boundary: a cached row is still a row from outside the program. Decide whether it is re-validated on read and justify it.',
    ],
    subs: [
      {
        key: 'spec',
        title: '[Spec Freeze] dataloader scoping and cache invalidation, without an identity map',
        labels: ['spec'],
        goal: "Freeze the loader's batching window and scoping, the cache key, the invalidation rule, the store interface, and the explicit boundary that keeps this from becoming an identity map.",
        why: 'Every part of this feature has a convenient version that is wrong. A global loader is convenient and leaks across requests. Inferred invalidation is convenient and serves stale data. Caching entities by primary key with write-through is convenient and *is* an identity map. The spec exists to say no to each in writing, with the reason, so a later reader does not re-add them as improvements.',
        files: [
          '`packages/repository/SPEC.md` — loaders and cache.',
          '`docs-site/content/anti-patterns.md` — sharpen the identity-map entry to name the boundary this epic respects.',
        ],
        api: `
export interface CacheStore {
  get(key: string): Promise<unknown | undefined>;
  set(key: string, value: unknown, ttlMs: number, tags: readonly string[]): Promise<void>;
  invalidateTags(tags: readonly string[]): Promise<void>;
}

export interface LoaderScope {
  /** One per request. Constructing it is the only way to get batching. */
  loaderFor<T>(repo: BaseRepository<T>): { load(id: PrimaryKeyOf<T>): Promise<Entity<T> | undefined> };
}

interface ReadOptions {
  readonly cache?: { readonly ttlMs: number; readonly tags?: readonly string[] } | false;
}
`,
        steps: [
          'Specify the batching window precisely: a microtask tick, so calls made synchronously (and in the same promise chain flush) coalesce. State that a longer window trades latency for batching and is not offered.',
          'Specify scoping: a loader is created from a per-request scope object and holds its own map. Write down why a module-level loader is refused — cross-request row leakage, which is a security bug, not a performance choice.',
          'Specify result semantics: `load` for a missing id resolves `undefined` (not a rejection), a driver error rejects every call in the batch, and duplicate ids in one batch produce one row fetched and two resolutions of the same value. Say whether that value is the same object (it is, and callers must not mutate it — so state it).',
          "Specify the cache key: dialect + table + compiled SQL + parameters, hashed. Note that including the compiled SQL is what makes two different queries with the same params distinct, and that the params must be serialised in a way that distinguishes `1` from `'1'`.",
          'Specify invalidation as explicit tags. Write down that automatic invalidation from a write is offered only at table granularity (a write to `users` invalidates the `table:users` tag) and that anything finer requires caller tags — because inferring which cached queries a row affects requires understanding the WHERE clauses, which is a query planner.',
          "Specify whether a cached value is re-validated on read. Prefer yes for a shared store (Redis is another process's output) and no for the in-memory default, and justify the asymmetry — or pick one rule and eat the cost.",
          'Write the identity-map boundary: no object identity guarantees across calls, no dirty tracking, no automatic write-through. Put it in the SPEC *and* on the anti-patterns page.',
        ],
        tests: ['None — spec only.', '`yarn validate:spec` green.'],
        dod: [
          'Batching window, scoping rationale, result semantics, key construction, invalidation granularity, re-validation rule and the identity-map boundary all frozen in prose.',
        ],
      },
      {
        key: 'tests',
        title: '[Tests Freeze] loaders and cache — coalescing, leakage, staleness',
        labels: ['spec'],
        blockedBy: ['spec'],
        goal: 'Land failing tests for coalescing, per-request isolation, error propagation, cache hits/misses, TTL expiry and tag invalidation — including the tests that would catch a cross-request leak.',
        files: [
          '`packages/repository/src/loaders/loaders.spec.ts` (new)',
          '`packages/repository/src/cache/cache.spec.ts` (new)',
          '`packages/repository/src/sqlite-e2e.spec.ts`',
        ],
        tests: [
          '`coalesces findById calls in one tick into a single IN query` — recording fake asserting one round trip for 100 ids.',
          '`resolves undefined for an id the batch did not return`.',
          '`rejects every call in a batch when the driver errors`.',
          '`fetches a duplicated id once and resolves both callers`.',
          '`does not share loaded rows between two scopes` — the leakage test: two scopes, same id, two round trips.',
          '`does not batch across ticks` — the window boundary, asserted rather than assumed.',
          '`serves a second identical query from the cache` — one round trip for two calls.',
          "`treats a differently-typed parameter as a different key` — `1` vs `'1'`.",
          '`expires a cached result after its TTL`.',
          '`invalidates by tag on a write to the table`.',
          '`does not cache anything when no cache option is given` — the default-off guarantee.',
          '`re-validates a value from a shared store` — per the spec decision.',
        ],
        steps: [
          'Use the recording fake driver for round-trip counts; that is the only way to assert coalescing without timing.',
          'Write the leakage test first and make sure it fails for the right reason against a module-global implementation — it is the test that encodes the security argument in the spec.',
          'Add an explicit test that the default path allocates no cache key: assert via a counting store that `get` was never called when `cache` is absent.',
        ],
        dod: ['Coalescing, isolation, error, TTL, tag and default-off behaviours all have named failing tests.'],
      },
      {
        key: 'loaders',
        title: 'Request-scoped dataloaders over findById and relations',
        labels: ['enhancement'],
        blockedBy: ['tests'],
        goal: 'Implement the loader with a microtask batching window, per-scope maps, and correct error and duplicate semantics — plus a relation loader so a populate driven from many parents coalesces too.',
        files: [
          '`packages/repository/src/loaders/index.ts` (new)',
          '`packages/repository/src/index.ts` — a `findMany`-by-key path the loader uses.',
          '`packages/web/src/state/index.ts` or the request-scope mechanism, if the web package should own the per-request scope.',
        ],
        api: `
export function createLoaderScope(): LoaderScope;
export interface LoaderScope {
  loaderFor<T extends DeclaredTable>(repo: BaseRepository<T>): EntityLoader<T>;
  relationLoader<T extends DeclaredTable>(repo: BaseRepository<T>, relation: RelationNameOf<T>): RelationLoader<T>;
}
`,
        steps: [
          'Batch with `queueMicrotask`, collecting keys into an array and a map of pending resolvers. Flush once; do not re-enter.',
          'Build the batch query through the composite-key-aware key where-builder, so a composite key batches as a tuple `IN` where the dialect allows and falls back to `OR` groups where it does not.',
          'Return the same object for duplicate ids and document the no-mutation rule in the API docs — this is the closest this epic comes to the identity map, and the difference is exactly that it is scoped and read-only.',
          'Propagate a driver error to every pending caller in the batch, and make sure one rejection does not leave other resolvers pending forever.',
          'Cap batch size: 10,000 ids in one `IN` will hit parameter limits (Postgres allows 65,535 parameters, sqlite defaults to 999). Chunk, and derive the limit per dialect rather than hard-coding one.',
          'Implement the relation loader on the same machinery so `populate` from many parents coalesces.',
          'Do not add a global scope, a default scope, or an ambient one. The absence is the feature.',
        ],
        tests: [
          'All loader tests go green.',
          '`chunks a batch that would exceed the dialect parameter limit` — 1500 ids on sqlite.',
          '`batches a composite key as a tuple IN where supported and OR groups where not`.',
          '`coalesces a relation populate across parents`.',
        ],
        dod: [
          'Microtask batching, per-scope isolation, duplicate and error semantics all implemented and tested.',
          'Parameter limits respected per dialect.',
          'No global or ambient scope exists.',
        ],
      },
      {
        key: 'result-cache',
        title: 'Opt-in result cache with tag invalidation and a pluggable store',
        labels: ['enhancement'],
        blockedBy: ['tests'],
        goal: 'Implement the cache: explicit per-call opt-in, deterministic keys, TTL, tag invalidation on write, an in-memory default store and a documented interface for a shared one.',
        files: [
          '`packages/repository/src/cache/index.ts` (new) — `CacheStore`, `memoryStore`, key construction.',
          '`packages/repository/src/index.ts` — read/write integration.',
          '`packages/repository/SPEC.md`',
        ],
        api: `
export interface CacheStore { /* as frozen in the spec */ }
export function memoryStore(opts?: { readonly maxEntries?: number }): CacheStore;
`,
        steps: [
          "Construct the key from dialect + SQL + serialised params, hashed with `node:crypto`. Serialise params type-distinctly (a tagged serialisation, so `1` and `'1'` differ) and make it stable for objects by sorting keys.",
          'Do the work only when `cache` is present: no key construction, no store call, nothing on the default path. Prove it with the counting-store test, and record a benchmark showing no regression.',
          'Bound the in-memory store: an unbounded map is a memory leak with a TTL sticker on it. LRU with `maxEntries`, defaulted, documented.',
          'Invalidate at table granularity on write, and allow caller tags for anything finer. Do not attempt to infer which cached queries a row affects.',
          'Handle a store failure by falling through to the database and reporting, not by failing the read — a cache outage should degrade, not break. Log once, not per call.',
          'Decide re-validation per the spec and implement it, including the cost note in the docs.',
        ],
        tests: [
          'All cache tests go green.',
          '`does no store work when the cache option is absent` — counting store.',
          '`evicts by LRU at maxEntries`.',
          '`falls through to the database when the store throws, and reports once`.',
        ],
        dod: [
          'Opt-in only; deterministic type-distinct keys; bounded default store; tag invalidation; graceful store failure.',
          'Benchmark parity on the uncached path recorded in the PR.',
        ],
      },
      {
        key: 'docs',
        title: '[Docs] dataloaders and caching — with the identity-map boundary stated',
        labels: ['documentation'],
        docs: true,
        blockedBy: ['loaders', 'result-cache'],
        goal: 'Flip both pages to supported, show the per-request wiring, and state plainly where this stops and why an identity map is still refused.',
        files: [
          '`docs-site/pages.mjs`, `docs-site/content/dataloaders.md`, `docs-site/content/caching.md`',
          '`docs-site/content/anti-patterns.md` — the identity-map entry now has a neighbour it must be distinguished from.',
          '`tests/api-coverage/mapping.mjs`',
        ],
        steps: [
          'Show the request-scoped wiring end to end, including a GraphQL-resolver-shaped example since that is the canonical N+1.',
          'Document the no-mutation rule for a loaded row, and the batching window.',
          'Write the caching page around invalidation, not around hits: the honest question is what goes stale and when.',
          'Update the anti-patterns page to distinguish "scoped read-only loader" from "identity map", because a reader who finds both pages deserves the distinction spelled out.',
          'Re-point the upstream caching/loader suites; refresh README counts.',
        ],
        tests: ['`node docs-site/build.mjs`, `yarn verify:docs-coverage`, `yarn verify:api-coverage` green.'],
        dod: [
          'Both pages supported; scoped wiring and invalidation documented; anti-patterns page distinguishes the two.',
        ],
      },
    ],
  },
];
