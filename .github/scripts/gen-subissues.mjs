#!/usr/bin/env node
// Generates TDD sub-issues for each parent epic and links them back.
// Node 26+, ESM. Run: node .github/scripts/gen-subissues.mjs
import { execFileSync } from 'node:child_process';

const REPO = process.env.GH_REPO || 'ambasta/mono';

/** Run gh and return trimmed stdout. */
function gh(args, input) {
  return execFileSync('gh', args, {
    encoding: 'utf8',
    input,
    maxBuffer: 10 * 1024 * 1024,
  }).trim();
}

/**
 * Each epic: parent issue number + ordered list of sub-issues.
 * Sub-issue 1 is ALWAYS the spec-freeze (TDD: freeze spec before impl).
 * Every sub-issue includes: Goal, Depends on, Spec/behavior, TDD test plan
 * (failing tests first), Acceptance criteria, Definition of done.
 */
const EPICS = [
  {
    parent: 1,
    slug: 'schema-core',
    title: '@zmdb/schema-core',
    subs: [
      {
        t: 'Freeze spec: column DSL, modifiers, and metadata shape',
        goal: 'Freeze the public spec for the schema DSL so implementation can follow TDD.',
        depends: 'none',
        spec: [
          'Define the exact signature of every column builder: serial(), integer(), bigint(), numeric(), text(), varchar(n), boolean(), timestamp(), json(), jsonEnum([...]).',
          'Define modifier chain semantics: notNull(), nullable(), primaryKey(), unique(), references(target), defaultTo(value), validate(rule).',
          'Define the frozen CoreSchema<TableName> metadata object shape (table, columns, primaryKey[], references[]).',
          'Define defineSchema(table, columns) return contract.',
        ],
        tests: [
          'Write failing tests asserting each builder returns a metadata object with the documented `type` and default flags.',
          'Write failing tests asserting modifier chaining is order-independent and immutable (each call returns a new object).',
          'Write failing snapshot test of the CoreSchema object produced by a representative schema.',
        ],
        accept: [
          'A committed `SPEC.md` in packages/schema-core enumerating every builder/modifier and the metadata shape.',
          'Test file compiles and all tests FAIL (no implementation yet).',
        ],
      },
      {
        t: 'Implement column builders',
        goal: 'Implement all column builder functions to satisfy the frozen spec.',
        depends: 'the spec-freeze sub-issue',
        spec: [
          'Implement serial/integer/bigint/numeric/text/varchar/boolean/timestamp/json/jsonEnum returning frozen metadata.',
        ],
        tests: [
          'Make the column-builder tests from the spec sub-issue pass. Add edge cases: varchar length propagation, jsonEnum value capture.',
        ],
        accept: ['All column-builder unit tests green.', 'No runtime deps introduced.'],
      },
      {
        t: 'Implement modifiers (chainable, immutable)',
        goal: 'Implement notNull/nullable/primaryKey/unique/references/defaultTo/validate.',
        depends: 'column builders',
        spec: ['Each modifier returns a new immutable metadata object; chaining composes flags/constraints.'],
        tests: ['Make modifier chaining tests pass; assert immutability (original object unchanged).'],
        accept: ['All modifier tests green.', 'Chaining verified order-independent.'],
      },
      {
        t: 'Implement type derivation: Entity<T>, CreateDTO<T>, UpdateDTO<T>',
        goal: 'Derive TS types from a schema with zero duplication.',
        depends: 'column builders and modifiers',
        spec: [
          'Entity<T>: full row type.',
          'CreateDTO<T>: omit auto-increment/serial + columns with defaults become optional.',
          'UpdateDTO<T>: Partial<CreateDTO<T>>.',
        ],
        tests: [
          'Add tsd/expectType type-level tests: Entity has all columns typed correctly.',
          'Type test: CreateDTO omits serial primary key; optional where defaultTo present.',
          'Type test: UpdateDTO is fully partial.',
        ],
        accept: ['Type-level test suite passes under tsc with no errors.'],
      },
      {
        t: 'Implement defineSchema + schema registry',
        goal: 'Provide defineSchema entry point and a compile-time registry of schemas.',
        depends: 'type derivation',
        spec: ['defineSchema(table, columns) validates uniqueness of primary key and returns frozen CoreSchema.'],
        tests: ['Test defineSchema returns matching snapshot; throws on zero/duplicate primary keys.'],
        accept: [
          'defineSchema tests green; snapshot matches frozen spec.',
          'Closing this + prior subs fully resolves the parent epic.',
        ],
      },
    ],
  },
  {
    parent: 2,
    slug: 'query-compiler',
    title: '@zmdb/query-compiler',
    subs: [
      {
        t: 'Freeze spec: CompiledQuery contract + builder grammar',
        goal: 'Freeze the SQL builder grammar and the CompiledQuery output contract.',
        depends: 'none',
        spec: [
          'Define CompiledQuery { text: string; parameters: unknown[] }.',
          'Define builder grammar for selectFrom/where/andWhere/orWhere/orderBy/limit/offset/insertInto/values/updateTable/set/deleteFrom/returning.',
          'Define parameter placeholder policy per dialect ($1.. for pg, ? for mysql/sqlite).',
        ],
        tests: [
          'Failing tests asserting each builder method exists and .compile() returns the CompiledQuery shape.',
          'Failing golden tests of expected SQL strings for representative queries.',
        ],
        accept: ['Committed SPEC.md with grammar + golden SQL fixtures.', 'Tests compile and FAIL.'],
      },
      {
        t: 'Implement SELECT compilation',
        goal: 'Compile SELECT with where/orderBy/limit/offset to parameterized SQL.',
        depends: 'the spec-freeze sub-issue',
        spec: ['Straight string building; no runtime type resolution.'],
        tests: ['Make SELECT golden tests pass across all clauses; verify parameter array ordering.'],
        accept: ['SELECT golden tests green for pg default dialect.'],
      },
      {
        t: 'Implement INSERT / UPDATE / DELETE compilation',
        goal: 'Compile write statements with returning support.',
        depends: 'SELECT compilation',
        spec: ['insertInto().values(), updateTable().set().where(), deleteFrom().where(), .returning().'],
        tests: ['Golden tests for each write statement + returning; parameter ordering asserted.'],
        accept: ['All write-statement golden tests green.'],
      },
      {
        t: 'Implement dialects: Postgres, MySQL, SQLite',
        goal: 'Emit dialect-correct placeholders, identifier quoting, and LIMIT/OFFSET syntax.',
        depends: 'SELECT + write compilation',
        spec: ['Dialect strategy object injected into compiler; placeholder + quoting rules differ.'],
        tests: ['Parametrized golden tests: same builder → correct SQL per dialect.'],
        accept: ['Dialect matrix tests green for all three dialects.'],
      },
      {
        t: 'Zero-overhead benchmark vs Kysely',
        goal: 'Prove compilation overhead is negligible and allocation-lean.',
        depends: 'dialects',
        spec: ['Benchmark compile() throughput; assert no retained metadata objects for a simple query.'],
        tests: ['Add a benchmark + a test asserting compile() allocates below an agreed threshold (heap sample).'],
        accept: [
          'Benchmark committed with baseline numbers.',
          'Closing this + prior subs fully resolves the parent epic.',
        ],
      },
    ],
  },
  {
    parent: 3,
    slug: 'aot-validator',
    title: '@zmdb/aot-validator',
    subs: [
      {
        t: 'Freeze spec: transformer contract + emitted-JS shape',
        goal: 'Freeze what the transformer intercepts and the exact inline JS it emits.',
        depends: 'none',
        spec: [
          'Define which call expressions are intercepted (validate(), is(), assert()).',
          'Define emitted-JS contract for each primitive tag (Minimum/Maximum/MinLength/MaxLength/Pattern/Enum).',
          'Define the before→after code transform examples as golden fixtures.',
        ],
        tests: [
          'Failing transform golden tests: given input .ts, expect specific emitted JS (string compare of transformer output).',
        ],
        accept: ['Committed SPEC.md with before/after fixtures.', 'Tests compile and FAIL.'],
      },
      {
        t: 'Implement TypeScript transformer plugin scaffold',
        goal: 'Wire a ts.TransformerFactory that visits the AST and can be invoked in tests.',
        depends: 'the spec-freeze sub-issue',
        spec: ['Provide a test harness that runs the transformer over a source string and returns emitted JS.'],
        tests: ['Test: identity transform (no validate calls) leaves code unchanged.'],
        accept: ['Transformer harness usable in unit tests; identity test green.'],
      },
      {
        t: 'Implement primitive tag inlining (Minimum/Maximum/Length/Pattern/Enum)',
        goal: 'Replace validate(tag, expr) with inline boolean checks.',
        depends: 'transformer scaffold',
        spec: ['Each tag maps to allocation-free inline JS per the frozen contract.'],
        tests: ['Make the transform golden tests from spec pass for every primitive tag.'],
        accept: ['All primitive-tag transform tests green.'],
      },
      {
        t: 'Runtime-safety fallback + build integration',
        goal: 'Ensure code still type-checks/runs pre-transform (dev) and integrates with tsc build.',
        depends: 'primitive tag inlining',
        spec: [
          'Provide a no-op runtime implementation of validate() for pre-transform execution; document ttypescript/ts-patch wiring.',
        ],
        tests: [
          'Integration test: compile a fixture project with the transformer; assert validate() calls are gone from output and behavior matches.',
        ],
        accept: [
          'End-to-end transform integration test green.',
          'Closing this + prior subs fully resolves the parent epic.',
        ],
      },
    ],
  },
  {
    parent: 4,
    slug: 'repository',
    title: '@zmdb/repository',
    subs: [
      {
        t: 'Freeze spec: BaseRepository API + validation interception contract',
        goal: 'Freeze the repository method surface and how validation hooks in.',
        depends: 'none',
        spec: [
          'Define BaseRepository<Schema> methods: findById, findOne, findAll, create, update, delete.',
          'Define return types via schema-core derivation (Entity/CreateDTO/UpdateDTO).',
          'Define where validation runs (create→CreateDTO, update→UpdateDTO) and the <10-line subclass contract.',
        ],
        tests: ['Failing tests: subclass with only schema binding exposes all CRUD methods with correct signatures.'],
        accept: ['Committed SPEC.md + a fixture repository under 10 lines.', 'Tests compile and FAIL.'],
      },
      {
        t: 'Implement read methods (findById/findOne/findAll)',
        goal: 'Wire reads through query-compiler and a pluggable driver interface.',
        depends: 'the spec-freeze sub-issue',
        spec: ['Reads compile SQL and execute via an injected driver; return plain objects (no proxies).'],
        tests: ['Unit tests with an in-memory fake driver: assert correct SQL compiled + rows mapped to Entity<T>.'],
        accept: ['Read-method tests green with fake driver.'],
      },
      {
        t: 'Implement create/update with AOT validation interception',
        goal: 'create/update validate payloads via aot-validator before executing writes.',
        depends: 'read methods',
        spec: [
          'create(payload) validates against CreateDTO; update(id, payload) against UpdateDTO; invalid input throws structured error.',
        ],
        tests: [
          'Tests: valid payload → correct INSERT/UPDATE SQL; invalid payload → structured validation error, no SQL executed.',
        ],
        accept: ['Write + validation tests green.'],
      },
      {
        t: 'Implement delete + pre/post hooks',
        goal: 'delete(id) and lifecycle hooks (preInsert/postSelect/etc.).',
        depends: 'create/update',
        spec: ['Explicit, synchronous hook points; no hidden change tracking.'],
        tests: ['Tests: delete compiles correct SQL; hooks fire in documented order.'],
        accept: ['Delete + hook tests green.'],
      },
      {
        t: 'End-to-end integration test (<10 line repo, real SQLite)',
        goal: 'Prove the full stack: schema → repo → SQLite CRUD with auto-validation.',
        depends: 'all prior repository subs',
        spec: ['A representative schema + <10-line repository performs full CRUD against an in-process SQLite DB.'],
        tests: ['E2E test: create/read/update/delete round-trip; invalid create rejected.'],
        accept: ['E2E test green.', 'Closing this + prior subs fully resolves the parent epic.'],
      },
    ],
  },
  {
    parent: 5,
    slug: 'relations',
    title: 'Entity Relations',
    subs: [
      {
        t: 'Freeze spec: relation DSL + populate semantics',
        goal: 'Freeze relation builders and populate/JOIN semantics (no identity map, no proxies).',
        depends: 'schema-core type derivation (#1)',
        spec: [
          'Define manyToOne/oneToMany/oneToOne/manyToMany builders and their metadata.',
          'Define populate([...]) semantics and how related types attach to Entity<T> only when populated.',
          'Define JOIN vs batched-select strategy selection.',
        ],
        tests: [
          'Failing tests: relation builders produce documented metadata; type test that populate adds relation field to result type.',
        ],
        accept: ['Committed SPEC.md with relation examples.', 'Tests compile and FAIL.'],
      },
      {
        t: 'Implement relation DSL builders in schema-core',
        goal: 'Add relation builders producing frozen relation metadata + FK info.',
        depends: 'the spec-freeze sub-issue',
        spec: ['Builders capture target table, cardinality, owning side, FK columns.'],
        tests: ['Unit tests: each builder metadata snapshot matches spec.'],
        accept: ['Relation builder tests green.'],
      },
      {
        t: 'Implement compile-time relation type derivation',
        goal: 'Derive populated result types at compile time.',
        depends: 'relation DSL builders',
        spec: ['PopulatedEntity<T, K> augments Entity<T> with related entity/array types for populated keys K.'],
        tests: ['Type-level tests: populate(["posts"]) yields posts: Entity<Post>[] on the result.'],
        accept: ['Relation type tests pass under tsc.'],
      },
      {
        t: 'Implement JOIN / batched-select compilation in query-compiler',
        goal: 'Compile populate into deterministic JOINs or batched selects.',
        depends: 'relation type derivation + query-compiler dialects (#2)',
        spec: ['Emit correct JOIN SQL for to-one; batched IN() select for to-many; stable ordering.'],
        tests: ['Golden SQL tests for each cardinality; parameter ordering asserted.'],
        accept: ['Relation compilation golden tests green.'],
      },
      {
        t: 'Integrate populate() into repository + E2E',
        goal: 'Expose repo.findWithRelations / populate and prove round-trip.',
        depends: 'JOIN compilation + repository (#4)',
        spec: ['Repository method accepts populate hints; maps nested rows to populated entities (plain objects).'],
        tests: ['E2E against SQLite: parent with children populated correctly; no shared references / no proxies.'],
        accept: ['Relation E2E test green.', 'Closing this + prior subs fully resolves the parent epic.'],
      },
    ],
  },
  {
    parent: 6,
    slug: 'transactions',
    title: 'Transactions & Unit of Work',
    subs: [
      {
        t: 'Freeze spec: transaction API + isolation semantics',
        goal: 'Freeze the explicit transaction API and nesting/savepoint semantics.',
        depends: 'repository (#4)',
        spec: [
          'Define db.transaction(async (tx) => { ... }) contract, commit/rollback rules.',
          'Define tx-scoped repository binding.',
          'Define nested transaction → savepoint mapping and isolation-level option.',
        ],
        tests: [
          'Failing tests: transaction callback commits on success, rolls back on throw (fake driver records BEGIN/COMMIT/ROLLBACK).',
        ],
        accept: ['Committed SPEC.md.', 'Tests compile and FAIL.'],
      },
      {
        t: 'Implement transaction context primitive',
        goal: 'A tx object wrapping a connection with begin/commit/rollback.',
        depends: 'the spec-freeze sub-issue',
        spec: ['No global state; tx passed explicitly. Uses driver connection.'],
        tests: ['Unit tests with fake driver: verifies BEGIN/COMMIT/ROLLBACK ordering.'],
        accept: ['Transaction primitive tests green.'],
      },
      {
        t: 'Implement transaction-scoped repository binding',
        goal: 'Repositories can run within a tx so multiple ops share one transaction.',
        depends: 'transaction context primitive',
        spec: ['repo.withTransaction(tx) or tx.repo(RepoClass) routes all SQL through tx connection.'],
        tests: ['Test: two writes in one tx both roll back on failure.'],
        accept: ['Scoped-binding tests green.'],
      },
      {
        t: 'Implement savepoints / nested transactions',
        goal: 'Nested transaction() calls map to SQL savepoints.',
        depends: 'scoped repository binding',
        spec: ['Nested begin → SAVEPOINT; inner rollback → ROLLBACK TO SAVEPOINT; outer unaffected.'],
        tests: ['Test: inner rollback preserves outer writes; savepoint SQL asserted.'],
        accept: ['Savepoint tests green.'],
      },
      {
        t: 'Explicit write-batching helper + E2E',
        goal: 'Batch multiple writes into one round-trip; prove atomicity on SQLite.',
        depends: 'savepoints',
        spec: ['batch([...ops]) executes within a single transaction, one flush.'],
        tests: ['E2E on SQLite: batch commit persists all; batch failure persists none.'],
        accept: ['Batching E2E test green.', 'Closing this + prior subs fully resolves the parent epic.'],
      },
    ],
  },
  {
    parent: 7,
    slug: 'migrations',
    title: 'Migrations & Schema Diffing',
    subs: [
      {
        t: 'Freeze spec: snapshot format + migration lifecycle',
        goal: 'Freeze the schema snapshot artifact and migrate create/up/down/status lifecycle.',
        depends: 'schema-core (#1), query-compiler dialects (#2)',
        spec: [
          'Define deterministic JSON snapshot of compiled schema metadata.',
          'Define migration file format (up SQL / down SQL) and version table schema.',
          'Define CLI verbs: create, up, down, status.',
        ],
        tests: ['Failing tests: snapshot serializer output matches golden JSON for a sample schema.'],
        accept: ['Committed SPEC.md + golden snapshot fixture.', 'Tests compile and FAIL.'],
      },
      {
        t: 'Implement schema snapshot serializer',
        goal: 'Serialize a schema registry to the frozen deterministic snapshot.',
        depends: 'the spec-freeze sub-issue',
        spec: ['Stable key ordering; identical schema → identical bytes.'],
        tests: ['Test: serializer matches golden snapshot; determinism test (serialize twice, compare).'],
        accept: ['Snapshot serializer tests green.'],
      },
      {
        t: 'Implement diff engine (snapshot → snapshot)',
        goal: 'Compute add/drop/alter column/table/index operations between two snapshots.',
        depends: 'snapshot serializer',
        spec: ['Pure function: (prev, next) → ordered list of change ops.'],
        tests: ['Table-driven tests: add column, drop column, add table, change type, add FK.'],
        accept: ['Diff engine tests green for all documented op kinds.'],
      },
      {
        t: 'Implement DDL emitter per dialect',
        goal: 'Turn change ops into up/down SQL per dialect.',
        depends: 'diff engine + query-compiler dialects (#2)',
        spec: ['Each change op → forward + reverse SQL; dialect-correct DDL.'],
        tests: ['Golden DDL tests per op per dialect; down reverses up.'],
        accept: ['DDL emitter golden tests green.'],
      },
      {
        t: 'Implement migration runner + CLI + version tracking + E2E',
        goal: 'Apply/rollback migrations against a DB with a version table; wire CLI.',
        depends: 'DDL emitter',
        spec: ['Runner records applied versions; up/down/status operate idempotently.'],
        tests: ['E2E on SQLite: create → up → status → down; version table reflects state.'],
        accept: ['Migration E2E + CLI tests green.', 'Closing this + prior subs fully resolves the parent epic.'],
      },
    ],
  },
  {
    parent: 8,
    slug: 'advanced-validation',
    title: 'Advanced Validation Semantics',
    subs: [
      {
        t: 'Freeze spec: advanced validation grammar + emitted-JS contract',
        goal: 'Freeze refine/transform/union/coerce/brand grammar and their inline-JS output.',
        depends: 'aot-validator primitive inlining (#3)',
        spec: [
          'Define refine(predicate, message) and its emitted inline check.',
          'Define transform(fn) purity requirement + emitted conversion.',
          'Define union / discriminatedUnion exhaustive branch emission.',
          'Define coercion and branded-type contracts + object strictness modes.',
        ],
        tests: ['Failing transform golden tests for each construct (before→after JS).'],
        accept: ['Committed SPEC.md with fixtures.', 'Tests compile and FAIL.'],
      },
      {
        t: 'Implement refinement compilation',
        goal: 'Compile refine() predicates to inline boolean checks with error messages.',
        depends: 'the spec-freeze sub-issue',
        spec: ['Predicate inlined; failure yields structured error with custom message.'],
        tests: ['Golden + behavior tests: passing/failing refinements.'],
        accept: ['Refinement tests green.'],
      },
      {
        t: 'Implement transform compilation',
        goal: 'Compile post-validation transforms as inline pure conversions.',
        depends: 'refinement compilation',
        spec: ['Transform runs only after validation passes; output type reflected at compile time.'],
        tests: ['Tests: value transformed correctly; type-level test of output type.'],
        accept: ['Transform tests green.'],
      },
      {
        t: 'Implement union / discriminated-union compilation',
        goal: 'Emit exhaustive, allocation-free branch checks for unions.',
        depends: 'transform compilation',
        spec: ['Discriminated unions switch on the discriminant; plain unions try branches in order.'],
        tests: ['Golden + behavior tests across union shapes incl. nested.'],
        accept: ['Union tests green.'],
      },
      {
        t: 'Implement coercion, branded types, object strictness',
        goal: 'Opt-in coercion, nominal brands, and strict/strip/passthrough object modes.',
        depends: 'union compilation',
        spec: ['Coercion emitted as inline conversion; brands compile-time only; strictness controls excess keys.'],
        tests: [
          'Behavior tests: coerce string→number; brand type test; strict rejects excess keys, strip removes them.',
        ],
        accept: ['Coercion/brand/strictness tests green.'],
      },
      {
        t: 'Structured error reporting with exact paths + E2E',
        goal: 'Emit structured errors { path, expected, value, message } with exact paths.',
        depends: 'all prior advanced-validation subs',
        spec: ['Nested failures report exact path e.g. input.orders[2].totalPrice.'],
        tests: ['E2E: deep object with multiple failures reports all exact paths.'],
        accept: ['Error-path E2E test green.', 'Closing this + prior subs fully resolves the parent epic.'],
      },
    ],
  },
  {
    parent: 9,
    slug: 'serialization',
    title: 'AOT JSON Serialization',
    subs: [
      {
        t: 'Freeze spec: serializer codegen contract + escaping rules',
        goal: 'Freeze the emitted stringify code shape and JSON correctness rules.',
        depends: 'aot-validator (#3)',
        spec: [
          'Define stringify<T>() emitted straight-line concatenation contract.',
          'Freeze escaping rules: quotes, backslash, control chars, unicode, and bigint policy.',
          'Define null/undefined/optional field handling.',
        ],
        tests: ['Failing golden tests: emitted JS for a sample type; output equals JSON.stringify for fixtures.'],
        accept: ['Committed SPEC.md + escaping fixtures.', 'Tests compile and FAIL.'],
      },
      {
        t: 'Implement AOT stringify<T> codegen',
        goal: 'Generate fast stringify for known object/array/primitive shapes.',
        depends: 'the spec-freeze sub-issue',
        spec: ['Straight-line concatenation; correct escaping per spec.'],
        tests: ['Property tests: for random values of T, output parses back equal to input (round-trip vs JSON).'],
        accept: ['stringify correctness tests green (matches JSON.stringify on fixtures + fuzz).'],
      },
      {
        t: 'Implement validated assertStringify<T>',
        goal: 'Validate then serialize in one inline pass.',
        depends: 'stringify codegen',
        spec: ['Runs inline validation (reuse #8/#3) before serialization; throws structured error on invalid.'],
        tests: ['Tests: invalid input throws; valid input serializes identically to stringify.'],
        accept: ['assertStringify tests green.'],
      },
      {
        t: 'Implement typed parse<T> / decode path',
        goal: 'Parse JSON string and validate into T.',
        depends: 'assertStringify',
        spec: ['parse<T>(text) → validated T or structured error; reuses advanced-validation engine.'],
        tests: ['Tests: valid JSON → typed value; malformed/invalid → structured error.'],
        accept: ['parse tests green.'],
      },
      {
        t: 'Benchmark suite vs JSON.stringify + E2E',
        goal: 'Demonstrate speedup and integrate serialization into repository read path.',
        depends: 'parse path',
        spec: ['Benchmark stringify<T> vs native; wire response-DTO serialization hook in repository.'],
        tests: ['Benchmark committed; E2E: repository read serializes rows via AOT stringify.'],
        accept: ['Benchmark + E2E green.', 'Closing this + prior subs fully resolves the parent epic.'],
      },
    ],
  },
  {
    parent: 10,
    slug: 'validator-utilities',
    title: 'Validator Utility Surface',
    subs: [
      {
        t: 'Freeze spec: is/assert/validate/equals signatures + error object shape',
        goal: 'Freeze every entry-point signature and the structured error object.',
        depends: 'aot-validator (#3)',
        spec: [
          'Define is<T>, assert<T>, validate<T>, equals<T>, assertEquals<T>, random<T> signatures.',
          'Freeze error object shape { path, expected, value, message } and validate<T> result { success, data?, errors? }.',
        ],
        tests: ['Failing tests: signatures exist; error object matches shape on a known failure.'],
        accept: ['Committed SPEC.md.', 'Tests compile and FAIL.'],
      },
      {
        t: 'Implement is<T> boolean guard codegen',
        goal: 'Inline boolean type guard, allocation-free on success.',
        depends: 'the spec-freeze sub-issue',
        spec: ['is<T>(x): x is T emitted as inline predicate.'],
        tests: ['Behavior tests across primitives, objects, arrays, unions.'],
        accept: ['is<T> tests green.'],
      },
      {
        t: 'Implement assert<T> with structured throwing',
        goal: 'Throw a structured error (with exact path) on first/aggregate failure.',
        depends: 'is<T>',
        spec: ['assert<T>(x): T returns x when valid, throws structured error otherwise.'],
        tests: ['Tests: valid returns input; invalid throws with correct path/expected/value.'],
        accept: ['assert<T> tests green.'],
      },
      {
        t: 'Implement validate<T> non-throwing result',
        goal: 'Return { success, data?, errors? } collecting all failures.',
        depends: 'assert<T>',
        spec: ['Collects every failure with exact paths; no throw.'],
        tests: ['Tests: multiple failures all reported; success carries typed data.'],
        accept: ['validate<T> tests green.'],
      },
      {
        t: 'Implement equals/assertEquals (excess-property strict)',
        goal: 'Strict variants that reject excess properties.',
        depends: 'validate<T>',
        spec: ['equals<T> is<T> + no excess keys; assertEquals<T> throwing variant.'],
        tests: ['Tests: excess key fails equals but passes is.'],
        accept: ['equals/assertEquals tests green.'],
      },
      {
        t: 'Implement random<T> generator + E2E',
        goal: 'Generate schema/type-driven sample data; prove generated data passes is<T>.',
        depends: 'equals/assertEquals',
        spec: ['random<T>() honors tags (Minimum/MaxLength/Pattern/Enum) so output is valid by construction.'],
        tests: ['Property test: for many seeds, is<T>(random<T>()) === true.'],
        accept: ['random<T> property tests green.', 'Closing this + prior subs fully resolves the parent epic.'],
      },
    ],
  },
];

