// One-shot: file EPICs + TDD sub-issues for every documented TODO capability.
// TDD ordering per epic: (1) spec-freeze sub-issue, (2) tests-freeze sub-issue
// (write failing tests / golden fixtures), (3+) implementation sub-issue(s),
// then a docs sub-issue flipping the page from TODO -> supported.
// Idempotent-ish: skips creating an epic if one with the same title already exists.
import { execFileSync } from 'node:child_process';

const REPO = 'ambasta/zmdb';

function gh(args, input) {
  return execFileSync('gh', args, { input, encoding: 'utf8' }).trim();
}
function existingTitles() {
  const out = gh(['issue', 'list', '--repo', REPO, '--state', 'all', '--limit', '400', '--json', 'number,title']);
  return JSON.parse(out);
}
const existing = existingTitles();
const findByTitle = (t) => existing.find((i) => i.title === t);

function createIssue({ title, body, labels }) {
  const found = findByTitle(title);
  if (found) {
    console.log(`  = exists #${found.number}: ${title}`);
    return found.number;
  }
  const args = ['issue', 'create', '--repo', REPO, '--title', title, '--body-file', '-'];
  for (const l of labels) args.push('--label', l);
  const url = gh(args, body);
  const num = Number(url.split('/').pop());
  existing.push({ number: num, title });
  console.log(`  + #${num}: ${title}`);
  return num;
}

