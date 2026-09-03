// Reach: more SQL dialects, non-SQL targets, and the React Native build path. The first is
// incremental work against an existing seam; the second questions whether the seam is in the right
// place; the third is a bundler integration with a migration problem attached.

export const DIALECT_EPICS = [
  {
    key: 'sqlmatrix',
    title: '[EPIC] The SQL dialect matrix — SQL Server, CockroachDB and SingleStore',
    labels: ['enhancement', 'area:dialects'],
    pages: ['dialect-mssql', 'dialect-cockroach', 'dialect-singlestore'],
    packages: ['@zmdb/query-compiler', '@zmdb/repository'],
    motivation: `
\`Dialect\` is \`'postgres' | 'mysql' | 'sqlite'\` (packages/query-compiler/src/index.ts:11). Three
docs pages describe databases outside that union, and they describe two different kinds of gap.

SQL Server is a genuine third dialect: \`@p1\` placeholders instead of \`$1\` or \`?\`, \`[brackets]\`
instead of quotes or backticks, \`OFFSET ... FETCH NEXT\` instead of \`LIMIT\`, \`NVARCHAR\`/\`BIT\`/
\`DATETIME2\` instead of the types we map, \`OUTPUT\` instead of \`RETURNING\`, and \`MERGE\` instead of
\`ON CONFLICT\`. Every one of those is a place the compiler currently switches on a three-member union.

Cockroach and SingleStore are the opposite shape, and their page notes say so: the Postgres and MySQL
dialects respectively already work over the wire, and what is unhandled is the DDL and type
divergence. Cockroach has no \`SERIAL\` worth using (it wants \`UUID\` defaults or \`unique_rowid()\`),
different index syntax, and no support for some Postgres constructs; SingleStore needs columnstore
table options MySQL does not have.

So the epic has a decision at its centre: is a dialect a flat union member, or does it have a parent
whose behaviour it overrides? Adding \`'cockroach'\` as a flat member means duplicating every Postgres
branch. The alternative — a base dialect with overrides — is the more invasive change and the one that
makes the next dialect cheap. That decision, not the SQL trivia, is what makes this an epic.
`,
    dod: [
      'The dialect mechanism supports a dialect that inherits from another and overrides specific behaviours, or the flat union is retained with a written justification of the duplication cost.',
      'SQL Server is supported across placeholders, quoting, pagination, types, `OUTPUT`/`MERGE`, DDL and migrations, with golden SQL for every construct the other dialects have.',
      'CockroachDB and SingleStore are dialect values whose divergences from their parents are implemented, not inherited by accident.',
      'The dialect-specific test matrix runs every existing golden-SQL test against the new dialects, so a construct cannot be silently unimplemented.',
      'A construct a dialect genuinely does not support is refused with a message naming the dialect, never emitted as SQL that fails at the server.',
      'All three pages flip to supported with the per-dialect divergences documented.',
    ],
    invariants: [
      "§2.4 explicit SQL: every dialect divergence is an explicit branch with a golden test, not a string transformation applied to another dialect's output. Rewriting Postgres SQL into SQL Server SQL by regex is the failure mode to avoid at all costs.",
      '§1 cost model: dialect dispatch happens at compile time. If a base-plus-overrides design introduces a per-statement lookup, it has to be resolved once when the compiler is constructed.',
      '§2.9 one front-end: the type mapping tables stay exhaustively checked. A new dialect must fail to compile until it maps every `SqlType`, which is the property that makes this safe.',
      'A partially implemented dialect is worse than an absent one: it type-checks and then produces wrong SQL. The test matrix requirement in the DoD exists to make partial support impossible to ship quietly.',
    ],
    subs: [
      {
        key: 'spec',
        title: '[Spec Freeze] the dialect mechanism, and every divergence for three databases',
        labels: ['spec'],
        goal: 'Decide whether dialects gain inheritance, and freeze the complete divergence list for SQL Server, CockroachDB and SingleStore — construct by construct, with the SQL written out. No code.',
        why: 'The mechanism decision is architectural and hard to reverse: it touches every `switch (dialect)` in the compiler. The divergence lists are the other half, and they need to be exhaustive before implementation, because the way this feature fails is by covering the common constructs and leaving the fifth one to be discovered by a user.',
        files: [
          '`packages/query-compiler/src/SPEC.md` — the dialect mechanism.',
          '`packages/query-compiler/src/dialects/SPEC.md` (new) — one section per dialect with its divergences.',
        ],
        api: `
export type Dialect = 'postgres' | 'mysql' | 'sqlite' | 'mssql' | 'cockroach' | 'singlestore';

/** If the spec chooses inheritance: */
export interface DialectTraits {
  readonly parent?: Dialect;
  readonly placeholder: (index: number) => string;
  readonly quote: (identifier: string) => string;
  readonly paginate: (limit?: number, offset?: number) => string;
  readonly returning: 'returning' | 'output' | 'none';
  readonly upsert: 'onConflict' | 'onDuplicateKey' | 'merge' | 'none';
  readonly types: Readonly<Record<SqlType, string>>;
}
`,
        steps: [
          'Inventory every `switch (dialect)` and every dialect-keyed table in the compiler, and count them. That number is the cost of the flat approach per new dialect, and it is the input to the mechanism decision.',
          'Decide the mechanism. Recommended framing: a traits record per dialect with an optional parent whose entries are merged once at construction — it keeps dispatch at compile time, keeps the tables exhaustive, and makes Cockroach and SingleStore small. Write down what it costs (a refactor of every existing switch) so the decision is honest.',
          'Write the SQL Server divergence list with the SQL for each: `@pN` placeholders, `[identifier]` quoting with `]]` escaping, `OFFSET n ROWS FETCH NEXT m ROWS ONLY` (which requires an `ORDER BY`, so a paginated query with no order must either add one or be refused — decide), `OUTPUT INSERTED.*` placement, `MERGE` for upsert (with its notorious concurrency caveats — note them), `NVARCHAR(MAX)`/`BIT`/`DATETIME2`/`UNIQUEIDENTIFIER` types, `IDENTITY(1,1)` for serial, and `TOP` versus `FETCH`.',
          'Write the Cockroach divergence list: `SERIAL` semantics and why `UUID DEFAULT gen_random_uuid()` is usually preferred, `PRIMARY KEY` implying an index differently, unsupported Postgres constructs (some `ALTER` forms, some extensions), and the retry-on-serialisation-failure behaviour that a driver or the runner should know about.',
          'Write the SingleStore divergence list: columnstore versus rowstore table options, `SHARD KEY`/`SORT KEY`, unsupported MySQL features, and how a table declaration expresses a shard key (which is new declaration vocabulary — name it).',
          'Specify the refusal mechanism: how a dialect declares a construct unsupported, and how that surfaces (a compile-time error where possible, a clear runtime refusal otherwise).',
          'Specify the test matrix requirement: every existing golden-SQL test runs against every dialect, with an explicit per-dialect expectation or an explicit refusal marker. Say that a missing entry is a test failure, so partial support cannot ship.',
          'Decide what "supported" means for a dialect with no CI database. SQL Server and Cockroach can run in containers; SingleStore is harder. Be explicit about which dialects have real E2E coverage and which have golden-SQL coverage only, and put that honestly on the docs pages.',
        ],
        tests: ['None — spec only.', '`yarn validate:spec` green.'],
        dod: [
          'The switch/table inventory counted, and the mechanism decision made with its refactor cost stated.',
          "Complete divergence lists with SQL for all three databases, including SQL Server's `ORDER BY` requirement and `MERGE` caveats.",
          'Refusal mechanism and the exhaustive test-matrix requirement specified.',
          'Per-dialect testing reality (real E2E versus golden SQL) stated honestly.',
        ],
      },
      {
        key: 'tests',
        title: '[Tests Freeze] the dialect matrix — every construct against every dialect',
        labels: ['spec'],
        blockedBy: ['spec'],
        goal: "Restructure the golden-SQL tests into a matrix over dialects and land the new dialects' expectations as failures, so an unimplemented construct is a red test rather than a gap.",
        why: 'This is the slice that makes the epic honest. Adding a dialect and testing the five constructs someone remembered is how partial support ships. A matrix that requires an expectation or an explicit refusal for every construct in every dialect makes the missing ones visible.',
        files: [
          '`packages/query-compiler/src/dialects/matrix.spec.ts` (new) — the matrix.',
          '`packages/query-compiler/src/query-compiler.spec.ts` — existing tests, refactored or referenced.',
          '`packages/query-compiler/src/migrations/migrations.spec.ts`',
        ],
        tests: [
          '`covers every construct for every dialect` — a meta-test asserting the matrix has an entry (expectation or refusal) for each construct × dialect pair, which fails when a dialect is added without filling it in.',
          '`emits @pN placeholders and bracket-quoted identifiers on mssql`.',
          '`escapes a closing bracket in an mssql identifier` — the quoting edge case.',
          '`paginates with OFFSET/FETCH on mssql` and `refuses or adds an ORDER BY for a paginated query without one` — per the spec.',
          '`emits OUTPUT INSERTED for a returning insert on mssql`.',
          '`emits MERGE for an upsert on mssql`.',
          '`maps every SqlType to an mssql type` — exhaustiveness, as a type-test plus a runtime assertion.',
          '`emits IDENTITY(1,1) for a serial column on mssql`.',
          '`prefers a uuid default over serial on cockroach` — per the spec decision.',
          '`emits a shard key on singlestore` and `emits a columnstore table option`.',
          '`inherits postgres behaviour on cockroach where it does not diverge` — asserted rather than assumed, for a construct chosen to prove inheritance works.',
          '`refuses an unsupported construct with a message naming the dialect` — one per dialect.',
        ],
        steps: [
          'Build the matrix as data: a list of constructs, each with a builder and a per-dialect expected string or a refusal marker. The meta-test then walks it.',
          'Port the existing golden tests into the matrix where they are per-dialect, and leave genuinely dialect-independent tests where they are — the goal is coverage visibility, not a rewrite for its own sake.',
          'Write the mssql bracket-escaping test explicitly; it is a small injection-adjacent hazard that a naive quoter gets wrong.',
        ],
        dod: [
          'The matrix exists as data with a meta-test enforcing completeness.',
          'Every new dialect has an entry or an explicit refusal for every construct.',
          'Existing golden coverage preserved.',
        ],
      },
      {
        key: 'mechanism',
        title: 'The dialect mechanism: traits, inheritance and exhaustiveness',
        labels: ['enhancement'],
        blockedBy: ['tests'],
        goal: 'Implement the mechanism the spec chose, refactoring the existing three dialects onto it with byte-identical output, before any new dialect is added.',
        why: 'Refactoring first, with the existing dialects\' output proven unchanged, separates "the mechanism works" from "the new dialect is right". Doing both at once means any difference in Postgres output is ambiguous between a refactor bug and an intended change.',
        files: [
          '`packages/query-compiler/src/dialects/index.ts` (new) — traits, resolution, the registry.',
          '`packages/query-compiler/src/index.ts` — every `switch (dialect)`.',
          '`packages/query-compiler/src/migrations/index.ts` — `DDL_TYPES`, `ddlType`.',
          '`packages/query-compiler/src/quoting.ts`',
        ],
        steps: [
          'Define the traits record and resolve parent merging once, at construction, so no per-statement lookup is introduced. Assert that in a test if the compiler has a construction step; if it does not, this is the moment to add one rather than resolving traits per call.',
          "Move each existing dialect's behaviour into its traits record and delete the switches. Keep the type tables exhaustive with `satisfies Record<SqlType, string>` so a dialect missing a type is a compile error.",
          'Prove no behaviour changed: run the full golden-SQL suite and diff nothing. If a single string changes, stop and explain why before proceeding.',
          'Support "unsupported" as a first-class trait value so a dialect can declare a construct refused, and make the refusal path produce the specified message.',
          'Check `yarn verify:instantiations` — a traits record keyed by dialect with generic merging can move instantiation counts sharply.',
        ],
        tests: [
          'The whole existing suite passes with no changed expectations — that is the assertion.',
          '`resolves dialect traits once rather than per statement`.',
          '`fails to compile a dialect missing a type mapping` — type-level.',
        ],
        dod: [
          'Mechanism implemented; the three existing dialects produce byte-identical SQL.',
          'Exhaustiveness enforced at the type level; refusals first-class.',
          'No per-statement trait resolution; instantiation budget respected.',
        ],
      },
      {
        key: 'mssql',
        title: 'SQL Server',
        labels: ['enhancement'],
        blockedBy: ['mechanism'],
        goal: 'Implement the mssql dialect completely: placeholders, quoting, pagination, types, `OUTPUT`, `MERGE`, DDL and migrations, filling every matrix cell.',
        files: [
          '`packages/query-compiler/src/dialects/mssql.ts` (new)',
          '`packages/query-compiler/src/migrations/index.ts` — mssql DDL branches.',
          '`packages/repository/src/drivers/mssql.ts` (new, if a bundled driver is in scope).',
        ],
        steps: [
          'Implement placeholders as `@p1`-style named parameters, and make sure the parameter *array* the driver receives matches the naming convention the driver expects — this differs from positional drivers and is the most likely integration bug.',
          'Implement bracket quoting with `]` doubling.',
          'Implement pagination, handling the `ORDER BY` requirement the way the spec chose, and make the refusal (if that is the choice) a compile-time error where the query shape is known.',
          'Implement `OUTPUT INSERTED.*` for insert/update/delete returning, and note in a comment the interaction with triggers (SQL Server refuses `OUTPUT` into a table with triggers in some configurations) so the limitation is discoverable.',
          'Implement upsert as `MERGE`, and document the concurrency caveat prominently — `MERGE` is not atomic against concurrent inserts without appropriate locking hints, and shipping it silently would be shipping a race.',
          'Implement the type mapping including `NVARCHAR(MAX)`, `BIT`, `DATETIME2` (with the timestamp rule: `Date` in Node, `DATETIME2` in the column, ISO string in OpenAPI) and `UNIQUEIDENTIFIER`.',
          'Implement `IDENTITY(1,1)` for serial, plus the DDL for keys, indexes and foreign keys with actions.',
          'Fill every matrix cell, including refusals for anything genuinely unsupported.',
          'Add a real E2E suite against a containerised SQL Server if one can be run in CI, gated and loud when skipped — following the same honesty pattern the benchmark suite uses for DNF cases.',
        ],
        tests: [
          'Every mssql matrix cell green.',
          '`escapes a closing bracket in an mssql identifier`.',
          '`emits MERGE for an upsert on mssql` with the locking hint the docs will describe.',
          'Real E2E against a container if available, with a visible skip otherwise.',
        ],
        dod: [
          'Every matrix cell filled with an expectation or a documented refusal.',
          '`MERGE` concurrency caveat documented in code and slated for the docs page.',
          'Timestamp handling follows the project rule.',
        ],
      },
      {
        key: 'variants',
        title: 'CockroachDB and SingleStore as dialect variants',
        labels: ['enhancement'],
        blockedBy: ['mechanism'],
        goal: "Add both as dialects inheriting from Postgres and MySQL respectively, implementing only their real divergences — including the new declaration vocabulary SingleStore's shard key needs.",
        why: 'These two are the test of whether the mechanism earned its refactor. If either requires more than a short traits override plus a DDL branch, the mechanism is wrong and that is worth knowing now.',
        files: [
          '`packages/query-compiler/src/dialects/cockroach.ts`, `singlestore.ts` (new)',
          '`packages/schema-core/src/tags/index.ts` — a shard-key tag, if that is the chosen form.',
        ],
        steps: [
          'Cockroach: override the serial strategy per the spec (UUID default preferred), the index syntax where it differs, and mark the Postgres constructs Cockroach refuses as unsupported rather than emitting them.',
          'Cockroach: handle serialisation-failure retries. This is a real operational difference — Cockroach expects clients to retry a transaction that fails with a retry error. Decide whether the runner/repository retries automatically (and how many times, with what backoff) or documents it, and implement the decision. Automatic retry of a transaction whose body has side effects outside the database would be wrong, so be careful and say why.',
          'SingleStore: implement columnstore/rowstore table options and `SHARD KEY`/`SORT KEY`, which requires a way for a declaration to say them — add the tag and carry it through the IR, snapshot and DDL.',
          'For both: assert inherited behaviour explicitly in a test, so a future change to the parent that should not affect the child is caught.',
          'Fill every matrix cell for both.',
        ],
        tests: [
          'Every cockroach and singlestore matrix cell green.',
          '`inherits postgres behaviour on cockroach where it does not diverge`.',
          '`retries a serialisation failure the specified number of times` — or asserts it does not, per the decision.',
          '`emits a shard key and a columnstore option on singlestore`.',
        ],
        dod: [
          'Both dialects implemented as overrides, with inherited behaviour asserted.',
          'Cockroach retry policy implemented and justified; SingleStore shard-key vocabulary shipped.',
        ],
      },
      {
        key: 'docs',
        title: '[Docs] SQL Server, CockroachDB and SingleStore',
        labels: ['documentation'],
        docs: true,
        blockedBy: ['mssql', 'variants'],
        goal: 'Flip all three pages to supported, documenting divergences, refusals, and exactly how each dialect is tested.',
        files: [
          '`docs-site/pages.mjs`',
          'the three content files',
          'the `Dialects` section of `NAV` in `docs-site/pages.mjs` — there is no dialect overview page, the nav section is the index.',
          '`docs-site/content/gotchas.md` — it already enumerates dialects, so it goes stale the moment three more exist.',
        ],
        steps: [
          "Document each dialect's divergences as a table: construct, emitted SQL, caveats.",
          'Document every refusal, so a user hits the documentation before the error.',
          "State the testing reality per dialect — real container E2E, or golden SQL only. The project's benchmark honesty policy is the right model: never let a reader infer more coverage than exists.",
          "Document the `MERGE` concurrency caveat and Cockroach's retry expectation prominently; both are operational surprises.",
          'Refresh README counts and the dialect overview page.',
        ],
        tests: ['`node docs-site/build.mjs`, `yarn verify:docs-coverage` green.'],
        dod: [
          'Three pages supported with divergence tables, documented refusals, and honest per-dialect coverage statements.',
        ],
      },
    ],
  },

  {
    key: 'nonsql',
    title: '[EPIC] Non-SQL targets — MongoDB and Gel',
    labels: ['enhancement', 'area:dialects'],
    pages: ['dialect-mongodb', 'dialect-gel'],
    packages: ['@zmdb/query-compiler', '@zmdb/repository'],
    motivation: `
Both page notes say the same thing in different words: "the compiler emits SQL text; a document store
needs a separate compiler target", and "EdgeQL is not SQL, so it needs a second compiler target".

That is the real finding, and it is worth stating clearly rather than treating these as two more
dialects. \`CompiledQuery\` is SQL text plus parameters. A MongoDB query is a document; an EdgeQL query
is a different language with a different shape for the same operations. Neither can be produced by
adding a member to \`Dialect\`, which is exactly why they sit in a separate epic from the SQL matrix.

The interesting question is how much of zmdb is actually SQL-specific. The declaration, the IR, the
derived types, the validators, the repository surface and the DTO family are not — they are about types
and boundaries. What is SQL-specific is the compiler and the migration emitter. If the seam between
\`Repository\` and \`CompiledQuery\` can be generalised to "a query object the driver understands", then a
document store is reachable and most of the library is reused. If it cannot, that is a finding worth
documenting on both pages instead of a feature.

This epic therefore starts with a genuine feasibility question, and its spec slice is allowed to
conclude that one or both targets should stay unsupported — with the reasoning written down. That is a
legitimate outcome and a better one than a half-working Mongo target.
`,
    dod: [
      'The compiler seam is either generalised so a non-SQL target can produce a query object, or the reason it cannot is documented on both pages with specifics.',
      'If MongoDB proceeds: find/insert/update/delete, filters, sorting, pagination, aggregation for the operations the repository exposes, with the same validation and typing as the SQL path.',
      'If Gel proceeds: the equivalent for EdgeQL, including its schema-definition model, which is not migration DDL.',
      'Anything the target cannot express is refused with a named message — a document store has no joins, and pretending otherwise is worse than refusing.',
      'A real E2E suite per proceeding target, or an honest statement that coverage is unit-level only.',
      'Both pages flip to supported, or stay `todo` with a sharper, evidence-based note.',
    ],
    invariants: [
      '§2.6 no over-abstraction: generalising the seam must not produce a lowest-common-denominator query abstraction that makes the SQL path worse. If the abstraction costs the SQL path anything — expressiveness or performance — it is the wrong abstraction.',
      '§1 cost model applies unchanged: a Mongo query document is built at compile time from the declaration, not assembled per call by walking a schema.',
      '§2.3 validation at the boundary: documents from a store are external data and get validated exactly as rows do.',
      'Honesty over completeness: a target that supports 60% of the repository surface must say which 60%, per method, on its page.',
    ],
    subs: [
      {
        key: 'spec',
        title: '[Spec Freeze] can the compiler seam be generalised? — a feasibility decision with evidence',
        labels: ['spec'],
        goal: `
Answer, with evidence from the code, whether a non-SQL target can be added without degrading the SQL
path — and if so, what the generalised seam looks like. Produce a per-method support matrix for each
target. This slice may legitimately conclude "no" for either target.
`,
        why: `
This is the one place in the roadmap where the honest answer might be to not build the feature, and
the spec is where that gets decided on evidence rather than enthusiasm. A Mongo target that supports
\`find\` and \`create\` but not \`populate\`, joins, transactions across collections, or aggregations is
not a data layer; it is a subset that will be reported as broken. Knowing that before implementation is
worth more than a partial implementation.
`,
        files: [
          '`packages/query-compiler/SPEC.md` — the seam.',
          '`packages/query-compiler/src/targets/SPEC.md` (new) — per-target support matrices.',
        ],
        api: `
/** The generalised seam, if feasible: a target produces whatever its driver executes. */
export interface Target<Q> {
  readonly name: string;
  compileSelect(plan: SelectPlan): Q;
  compileInsert(plan: InsertPlan): Q;
  compileUpdate(plan: UpdatePlan): Q;
  compileDelete(plan: DeletePlan): Q;
}
/** SQL targets set Q = CompiledQuery; a document target sets it to its own command shape. */
`,
        steps: [
          'Inventory what the repository actually asks the compiler for, method by method, and express it as a plan shape independent of SQL. That inventory is the evidence: if the plans are expressible without SQL vocabulary, the seam can move.',
          'For each repository method, decide whether MongoDB can serve it: `find`/`findById`/`create`/`update`/`delete` yes; `populate` becomes `$lookup` with real limitations; joins across collections are `$lookup` only in an aggregation pipeline; transactions require a replica set; `RETURNING` maps to `findOneAndUpdate`. Write the per-method verdict down.',
          "For Gel, do the same against EdgeQL, and note that Gel's schema model is its own SDL with its own migration tooling — so the migration half of zmdb either defers to Gel's tooling or is out of scope. Decide.",
          'Assess the cost to the SQL path explicitly. If generalising means `CompiledQuery` becomes generic and every call site gains a type parameter, say what that does to the type-instantiation budget (`yarn verify:instantiations` has one) and to readability.',
          'Decide per target: proceed, or refuse with documented reasoning. State the criterion used — a reasonable one is "at least the full read/write surface plus a documented story for relations and transactions".',
          'If a target is refused, specify what the docs page says instead: not "unsupported" but the specific reason, so a reader can judge whether their use case is affected.',
          'If a target proceeds, specify the query-object shape, the validation boundary and the refusal list.',
        ],
        tests: ['None — spec only.', '`yarn validate:spec` green.'],
        dod: [
          'Plan-shape inventory produced from the actual repository surface.',
          'Per-method support matrix for both targets.',
          'Explicit cost assessment for the SQL path, including the instantiation budget.',
          'A proceed/refuse decision per target with the criterion stated, and page copy specified either way.',
        ],
      },
      {
        key: 'tests',
        title: '[Tests Freeze] the generalised seam — SQL unchanged, target contract defined',
        labels: ['spec'],
        blockedBy: ['spec'],
        goal: 'Land the tests that pin the seam: the SQL path unchanged byte for byte, a target contract suite any target must satisfy, and the per-method refusals for whatever the proceeding targets cannot do.',
        why: 'The most important test in this epic is that nothing about the SQL path changed. The second most important is a reusable contract suite, so a target is either provably conformant or provably partial — with the partial parts enumerated rather than discovered.',
        files: [
          '`packages/query-compiler/src/targets/contract.spec.ts` (new) — the shared suite.',
          '`packages/query-compiler/src/targets/mongodb.spec.ts`, `gel.spec.ts` (new, per the decision).',
        ],
        tests: [
          '`emits identical SQL for every existing construct after the seam moves` — the whole existing golden suite, unchanged.',
          '`a target satisfies the contract suite or declares each unsupported method` — the meta-test, so partial support is explicit data rather than a missing test.',
          '`compiles a find into a Mongo filter document` — assert the document, including the operator translation for each `WhereDTO` operator.',
          '`compiles pagination into skip and limit`.',
          '`compiles a populate into a $lookup pipeline, with its documented limitations`.',
          '`refuses a cross-collection join outside an aggregation pipeline, naming the target`.',
          '`refuses a transaction when the deployment is not a replica set, with an actionable message`.',
          '`validates documents read from the store` — the boundary.',
          '`compiles a find into EdgeQL` — per-method, if Gel proceeds.',
          "`refuses migration emission for Gel and points at Gel's own tooling` — if that is the decision.",
        ],
        steps: [
          'Write the contract suite as a function taking a target and a driver double, so both targets and the SQL targets run it. A contract suite that only new targets run proves less.',
          'Enumerate refusals as data, so the docs page can be generated from the same list the tests assert — that is the mechanism that keeps the support matrix honest over time.',
        ],
        dod: [
          'Existing SQL golden suite passes unchanged.',
          'A reusable contract suite exists and every target either conforms or declares its gaps as data.',
          'Refusal list is shared between tests and docs.',
        ],
      },
      {
        key: 'seam',
        title: 'Generalise the compiler seam without touching SQL output',
        labels: ['enhancement'],
        blockedBy: ['tests'],
        goal: 'Move the boundary from "compiler produces SQL" to "target produces a query object", with the SQL targets emitting exactly what they emit today.',
        files: [
          '`packages/query-compiler/src/targets/index.ts` (new) — `Target`, the plan shapes.',
          '`packages/query-compiler/src/index.ts` — the SQL target implemented against the seam.',
          '`packages/repository/src/index.ts` — the driver boundary made generic in its query type.',
        ],
        steps: [
          'Introduce the plan shapes and implement the SQL target against them, keeping the existing exported functions as they are so no consumer changes. The seam is internal until a second target needs it public.',
          'Make `Driver` generic in its query type with a default of `CompiledQuery`, so every existing driver and every consumer keeps compiling. Verify with a type-test against an old-shape driver.',
          'Watch the instantiation budget: making the driver generic touches every repository type. Run `yarn verify:instantiations` and treat a large jump as a design signal, not a budget to raise.',
          'Do not add capability negotiation beyond what the refusal list needs. A general capability model is the over-abstraction §2.6 warns about; a per-method "supported or not" list is enough.',
          'Prove the SQL path unchanged by running the full suite with no expectation edits.',
        ],
        tests: [
          '`emits identical SQL for every existing construct after the seam moves`.',
          '`compiles a driver written against the old CompiledQuery shape` — type-test.',
          '`yarn verify:instantiations` within budget.',
        ],
        dod: [
          'Seam moved; SQL output byte-identical; existing drivers still compile.',
          'No capability abstraction beyond the refusal list; instantiation budget respected.',
        ],
      },
      {
        key: 'mongo',
        title: 'The MongoDB target',
        labels: ['enhancement'],
        blockedBy: ['seam'],
        goal: 'Implement the document target for every method the spec said it can serve, with explicit refusals for the rest and validation on the way in and out.',
        files: [
          '`packages/query-compiler/src/targets/mongodb.ts` (new)',
          '`packages/repository/src/drivers/mongodb.ts` (new)',
        ],
        steps: [
          'Translate `WhereDTO` operators to Mongo query operators through a closed map, with the same two-step allowlist discipline the SQL operator surface uses — a user-controlled key reaching a `$`-prefixed operator is a Mongo injection, and the class of bug is identical to #364.',
          "Reject any field name beginning with `$` or containing `.` unless it is a declared column path; both are Mongo's own injection vectors.",
          'Implement sorting, `skip`/`limit`, projection, and aggregation for the operations the repository exposes.',
          'Implement populate as `$lookup`, and document what it cannot do (no cross-database lookups, different null semantics, pipeline size limits). Refuse the cases it cannot serve.',
          'Implement transactions only when the deployment supports them, with a startup check and an actionable error otherwise. A transaction that silently does nothing is the worst outcome available here.',
          'Validate every document read, and map `_id` to the declared primary key explicitly rather than assuming the names match.',
          'Add a real E2E suite against a containerised MongoDB, or state plainly that coverage is unit-level.',
        ],
        tests: [
          'The contract suite for Mongo, with declared gaps.',
          '`refuses an operator key that is not in the closed map`, including the inherited-property case.',
          '`refuses a field name that could be a Mongo operator or path`.',
          '`refuses a transaction on a non-replica-set deployment with an actionable message`.',
          '`maps _id to the declared primary key`.',
        ],
        dod: [
          'Every method the spec approved is implemented; every other refuses by name.',
          'Injection surfaces closed with the same discipline as the SQL operator allowlist.',
          'Transaction support gated on a real capability check.',
        ],
      },
      {
        key: 'gel',
        title: 'The Gel (EdgeDB) target',
        labels: ['enhancement'],
        blockedBy: ['seam'],
        goal: "Implement the EdgeQL target for the approved methods, deferring schema definition to Gel's own tooling per the spec, with refusals elsewhere.",
        why: 'Gel is the harder of the two because its schema model is not DDL: it has its own SDL and migration system. So the honest scope is the query half, with a documented boundary at schema management — and that boundary has to be explicit, or users will expect `zmdb generate` to work.',
        files: ['`packages/query-compiler/src/targets/gel.ts` (new)', '`packages/repository/src/drivers/gel.ts` (new)'],
        steps: [
          "Translate the plan shapes into EdgeQL for select/insert/update/delete, with parameters bound using EdgeQL's parameter syntax rather than interpolation.",
          "Map links to relations, and decide what `populate` means in EdgeQL — where Gel's shapes are strictly more expressive than a join, that is a place to refuse cleanly rather than approximate.",
          "Refuse migration emission and point at Gel's tooling with a message that names the command a user should run instead. A refusal that tells the user what to do instead is documentation.",
          'Validate results as with any other target.',
          'Add a real E2E suite if a container is practical, or state the coverage limit honestly.',
        ],
        tests: [
          'The contract suite for Gel, with declared gaps.',
          '`binds parameters using EdgeQL syntax rather than interpolating`.',
          "`refuses migration emission and names Gel's own tooling`.",
        ],
        dod: [
          'Query half implemented for approved methods; schema management explicitly out of scope with an actionable refusal.',
          'Coverage reality stated.',
        ],
      },
      {
        key: 'docs',
        title: '[Docs] MongoDB and Gel — with per-method support matrices',
        labels: ['documentation'],
        docs: true,
        blockedBy: ['mongo', 'gel'],
        goal: 'Update both pages to reflect the outcome: supported with an explicit per-method matrix, or still `todo` with a sharper reason. Generate the matrix from the same refusal data the tests use.',
        files: [
          '`docs-site/pages.mjs`, `docs-site/content/dialect-mongodb.md`, `docs-site/content/dialect-gel.md`',
          '`docs-site/coverage/mapping.mjs` — if a page stays `todo`, its note changes.',
        ],
        steps: [
          'Lead each page with the support matrix, method by method. That is the first thing a reader evaluating the target needs and the last thing a partial implementation wants to show — which is exactly why it goes first.',
          'Generate the matrix from the shared refusal data so it cannot drift from the tests.',
          'State the coverage reality (container E2E or unit-level) and the operational preconditions (replica set for Mongo transactions).',
          "If a target was refused in the spec slice, rewrite the page note with the specific reason and keep the page `todo` — and say so in the epic's closing comment rather than quietly leaving the page as it was.",
          'Refresh README counts, which change either way.',
        ],
        tests: ['`node docs-site/build.mjs`, `yarn verify:docs-coverage` green.'],
        dod: [
          'Both pages reflect reality, with generated per-method matrices where a target shipped.',
          'Refused targets carry a specific, evidence-based note rather than a vague one.',
        ],
      },
    ],
  },

  {
    key: 'rn',
    title: '[EPIC] React Native — the Metro build path and embedded migrations',
    labels: ['enhancement', 'area:dialects', 'area:cli'],
    pages: ['connect-react-native', 'migrations-web-mobile'],
    packages: ['@zmdb/aot-validator', '@zmdb/query-compiler'],
    motivation: `
zmdb's AOT transform runs as a build plugin or through \`zmdb-codegen\`. React Native does not use those
build pipelines — it uses Metro, with its own transformer interface — so \`schemaOf<T>()\` in an RN bundle
is never transformed. The failure is at least loud (an untransformed build throws with an explanatory
message rather than returning an empty schema), but the practical result is that zmdb cannot be used in
a React Native app at all.

The second page follows from the first: on-device SQLite needs migrations, and a migration file read
from disk at runtime does not exist in a bundle. Migrations have to be *embedded* — compiled into the
bundle as data and applied by a runner that never touches a filesystem. That is a different runner
entry point, and it is equally applicable to browser SQLite (wasm), which is why the page is called
"Migrations on Web & Mobile" rather than "on React Native".

There is a nice property here worth noticing: zmdb's design is unusually well suited to on-device use.
The validators are AOT-emitted, so there is no runtime schema machinery to ship; the query compiler is
small; there is no proxy layer or identity map. A data layer whose runtime cost is near zero is exactly
what a phone wants. The gap is entirely in the build integration.
`,
    dod: [
      'A Metro transformer integration applies the AOT transform in a React Native bundle, documented for both bare RN and Expo.',
      'The transform is verified by an actual bundle: a fixture app is bundled with Metro and the output is asserted to contain the inlined schema and no runtime `schemaOf` call.',
      'Migrations can be embedded as bundle data and applied by a runner with no filesystem access, with the ledger stored in the on-device database.',
      'The embedded runner works for browser SQLite (wasm) as well, since it is the same problem.',
      'A working example app exists in the repo or is referenced, and the docs are written from it rather than from theory.',
      'Both pages flip to supported.',
    ],
    invariants: [
      '§1 cost model matters more here, not less: an on-device bundle pays for every byte. The embedded-migration format must not ship the whole DDL emitter to a phone if only the statements are needed.',
      '§2.9 one front-end: the Metro transformer must reuse the same transform the plugin and CLI use. Three build integrations with three code paths would be three sets of bugs — and `yarn verify:fixtures` already exists to assert two routes agree, so a third joins it.',
      "The untransformed-build error must keep working in RN: a bundle that silently returns an empty schema would be a data-loss bug on a user's device.",
    ],
    subs: [
      {
        key: 'spec',
        title: '[Spec Freeze] the Metro integration and the embedded migration format',
        labels: ['spec'],
        goal: 'Freeze how the transform hooks into Metro, how Expo is supported, the embedded migration format, and how the runner applies migrations with no filesystem. No code.',
        why: "Metro's transformer interface is a different shape from a bundler plugin — it transforms per file with its own caching, and a project can only have one custom transformer, so composing with an existing one (Expo's, or Reanimated's) is the real constraint. Getting that wrong produces an integration that works alone and breaks in every real app.",
        files: [
          '`packages/aot-validator/src/plugin/SPEC.md` — the Metro entry.',
          '`packages/query-compiler/src/migrations/SPEC.md` — the embedded format and runner.',
        ],
        api: `
// metro.config.js
const { withZmdb } = require('@zmdb/aot-validator/metro');
module.exports = withZmdb(getDefaultConfig(__dirname));

/** Migrations compiled into the bundle. */
export interface EmbeddedMigration {
  readonly id: string;          // sortable, matches the file name that produced it
  readonly checksum: string;
  readonly up: readonly string[];
  readonly down: readonly string[];
}
export declare function runEmbedded(driver: Driver, migrations: readonly EmbeddedMigration[]): Promise<void>;
`,
        steps: [
          'Establish how Metro custom transformers compose, and specify `withZmdb` as a wrapper that delegates to whatever transformer the project already has rather than replacing it. Say explicitly that replacing is not acceptable, because Expo ships its own.',
          "Specify the Expo path, which may differ (Expo's config plugin system versus a raw `metro.config.js`), and cover both.",
          'Specify caching: Metro caches transform results by file content plus a transformer cache key. The key must incorporate the zmdb transform version and the config, or a stale cache will serve untransformed output after an upgrade. This is the subtle bug that will otherwise be reported as "it works after I clear the cache".',
          'Specify the embedded migration format, and how it is generated — a CLI command (`zmdb generate --embed` or an `export` variant) writing a TypeScript module the bundle imports. Decide the shape and where the file goes.',
          'Specify the embedded runner: no filesystem, ledger in the on-device database, checksums enforced, sequential application, and behaviour when the app is downgraded and sees a ledger entry it does not have a migration for (an error naming the id — an app that silently ignores a future migration will corrupt data).',
          'Specify bundle-size discipline: the embedded runner must not pull in the diff engine, the DDL emitter or the introspection code. Name the subpath it lives on so tree-shaking is structural rather than hopeful.',
          'Specify the browser-SQLite case as the same runner with a different driver, and say what the driver requirement is.',
        ],
        tests: ['None — spec only.', '`yarn validate:spec` green.'],
        dod: [
          'Metro composition (delegating, not replacing), Expo support and the cache-key requirement specified.',
          'Embedded format, generation command and runner semantics — including the downgrade case — frozen.',
          'Bundle-size discipline expressed as a subpath boundary.',
        ],
      },
      {
        key: 'tests',
        title: '[Tests Freeze] a real Metro bundle, and the embedded runner',
        labels: ['spec'],
        blockedBy: ['spec'],
        goal: 'Land failing tests that bundle a fixture app with real Metro and assert the output, plus embedded-runner tests against a real sqlite database with no filesystem access.',
        why: 'A unit test of a transformer function proves the function works. What breaks is the integration: the config wrapper, the cache key, and composition with another transformer. So the test has to run Metro.',
        files: [
          '`packages/aot-validator/src/plugin/metro.spec.ts` (new)',
          '`fixtures/consumer-metro/` (new) — a minimal RN-shaped app.',
          '`packages/query-compiler/src/migrations/embedded.spec.ts` (new)',
        ],
        tests: [
          '`bundles a fixture app with Metro and inlines the schema` — assert the bundle text contains the inlined schema literal and no `schemaOf` runtime call.',
          '`delegates to an existing custom transformer` — configure a second transformer and assert both ran.',
          '`invalidates the Metro cache when the transform version changes` — bundle, change the version, bundle again, assert the output changed.',
          '`still throws the untransformed-build error in an unconfigured bundle` — the safety net.',
          '`emits the same code as the plugin and CLI routes for the same input` — extend the `verify:fixtures` comparison to three routes.',
          '`applies embedded migrations in order and records them in the on-device ledger` — real `node:sqlite`, no filesystem.',
          '`refuses to apply an embedded migration whose checksum changed`.',
          '`errors when the ledger contains an id the bundle does not have` — the downgrade case.',
          "`does not pull the diff engine into the embedded runner's import graph` — assert the module graph, which is the only way to keep a bundle-size promise honest.",
        ],
        steps: [
          'Add the Metro fixture as a real project with a `metro.config.js`, and run Metro programmatically in the test. Bundling is slow, so keep the fixture minimal and consider a longer timeout rather than skipping the test.',
          'Write the module-graph assertion by importing the embedded subpath and walking its resolved imports, or by bundling it and checking for a marker symbol from the diff engine. A comment about tree-shaking is not a test.',
          'Extend `yarn verify:fixtures` to cover the third route in this slice, so the one-front-end invariant is machine-checked.',
        ],
        dod: [
          'A real Metro bundle is produced and asserted in CI.',
          'Cache invalidation, transformer composition and the three-route agreement all tested.',
          'Embedded runner tested against real sqlite, including checksum and downgrade cases.',
          'Bundle-size promise enforced by a module-graph assertion.',
        ],
      },
      {
        key: 'metro',
        title: 'The Metro transformer integration',
        labels: ['enhancement'],
        blockedBy: ['tests'],
        goal: 'Ship `withZmdb` for Metro, delegating to any existing transformer, with a correct cache key, working in both bare React Native and Expo.',
        files: [
          '`packages/aot-validator/src/plugin/metro.ts` (new)',
          '`packages/aot-validator/package.json` — a `./metro` subpath.',
          '`fixtures/consumer-metro/`',
        ],
        steps: [
          'Implement `withZmdb(config)` returning a config whose `transformer.babelTransformerPath` (or the current equivalent for the supported Metro version) points at a transformer that runs the zmdb transform and then delegates to the previous one. Pin the Metro version range supported and say so in the package metadata.',
          'Reuse the existing transform entry point — the same one the unplugin and CLI routes call. Do not fork it.',
          'Build the cache key from the transform version plus the resolved zmdb config, so an upgrade or a config change invalidates. This is the difference between an integration that works and one that works after `--reset-cache`.',
          'Support Expo explicitly, documenting which of the two config styles applies and testing at least the config shape.',
          'Keep the untransformed error path intact: a file the transformer did not process must still throw at runtime rather than degrade.',
          'Add the fixture to `yarn verify:fixtures` so all three routes are compared.',
        ],
        tests: [
          'All Metro tests go green, including the real bundle and the delegation test.',
          '`emits the same code as the plugin and CLI routes for the same input`.',
        ],
        dod: [
          'Metro integration ships behind a documented subpath with a pinned supported version range.',
          'Delegation, cache key and Expo support implemented and tested.',
          'Three-route agreement enforced by `yarn verify:fixtures`.',
        ],
      },
      {
        key: 'embedded',
        title: 'Embedded migrations and a filesystem-free runner',
        labels: ['enhancement'],
        blockedBy: ['tests'],
        goal: 'Ship the generation of an embedded migration module and a runner that applies it with no filesystem, small enough to put in a mobile bundle, working for browser SQLite too.',
        files: [
          '`packages/query-compiler/src/migrations/embedded.ts` (new) — the runner.',
          '`packages/query-compiler/package.json` — an `./migrations/embedded` subpath.',
          '`packages/zmdb/src/cli/commands/generate.ts` — the `--embed` output.',
        ],
        steps: [
          'Generate a TypeScript module exporting an array of `EmbeddedMigration`, deterministic and formatter-clean like every other generated file, with a generated header.',
          'Implement the runner with no `node:fs` import anywhere in its graph, and keep the diff engine and DDL emitter out of that graph — the statements are already computed at generate time, so the runner only executes strings.',
          'Store the ledger in the on-device database with the same table shape the server-side runner uses, so a schema can be reasoned about identically in both places.',
          'Enforce checksums, apply sequentially, and wrap each migration in a transaction where the driver supports it (SQLite does).',
          'Error on an unknown ledger id (the downgrade case) with a message naming the id and explaining that the app is older than the database.',
          'Test with the browser-SQLite driver shape as well, since it is the same runner — even if only against a driver double.',
        ],
        tests: [
          'All embedded-runner tests go green.',
          "`does not pull the diff engine into the embedded runner's import graph`.",
          '`applies each migration in a transaction on sqlite`.',
        ],
        dod: [
          'Generated embedded module is deterministic and formatter-clean.',
          'Runner has no filesystem dependency and a minimal import graph, enforced by test.',
          'Ledger shape shared with the server runner; checksums and the downgrade case handled.',
        ],
      },
      {
        key: 'docs',
        title: '[Docs] React Native, Expo, and migrations on web and mobile',
        labels: ['documentation'],
        docs: true,
        blockedBy: ['metro', 'embedded'],
        goal: 'Flip both pages to supported, written from the working fixture app, including the cache-invalidation gotcha and the on-device migration story.',
        files: [
          '`docs-site/pages.mjs`, `docs-site/content/connect-react-native.md`, `docs-site/content/migrations-web-mobile.md`',
          '`docs-site/content/aot-setup.md` — Metro joins the list of build routes.',
        ],
        steps: [
          "Write the setup from the fixture app's actual config, for bare RN and Expo separately, with the supported Metro version range stated.",
          'Document the cache behaviour and when a reset is genuinely needed — and be clear that it should not normally be, because the cache key handles it.',
          'Write the migrations page around the embedded model: generate, import, run at startup, and what happens on a downgrade.',
          'Cover browser SQLite on the same page, since it uses the same runner.',
          'Mention the bundle-size property and how it is enforced, since a mobile developer will ask.',
          "Add Metro to the AOT setup page's route list and refresh README counts.",
        ],
        tests: ['`node docs-site/build.mjs`, `yarn verify:docs-coverage` green.'],
        dod: [
          'Both pages supported and written from the fixture; Metro version range, cache behaviour, downgrade case and bundle-size enforcement all documented; AOT setup page updated.',
        ],
      },
    ],
  },
];