function buildBody(epic, sub, _idx) {
  const lines = [];
  lines.push(`Parent epic: #${epic.parent} (${epic.title})`);
  lines.push('');
  lines.push('## Goal');
  lines.push(sub.goal);
  lines.push('');
  lines.push('## Depends on');
  lines.push(
    sub.depends === 'none'
      ? 'Nothing — this is the spec-freeze starting point (TDD).'
      : `Previous sub-issue(s): ${sub.depends}.`,
  );
  lines.push('');
  lines.push('## Spec / Behavior');
  for (const s of sub.spec) lines.push(`- ${s}`);
  lines.push('');
  lines.push('## TDD Test Plan (write failing tests first)');
  for (const t of sub.tests) lines.push(`- ${t}`);
  lines.push('');
  lines.push('## Acceptance Criteria');
  for (const a of sub.accept) lines.push(`- [ ] ${a}`);
  lines.push('');
  lines.push('## Definition of Done');
  lines.push('- [ ] Tests written first and initially failing (red).');
  lines.push('- [ ] Implementation makes tests pass (green).');
  lines.push('- [ ] No architecture violations (no proxies, no runtime reflection, ESM-only, Node 26+, TS 7).');
  return lines.join('\n');
}

const created = {}; // parent -> [{num, title}]
for (const epic of EPICS) {
  created[epic.parent] = [];
  epic.subs.forEach((sub, idx) => {
    const title = `[${epic.title}] ${idx === 0 ? 'Spec Freeze: ' : ''}${sub.t}`;
    const body = buildBody(epic, sub, idx);
    const labels = idx === 0 ? 'sub-issue,spec' : 'sub-issue';
    const url = gh(['issue', 'create', '--repo', REPO, '--title', title, '--body-file', '-', '--label', labels], body);
    const num = url.split('/').pop();
    created[epic.parent].push({ num, title });
    console.log(`created #${num} ${title}`);
  });
}

// Link sub-issues back into each parent as a task list.
for (const epic of EPICS) {
  const subs = created[epic.parent];
  const existing = gh(['issue', 'view', String(epic.parent), '--repo', REPO, '--json', 'body', '-q', '.body']);
  const checklist = [
    '',
    '---',
    '',
    '## Sub-issues (complete in order; all must close to resolve this epic)',
    ...subs.map(s => `- [ ] #${s.num} — ${s.title}`),
  ].join('\n');
  gh(['issue', 'edit', String(epic.parent), '--repo', REPO, '--body-file', '-'], existing + '\n' + checklist);
  console.log(`linked ${subs.length} subs into epic #${epic.parent}`);
}

console.log('DONE');