// Each epic: { key, title, parity[], motivation, dod[], docPages[], subs[] }
// sub kinds: 'spec' | 'tests' | 'impl' | 'docs'
const EPICS = [
  {
    title: '[EPIC] Schema objects: indexes, constraints, views, sequences, generated columns, namespaces, RLS',
    parity: ['parity:mikro-orm'],
    motivation:
      'The docs surface (Drizzle "Manage schema": Data types, Indexes & Constraints, Sequences, Views, Schemas, RLS; MikroORM schema objects) lists declarative schema objects zmdb does not yet model. These are all shown as **TODO** on the docs site (not anti-patterns). They must feed the deterministic migration DDL, since the schema is the single source of truth.',
    dod: [
      'A declarative DSL for indexes (unique/partial/expression), check constraints, views (incl. materialized), standalone sequences, generated (stored/virtual) columns, multiple namespaces/schemas, and RLS policies.',
      'Each object diffs into dialect-correct DDL via the existing migration diff engine (no runtime schema mutation).',
      'Derived types/OpenAPI unaffected or updated deterministically.',
    ],
    subs: [
      { kind: 'spec', title: 'Indexes & Constraints', behavior: 'Freeze the index/unique/partial/expression + check-constraint DSL grammar, its column metadata shape, and golden DDL per dialect (pg/mysql/sqlite).' },
      { kind: 'impl', title: 'Indexes & Constraints', behavior: 'Implement the index/constraint builders + migration diff → DDL. Compose with existing table diffing.' },
      { kind: 'spec', title: 'Views (incl. materialized)', behavior: 'Freeze view/materialized-view declaration grammar and golden CREATE/DROP VIEW DDL + refresh semantics.' },
      { kind: 'impl', title: 'Views (incl. materialized)', behavior: 'Implement view objects + diff → DDL; ensure derived read types are available.' },
      { kind: 'spec', title: 'Sequences', behavior: 'Freeze standalone sequence object grammar (start/increment/cache) and golden DDL.' },
      { kind: 'impl', title: 'Sequences', behavior: 'Implement sequence objects + diff → DDL.' },
      { kind: 'spec', title: 'Generated columns', behavior: 'Freeze stored/virtual generated-column grammar and golden DDL + type-derivation rules (excluded from CreateDTO).' },
      { kind: 'impl', title: 'Generated columns', behavior: 'Implement generated columns in the DSL, type derivation, and diff → DDL.' },
      { kind: 'spec', title: 'Schemas / namespaces', behavior: 'Freeze multi-namespace grammar and qualified-identifier SQL rules.' },
      { kind: 'impl', title: 'Schemas / namespaces', behavior: 'Implement namespace qualification across query builder + migrations.' },
      { kind: 'spec', title: 'Row-Level Security (RLS)', behavior: 'Freeze RLS policy declaration grammar and golden CREATE POLICY / ENABLE RLS DDL.' },
      { kind: 'impl', title: 'Row-Level Security (RLS)', behavior: 'Implement RLS policy objects + diff → DDL.' },
      { kind: 'docs', title: 'Flip schema-object docs pages TODO → supported', pages: ['indexes-constraints', 'views', 'sequences', 'generated-columns', 'schemas-namespaces', 'rls'] },
    ],
  },
  {
    title: '[EPIC] Advanced query builder: set operations + batch API',
    parity: ['parity:mikro-orm'],
    motivation:
      'Drizzle documents Set Operations (UNION/INTERSECT/EXCEPT) and a Batch API (multiple statements, one roundtrip). Both are **TODO** docs pages. They extend the existing SQL-first builder without introducing proxies.',
    dod: [
      'UNION / UNION ALL / INTERSECT / EXCEPT composition in the builder, dialect-correct and parameterized.',
      'A batch API that sends multiple statements in a single roundtrip where the driver supports it, with deterministic ordering.',
    ],
    subs: [
      { kind: 'spec', title: 'Set operations', behavior: 'Freeze union/intersect/except grammar, type-merge rules for the row type, and golden SQL per dialect.' },
      { kind: 'impl', title: 'Set operations', behavior: 'Implement set-operation composition + result typing.' },
      { kind: 'spec', title: 'Batch API', behavior: 'Freeze the batch request/response contract and driver capability negotiation.' },
      { kind: 'impl', title: 'Batch API', behavior: 'Implement batched execution with single-roundtrip where supported; deterministic result order.' },
      { kind: 'docs', title: 'Flip set-operations + batch docs pages TODO → supported', pages: ['set-operations', 'batch'] },
    ],
  },
  {
    title: '[EPIC] Runtime topology: read replicas (read/write splitting)',
    parity: [],
    motivation:
      'Drizzle documents Read Replicas. zmdb injects a Driver, so read/write splitting is a driver-composition concern. Currently a **TODO** docs page.',
    dod: [
      'A read-replica-aware driver wrapper that routes reads to replicas and writes (and in-transaction reads) to the primary.',
      'Explicit, no hidden global state; deterministic routing rules.',
    ],
    subs: [
      { kind: 'spec', title: 'Read replicas', behavior: 'Freeze the routing contract (reads→replica, writes+tx→primary), the composition API over Driver, and failover policy.' },
      { kind: 'impl', title: 'Read replicas', behavior: 'Implement the replica-routing driver wrapper.' },
      { kind: 'docs', title: 'Flip read-replicas docs page TODO → supported', pages: ['read-replicas'] },
    ],
  },
  {
    title: '[EPIC] Custom types & codecs',
    parity: ['parity:mikro-orm'],
    motivation:
      'Drizzle documents Custom Types and Codecs. zmdb needs user-defined column types with custom SQL mapping and (de)serialization. **TODO** docs page.',
    dod: [
      'A custom-type API: SQL type + TS type + to-DB / from-DB codec, integrated with derivation, validation and Ser/De.',
      'Codecs are AOT-friendly (no per-row reflection where avoidable).',
    ],
    subs: [
      { kind: 'spec', title: 'Custom types & codecs', behavior: 'Freeze the custom-type contract (sqlType, tsType, serialize/deserialize), and how it flows into Entity/DTO derivation + validation + Ser/De.' },
      { kind: 'impl', title: 'Custom types & codecs', behavior: 'Implement custom-type registration + codec hooks across schema-core/query-compiler/aot-validator.' },
      { kind: 'docs', title: 'Flip custom-types docs page TODO → supported', pages: ['custom-types'] },
    ],
  },
  {
    title: '[EPIC] Seeding (deterministic data generation)',
    parity: [],
    motivation:
      'Drizzle documents drizzle-seed (Overview/Generators/Versioning). zmdb can reuse the AOT random generator to produce schema-satisfying seed data. **TODO** docs page.',
    dod: [
      'A deterministic (seeded) data generator that produces rows satisfying a schema + its validation tags, reusing the AOT random surface.',
      'Versioned/reproducible output; respects relations and FKs.',
    ],
    subs: [
      { kind: 'spec', title: 'Seeding', behavior: 'Freeze the seed API (per-schema count, seeded RNG, relation-aware ordering) and reproducibility contract.' },
      { kind: 'impl', title: 'Seeding', behavior: 'Implement the seeder on top of random<T> + repository create, respecting FK order.' },
      { kind: 'docs', title: 'Flip seeding docs page TODO → supported', pages: ['seeding'] },
    ],
  },
  {
    title: '[EPIC] Entity modeling: lifecycle events, embeddables, inheritance',
    parity: ['parity:mikro-orm'],
    motivation:
      'MikroORM documents lifecycle hooks/events, embeddables, and inheritance mapping. zmdb has repository-level create/update/delete hooks; a fuller event system, value-object embeddables, and inheritance mapping are **TODO**. NOTE: any implicit lifecycle magic that depends on change-tracking is an anti-pattern here — events must be explicit around the explicit write methods.',
    dod: [
      'An explicit event/subscriber surface around create/update/delete (no change-tracking-driven auto events).',
      'Embeddables: a value object spanning multiple columns of one table, with derivation + validation.',
      'Inheritance: single-table (and/or class-table) mapping with correct DDL + type derivation.',
    ],
    subs: [
      { kind: 'spec', title: 'Lifecycle events & subscribers', behavior: 'Freeze the explicit event surface (before/after create/update/delete), subscriber registration, and the explicit-not-implicit guarantee.' },
      { kind: 'impl', title: 'Lifecycle events & subscribers', behavior: 'Implement the event dispatch around repository write methods.' },
      { kind: 'spec', title: 'Embeddables', behavior: 'Freeze embeddable value-object grammar, column-prefix mapping, and derivation/validation rules.' },
      { kind: 'impl', title: 'Embeddables', behavior: 'Implement embeddables in schema-core derivation + query mapping.' },
      { kind: 'spec', title: 'Inheritance mapping', behavior: 'Freeze single-table (+optional class-table) inheritance grammar, discriminator handling, DDL, and derived-type union rules.' },
      { kind: 'impl', title: 'Inheritance mapping', behavior: 'Implement inheritance mapping + DDL + type derivation.' },
      { kind: 'docs', title: 'Flip entity-modeling docs pages TODO → supported', pages: ['lifecycle-hooks', 'embeddables', 'inheritance'] },
    ],
  },
  {
    title: '[EPIC] Framework integrations (NestJS / Hono / tRPC / Express)',
    parity: ['parity:typia'],
    motivation:
      'Typia documents utilization recipes (NestJS/Hono/tRPC/…). zmdb is framework-agnostic today (validate with assert(), serialize with stringify()). First-party adapters/recipes are **TODO**.',
    dod: [
      'Thin, optional adapters/recipes that wire boundary validation (assert<CreateDTO>) and AOT serialization (stringify<Entity>) into each framework.',
      'No framework becomes a hard dependency of the core.',
    ],
    subs: [
      { kind: 'spec', title: 'Framework integration contract', behavior: 'Freeze the shared adapter contract (request→assert→handler→stringify→response) and per-framework surface for NestJS/Hono/tRPC/Express.' },
      { kind: 'impl', title: 'NestJS + Hono + tRPC + Express adapters', behavior: 'Implement the optional adapters/recipes with example handlers + E2E.' },
      { kind: 'docs', title: 'Flip framework-integrations docs page TODO → supported', pages: ['framework-integrations'] },
    ],
  },
  {
    title: '[EPIC] LLM function calling harness (type → tool schema + lenient parse/coerce/validate)',
    parity: ['parity:typia'],
    motivation:
      'Typia documents an LLM function-calling harness (application/structuredOutput/parameters/schema). zmdb can reuse its JSON-schema + validator machinery to offer type→tool-schema with lenient JSON parsing, coercion and validation feedback. **TODO** docs page.',
    dod: [
      'Generate tool/parameter JSON schemas from a TS type/class (reusing toJsonSchema).',
      'Lenient parse + coerce + validate with structured feedback suitable for an LLM retry loop.',
    ],
    subs: [
      { kind: 'spec', title: 'LLM function-calling contract', behavior: 'Freeze the application()/parameters()/structuredOutput() surface, the schema mapping, and the lenient parse/coerce/validate + feedback contract.' },
      { kind: 'impl', title: 'LLM function-calling harness', behavior: 'Implement schema generation + lenient parse/coerce/validate on top of the AOT validator + OpenAPI generator.' },
      { kind: 'docs', title: 'Flip llm-function-calling docs page TODO → supported', pages: ['llm-function-calling'] },
    ],
  },
];

