// File EPICs + TDD sub-issues for the read/query DTO + typed-surface feature gaps.
// TDD ordering per capability: spec-freeze -> tests-freeze -> implementation,
// then a docs sub-issue. Idempotent by title.
//
// SAFETY: does NOTHING unless invoked with `--run`. `--dry` (default) only
// prints the plan and tallies counts — NO gh calls, NO issue creation.
// (Learned from last time: a bare import() must not create issues.)
import { execFileSync } from 'node:child_process';

const REPO = 'ambasta/zmdb';
const RUN = process.argv.includes('--run');

function gh(args, input) {
  return execFileSync('gh', args, { input, encoding: 'utf8' }).trim();
}

let existing = [];
function loadExisting() {
  if (!RUN) return;
  existing = JSON.parse(
    gh(['issue', 'list', '--repo', REPO, '--state', 'all', '--limit', '500', '--json', 'number,title']),
  );
}
const findByTitle = t => existing.find(i => i.title === t);

let planned = 0;
function createIssue({ title, body, labels }) {
  planned++;
  if (!RUN) {
    console.log(`  [dry] would create [${labels.join(',')}] ${title}`);
    return 0;
  }
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

// ---- EPIC definitions (the read/query DTO + typed-surface gaps) ----
const EPICS = [
  {
    title: '[EPIC] Read/Query DTO family — Get / List / Search / Projection / Result DTOs',
    parity: ['parity:mikro-orm', 'parity:typia'],
    motivation:
      'Today the only derived types are `Entity`, `CreateDTO`, `UpdateDTO` (schema-core/src/index.ts). The **entire read/query side is untyped** — repository reads take/return `Record<string, unknown>` (findById/findOne/findAll/findByFullText/findJoined/aggregate). There are no DTOs for Get (single-row result incl. selected fields + populated shape), List (items + pagination metadata), Search (query + filters + paging + ranking), Projection/partial-select, or typed join/aggregate results. This is the biggest product gap: consumers get no compile-time safety or editor help on the way data comes *out*.',
    dod: [
      '`GetDTO<S, Opts>` — the result type of a single-row fetch, narrowed by projection and widened by populate.',
      '`ListDTO<S>` (query: paging/order/filter/projection) and `ListResult<S>` (items + total/hasMore/cursor metadata).',
      '`SearchDTO<S>` — full-text query + typed filters + paging + optional ranking/score field on results.',
      '`Projection<S, K>` / partial-select typing that narrows the row to selected columns.',
      '`JoinResult` / `AggregateResult` DTOs (coordinated with EPICs C/D).',
      'OpenAPI: `get`/`list`/`search` variants alongside the existing entity/create/update.',
    ],
    subs: [
      {
        kind: 'spec',
        title: 'GetDTO + Projection',
        behavior:
          'Freeze `GetDTO<S,Opts>` and `Projection<S,K>` — result narrowing by selected columns, widening by populate; nullability rules; golden type-level examples.',
      },
      {
        kind: 'impl',
        title: 'GetDTO + Projection',
        behavior:
          'Implement the derived types + retype findById/findOne to return them; type-level (tsd/expect-type) tests green.',
      },
      {
        kind: 'spec',
        title: 'ListDTO + ListResult (pagination metadata)',
        behavior:
          'Freeze the list query DTO (limit/offset/order/filter/projection) and the ListResult envelope (items + total/hasMore/cursor).',
      },
      {
        kind: 'impl',
        title: 'ListDTO + ListResult',
        behavior: 'Implement + retype findAll into a paged, ordered, projected list returning ListResult.',
      },
      {
        kind: 'spec',
        title: 'SearchDTO (query + filters + ranking)',
        behavior:
          'Freeze the search DTO: full-text query + typed filters + paging + optional score/rank field on the result rows.',
      },
      {
        kind: 'impl',
        title: 'SearchDTO',
        behavior: 'Implement + retype findByFullText to consume SearchDTO and return ranked, typed results.',
      },
      {
        kind: 'spec',
        title: 'OpenAPI get/list/search variants',
        behavior:
          'Freeze how the new read DTOs map to OpenAPI response/query schemas (extend Variant beyond entity/create/update).',
      },
      {
        kind: 'impl',
        title: 'OpenAPI get/list/search variants',
        behavior: 'Implement the new OpenAPI variants deterministically.',
      },
      { kind: 'docs', title: 'Document the read/query DTO family', pages: ['read-dtos', 'projections'] },
    ],
  },
  {
    title: '[EPIC] Typed query & filter surface — WhereDTO, operators, OrderBy, Pagination',
    parity: ['parity:mikro-orm'],
    motivation:
      'Repository reads accept `where: Record<string, unknown>` and support only equality; there is no typed filter surface. mikro-orm/drizzle offer typed operators (eq/ne/lt/gt/gte/lte/in/nin/like/ilike/null), typed ordering, and pagination. We need a `WhereDTO<S>` (columns typed to their value type, operator set), `OrderByDTO<S>`, and `PaginationDTO` that the read methods consume, plus a typed `select()`/projection that narrows the returned row type.',
    dod: [
      '`WhereDTO<S>` — column-keyed, value-typed filter with an operator set {eq,ne,lt,lte,gt,gte,in,nin,like,ilike,isNull,notNull} + AND/OR composition.',
      '`OrderByDTO<S>` — typed column + direction, multi-key.',
      '`PaginationDTO` — limit/offset and cursor (keyset) variants.',
      'Typed `select(cols)` that narrows the result row type (feeds Projection in EPIC A).',
      'Repository read methods retyped to consume these instead of Record<string,unknown>.',
    ],
    subs: [
      {
        kind: 'spec',
        title: 'WhereDTO + operator set',
        behavior:
          'Freeze the typed filter grammar (per-column value types, operator set, AND/OR nesting) and its compilation to parameterized SQL.',
      },
      {
        kind: 'impl',
        title: 'WhereDTO + operator set',
        behavior:
          'Implement WhereDTO typing + compilation; retype findOne/findAll to accept it; parameterized SQL golden tests.',
      },
      {
        kind: 'spec',
        title: 'OrderByDTO + PaginationDTO',
        behavior:
          'Freeze typed ordering (column+dir, multi-key) and pagination (offset + keyset/cursor) contracts + golden SQL.',
      },
      {
        kind: 'impl',
        title: 'OrderByDTO + PaginationDTO',
        behavior: 'Implement ordering + pagination; wire into list reads.',
      },
      {
        kind: 'spec',
        title: 'Typed select()/projection narrowing',
        behavior: 'Freeze how select(cols) narrows the returned row type and composes with Where/Order/Pagination.',
      },
      {
        kind: 'impl',
        title: 'Typed select()/projection narrowing',
        behavior: 'Implement the narrowing select on the query builder + repository.',
      },
      { kind: 'docs', title: 'Document filters, ordering & pagination', pages: ['filters', 'pagination'] },
    ],
  },
  {
    title: '[EPIC] Typed relation results — Populated<S,K> + typed join rows',
    parity: ['parity:mikro-orm'],
    motivation:
      'Relations are declared and can be populated (findById(id,{populate}), findAllWithMany), but the **result is untyped** — populated children land on `Record<string,unknown>` parents. We need `Populated<S,K>` so a populated read returns a parent typed with the nested relation shape, and typed join-result rows for findJoined.',
    dod: [
      '`Populated<S, K extends RelationKeys<S>>` — parent Entity augmented with typed nested relation(s) (to-one object, to-many array).',
      'findById/findAll populate overloads return `Populated<...>`.',
      'Typed join result rows for findJoined (aliased columns → typed shape).',
      'No proxies/identity-map — populated children remain plain typed objects.',
    ],
    subs: [
      {
        kind: 'spec',
        title: 'Populated<S,K> result typing',
        behavior:
          'Freeze how populate options map to the augmented parent type (to-one → object, to-many → array), nullability, and multi-relation populate.',
      },
      {
        kind: 'impl',
        title: 'Populated<S,K> result typing',
        behavior: 'Implement the derived type + populate overloads on the repository; type-level tests green.',
      },
      {
        kind: 'spec',
        title: 'Typed join result rows',
        behavior:
          'Freeze the typed row shape produced by findJoined (base + joined/aliased columns) and its interaction with projection.',
      },
      { kind: 'impl', title: 'Typed join result rows', behavior: 'Implement typed join results; retype findJoined.' },
      { kind: 'docs', title: 'Document typed populate & join results', pages: ['populate-results'] },
    ],
  },
  {
    title: '[EPIC] Typed aggregate results — AggregateResult<S,Spec> + groupBy key typing',
    parity: ['parity:mikro-orm'],
    motivation:
      'The `aggregate(build)` method returns a caller-supplied generic `R` with no derivation — the computed columns (count/sum/avg/min/max) and groupBy keys are not typed from the spec. We need `AggregateResult<S, Spec>` so the shape (grouped key columns + typed computed columns) is derived and checked.',
    dod: [
      '`AggregateResult<S, Spec>` — derived row type: groupBy key columns (typed from S) + one typed field per computed aggregate.',
      'aggregate() infers its result from the builder spec (no hand-written R).',
      'Correct numeric/nullable typing for count vs sum/avg/min/max.',
    ],
    subs: [
      {
        kind: 'spec',
        title: 'AggregateResult<S,Spec>',
        behavior:
          'Freeze how a groupBy + aggregate spec derives the result row type (key columns + computed columns, correct number/nullable typing) with golden type-level examples.',
      },
      {
        kind: 'impl',
        title: 'AggregateResult<S,Spec>',
        behavior:
          'Implement the derived type + infer aggregate() result from the builder spec; type-level tests green.',
      },
      { kind: 'docs', title: 'Document typed aggregate results', pages: ['aggregate-results'] },
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
Every capability follows **spec-freeze → tests-freeze → implementation**:
- A \`spec\` sub-issue freezes the contract (type-level signatures, golden examples, acceptance) **before any code**.
- A tests sub-issue writes the **failing** tests — including type-level (\`expectTypeOf\`/\`tsd\`) assertions — against the frozen spec (red).
- Implementation sub-issue(s) make them green — no proxies, no identity map, parameterized SQL, ESM/Node 26/TS 7.

## Sub-issues
_(populated below as they are filed)_
`;
}

function subBody(parentNum, epicTitle, sub) {
  const parentRef = RUN ? `#${parentNum}` : `(parent epic)`;
  if (sub.kind === 'spec') {
    return `Parent epic: ${parentRef} (${epicTitle})

## Goal (SPEC FREEZE — do this first, no implementation)
Freeze the spec for: **${sub.title}**.

## Scope
${sub.behavior}

## Deliverable
- A frozen \`SPEC.md\` section: the type-level signature(s), golden type + SQL examples, edge cases (nullability, empty results, projection interaction), and acceptance criteria.

## TDD gate
- [ ] Spec written and frozen BEFORE any test or implementation code.
- [ ] Golden type-level + SQL examples enumerated (become the fixtures for the tests sub-issue).
- [ ] Acceptance criteria stated explicitly.

## Definition of Done
- [ ] Spec committed and referenced by the tests sub-issue.
- [ ] No implementation in this issue.
`;
  }
  if (sub.kind === 'tests') {
    return `Parent epic: ${parentRef} (${epicTitle})

## Goal (TESTS FREEZE — write failing tests against the frozen spec)
Author the test suite for **${sub.title}** from the frozen spec, including **type-level** assertions (\`expectTypeOf\`/\`tsd\`) for the derived DTOs plus runtime/SQL golden tests.

## TDD gate
- [ ] Depends on the spec-freeze sub-issue being frozen first.
- [ ] Tests written and initially **failing (red)** — no implementation yet.

## Definition of Done
- [ ] Failing tests committed (red): type-level + runtime, happy path + enumerated edge cases.
- [ ] No implementation in this issue.
`;
  }
  if (sub.kind === 'impl') {
    return `Parent epic: ${parentRef} (${epicTitle})

## Goal
Implement: **${sub.title}**.

## Depends on
The spec-freeze and tests-freeze sub-issues (spec frozen, tests red) — implementation may not start before those are done.

## Behavior
${sub.behavior}

## Definition of Done
- [ ] Spec frozen first; tests written first and initially failing (red).
- [ ] Implementation makes the tests pass (green), including type-level assertions.
- [ ] No architecture violations (no proxies/identity-map; parameterized SQL; ESM, Node 26, TS 7).
- [ ] Full suite green + typecheck clean.
`;
  }
  // docs
  return `Parent epic: ${parentRef} (${epicTitle})

## Goal
Document the shipped capability with real examples: ${sub.pages.map(p => `docs page \`${p}\``).join(', ')}.

## Depends on
All implementation sub-issues in this epic being green.

## Definition of Done
- [ ] \`docs-site/manifest.mjs\`: add/flip \`ok(...)\` page(s) with real, verified content + examples: ${sub.pages.join(', ')}.
- [ ] \`node docs-site/build.mjs\` regenerates; pages render.
- [ ] Pages deploy verified live under https://ambasta.github.io/zmdb/docs/.
`;
}

// ---- run ----
loadExisting();
console.log(RUN ? '=== FILING (live) ===' : '=== DRY RUN (no gh calls; pass --run to file) ===');
let epicCount = 0;
for (const e of EPICS) {
  epicCount++;
  console.log(`\nEPIC: ${e.title}`);
  const epicNum = createIssue({ title: e.title, body: epicBody(e), labels: ['epic', ...e.parity] });
  const expanded = [];
  for (const s of e.subs) {
    expanded.push(s);
    if (s.kind === 'spec') expanded.push({ kind: 'tests', title: s.title, behavior: s.behavior });
  }
  const created = [];
  for (const s of expanded) {
    const prefix =
      s.kind === 'spec'
        ? '[sub-issue] [Spec Freeze] '
        : s.kind === 'tests'
          ? '[sub-issue] [Tests Freeze] '
          : s.kind === 'docs'
            ? '[sub-issue] [Docs] '
            : '[sub-issue] ';
    const title = `${prefix}${s.title}`.slice(0, 250);
    const labels = ['sub-issue'];
    if (s.kind === 'spec' || s.kind === 'tests') labels.push('spec');
    if (s.kind === 'docs') labels.push('documentation');
    const num = createIssue({ title, body: subBody(epicNum, e.title, s), labels });
    created.push({ num, title });
  }
  if (RUN) {
    const checklist = created.map(c => `- [ ] #${c.num}`).join('\n');
    gh(
      ['issue', 'edit', String(epicNum), '--repo', REPO, '--body-file', '-'],
      epicBody(e).replace('_(populated below as they are filed)_', checklist),
    );
    console.log(`  ~ updated epic #${epicNum} with ${created.length} sub-issue links`);
  }
}
console.log(`\n${RUN ? 'DONE' : 'DRY TALLY'}: ${epicCount} epics, ${planned} issues total (epics + sub-issues).`);