function epicBody(e) {
  return `# ${e.title}

## Motivation
${e.motivation}

## Definition of Done
Sub-issues collectively deliver:
${e.dod.map((d, i) => `${i + 1}. ${d}`).join('\n')}

## TDD process (required)
Every capability in this epic follows **spec-freeze → tests-freeze → implementation**:
- A \`spec\` sub-issue freezes the contract (grammar, golden output, acceptance) **before any code**.
- A tests sub-issue writes the **failing** tests / golden fixtures against the frozen spec (red).
- Implementation sub-issue(s) make them green — no proxies, no identity map, parameterized SQL, ESM/Node 26/TS 7.

## Sub-issues
_(populated below as they are filed)_
`;
}

function subBody(parentNum, epicTitle, sub) {
  if (sub.kind === 'spec') {
    return `Parent epic: #${parentNum} (${epicTitle})

## Goal (SPEC FREEZE — do this first, no implementation)
Freeze the spec for: **${sub.title}**.

## Scope
${sub.behavior}

## Deliverable
- A frozen \`SPEC.md\` section (or new SPEC) describing the contract: grammar/API shape, golden output (SQL/JSON) where applicable, edge cases, and the acceptance criteria the implementation must satisfy.

## TDD gate
- [ ] Spec written and frozen BEFORE any test or implementation code.
- [ ] Golden examples enumerated (these become the fixtures for the tests sub-issue).
- [ ] Acceptance criteria stated explicitly.

## Definition of Done
- [ ] Spec section committed and referenced by the tests sub-issue.
- [ ] No implementation in this issue.
`;
  }
  if (sub.kind === 'tests') {
    return `Parent epic: #${parentNum} (${epicTitle})

## Goal (TESTS FREEZE — write failing tests against the frozen spec)
Author the test suite / golden fixtures for **${sub.title}** from the frozen spec.

## TDD gate
- [ ] Depends on the spec-freeze sub-issue being frozen first.
- [ ] Tests written and initially **failing (red)** — no implementation yet.
- [ ] Golden fixtures match the spec's enumerated examples.

## Definition of Done
- [ ] Failing tests committed (red), covering happy path + enumerated edge cases.
- [ ] No implementation in this issue.
`;
  }
  if (sub.kind === 'impl') {
    return `Parent epic: #${parentNum} (${epicTitle})

## Goal
Implement: **${sub.title}**.

## Depends on
The spec-freeze and tests-freeze sub-issues (spec frozen, tests red) — implementation may not start before those are done.

## Behavior
${sub.behavior}

## Definition of Done
- [ ] Spec was frozen first; tests were written first and initially failing (red).
- [ ] Implementation makes the tests pass (green).
- [ ] No architecture violations (no proxies/identity-map; parameterized SQL; ESM, Node 26, TS 7).
- [ ] Full suite green + typecheck clean.
`;
  }
  // docs
  return `Parent epic: #${parentNum} (${epicTitle})

## Goal
Flip the docs page(s) from **TODO → supported** once the capability ships: ${sub.pages.map((p) => `\`docs-site\` page \`${p}\``).join(', ')}.

## Depends on
All implementation sub-issues in this epic being green.

## Definition of Done
- [ ] \`docs-site/manifest.mjs\`: change \`todo(...)\` → \`ok(...)\` with real, verified content + examples for: ${sub.pages.join(', ')}.
- [ ] \`node docs-site/build.mjs\` regenerates; pages no longer show the TODO banner.
- [ ] Pages deploy verified live under https://ambasta.github.io/zmdb/docs/.
`;
}

// --- run ---
for (const e of EPICS) {
  console.log(`\nEPIC: ${e.title}`);
  const epicNum = createIssue({ title: e.title, body: epicBody(e), labels: ['epic', ...e.parity] });
  // For each spec, auto-inject a matching tests sub-issue right after it.
  const expanded = [];
  for (const s of e.subs) {
    expanded.push(s);
    if (s.kind === 'spec') {
      expanded.push({ kind: 'tests', title: s.title, behavior: s.behavior });
    }
  }
  const created = [];
  for (const s of expanded) {
    const prefix =
      s.kind === 'spec' ? '[sub-issue] [Spec Freeze] '
      : s.kind === 'tests' ? '[sub-issue] [Tests Freeze] '
      : s.kind === 'docs' ? '[sub-issue] [Docs] '
      : '[sub-issue] ';
    const title = `${prefix}${s.title}`.slice(0, 250);
    const labels = ['sub-issue'];
    if (s.kind === 'spec') labels.push('spec');
    if (s.kind === 'tests') labels.push('spec');
    if (s.kind === 'docs') labels.push('documentation');
    const num = createIssue({ title, body: subBody(epicNum, e.title, s), labels });
    created.push({ num, title });
  }
  // Update the epic body with the sub-issue checklist.
  const checklist = created.map((c) => `- [ ] #${c.num}`).join('\n');
  const newBody = epicBody(e).replace('_(populated below as they are filed)_', checklist);
  gh(['issue', 'edit', String(epicNum), '--repo', REPO, '--body-file', '-'], newBody);
  console.log(`  ~ updated epic #${epicNum} with ${created.length} sub-issue links`);
}
console.log('\nDONE');
