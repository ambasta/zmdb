// File the usability/DX EPICs + TDD sub-issues, WITH explicit blocking
// dependencies (both intra-epic spec→tests→impl chains and cross-epic).
// SPEC & TDD first: every capability is spec-freeze → tests-freeze → impl → docs.
//
// SAFE: does nothing unless invoked with `--run`. Default prints the plan.
//
// Blocking is expressed two ways so it's unmissable:
//   - a "## Blocked by" / "## Blocks" section in each issue body (filled in a
//     second pass once numbers are known), and
//   - the `blocked` label on any issue whose blockers aren't its own epic's
//     just-prior step (i.e. issues that cannot start at filing time).
import { execFileSync } from 'node:child_process';

const REPO = 'ambasta/zmdb';
const RUN = process.argv.includes('--run');
const gh = (args, input) => execFileSync('gh', args, { encoding: 'utf8', input }).trim();

// ---- Epic + sub-issue model ----
// Each sub has a stable `key` so we can wire blocking by key, then resolve to
// issue numbers after creation. `blockedBy` lists keys that must close first.
const EPICS = [
  {
    key: 'A',
    title: '[EPIC] Typed repository methods — reads/writes typed at the call site',
    parity: ['parity:mikro-orm'],
    motivation:
      'The DTO layer (`GetDTO`/`WhereDTO`/`ListDTO`/`buildListResult`, etc.) exists in `@zmdb/schema-core/dto`, but `BaseRepository` methods are still untyped: `findById(id: unknown): Promise<Record<string, unknown> | undefined>`, `findOne(where: Record<string, unknown>)`, `findAll()`. So the headline "everything is typed" is NOT true where users actually call the repository. This epic wires the DTOs INTO the repository so `findById` returns `Entity<S>|undefined`, `find(where: WhereDTO<S>)`, `list(query): ListResult<Entity<S>>`, and `create/update` accept/return the derived DTOs.',
    dod: [
      'Repository read methods are generically typed from the bound schema `S`: `findById → Entity<S>|undefined`, `findOne/find(where: WhereDTO<S>) → Entity<S>|undefined`, `list(query: ListDTO<S>) → ListResult<Entity<S>>` (uses compileWhere/applyOrderBy/applyPagination/buildListResult).',
      '`create(dto: CreateDTO<S>) → Entity<S>` and `update(id, patch: UpdateDTO<S>) → Entity<S>`, validating before SQL.',
      'A `select` option narrows the return type via `Projection<S,K>`.',
      'Existing untyped signatures either removed or kept as escape hatches; specs updated.',
    ],
    subs: [
      { key: 'A1', kind: 'spec', title: 'Typed read methods (findById/findOne/find/list)', blockedBy: [] },
      { key: 'A2', kind: 'tests', title: 'Typed read methods', blockedBy: ['A1'] },
      { key: 'A3', kind: 'impl', title: 'Typed read methods', blockedBy: ['A2'] },
      { key: 'A4', kind: 'spec', title: 'Typed create/update (CreateDTO/UpdateDTO → Entity)', blockedBy: [] },
      { key: 'A5', kind: 'tests', title: 'Typed create/update', blockedBy: ['A4'] },
      { key: 'A6', kind: 'impl', title: 'Typed create/update', blockedBy: ['A5'] },
      { key: 'A7', kind: 'docs', title: 'Document the typed repository', pages: ['repository', 'crud'], blockedBy: ['A3', 'A6'] },
    ],
  },
  {
    key: 'B',
    title: '[EPIC] First-party driver adapters (pg + node:sqlite)',
    parity: [],
    motivation:
      'Today every user must hand-write a `Driver { execute(query) }` adapter around pg/node:sqlite. Drizzle ships drivers; we ship an interface + a doc snippet — a real getting-started cliff. This epic ships thin, official adapters so step one is `new UserRepo(pgDriver(pool))` / `new UserRepo(sqliteDriver(db))`, not "implement this interface."',
    dod: [
      'A `pg` driver adapter (`@zmdb/repository/drivers/pg` or similar) mapping `CompiledQuery` → `pool.query(text, params)` → rows, with optional prepared-statement reuse.',
      'A `node:sqlite` driver adapter (built-in, zero external deps) mapping to `DatabaseSync`.',
      'Both implement the `Driver` interface and are covered by E2E tests (self-skipping when a DB is unreachable, sqlite always runs).',
    ],
    subs: [
      { key: 'B1', kind: 'spec', title: 'Driver adapter contract (pg + node:sqlite)', blockedBy: [] },
      { key: 'B2', kind: 'tests', title: 'Driver adapters', blockedBy: ['B1'] },
      { key: 'B3', kind: 'impl', title: 'node:sqlite driver', blockedBy: ['B2'] },
      { key: 'B4', kind: 'impl', title: 'pg driver (+ optional prepared statements)', blockedBy: ['B2'] },
      { key: 'B5', kind: 'docs', title: 'Document the built-in drivers', pages: ['drivers'], blockedBy: ['B3', 'B4'] },
    ],
  },
  {
    key: 'C',
    title: '[EPIC] Typed populate ergonomics — findById(id, { populate }) returning typed nested',
    parity: ['parity:mikro-orm'],
    motivation:
      'Populate today is a stringly-typed `findAllWithMany("orders","orders","userId")` and there is no `findById(id, { populate })` overload despite the COOKBOOK showing one. The `Populated<S,K>` type exists (epic #188) but is not wired into the repository. This epic gives ergonomic, typed populate: `findById(1, { populate: ["orders"] })` → parent typed with the nested relation.',
    dod: [
      'Relations are declarable on the schema and discoverable by key (typed `RelationKeys<S>`).',
      '`findById`/`find`/`list` accept `{ populate }` and return `Populated<S, K>` (to-one → object|null, to-many → array), using the existing batched-IN strategy — no proxies.',
      'The stringly `findAllWithMany` is deprecated in favor of the typed API.',
    ],
    subs: [
      { key: 'C1', kind: 'spec', title: 'Typed populate option + result typing', blockedBy: ['A1'] },
      { key: 'C2', kind: 'tests', title: 'Typed populate', blockedBy: ['C1'] },
      { key: 'C3', kind: 'impl', title: 'Typed populate on read methods', blockedBy: ['C2', 'A3'] },
      { key: 'C4', kind: 'docs', title: 'Document typed populate', pages: ['relations', 'populate-results'], blockedBy: ['C3'] },
    ],
  },
  {
    key: 'D',
    title: '[EPIC] End-to-end DX — zero-dep quickstart, connection helpers, examples',
    parity: [],
    motivation:
      'There is no "hello world that talks to a real DB" without assembling four packages and writing a driver. This epic delivers a genuinely runnable getting-started experience: a ~15-line node:sqlite example (zero external deps), a small connection/repository wiring helper, and an examples dir — so a new user is productive in minutes. Depends on typed methods (A), a driver (B), and typed populate (C) so the example shows the real, ergonomic API.',
    dod: [
      'A runnable `examples/` app (node:sqlite) doing define → migrate/create table → typed CRUD → typed list + populate, as an executable spec test.',
      'A one-call wiring helper (schema + driver → typed repository) to remove boilerplate.',
      'Quickstart docs rewritten to the real, runnable flow; verified by running the example in CI.',
    ],
    subs: [
      { key: 'D1', kind: 'spec', title: 'Quickstart contract + wiring helper API', blockedBy: ['A1', 'B1'] },
      { key: 'D2', kind: 'tests', title: 'Runnable node:sqlite example as an E2E spec', blockedBy: ['D1'] },
      { key: 'D3', kind: 'impl', title: 'Wiring helper + examples app', blockedBy: ['D2', 'A3', 'B3', 'C3'] },
      { key: 'D4', kind: 'docs', title: 'Rewrite Quick Start to the runnable flow', pages: ['quick-start', 'installation'], blockedBy: ['D3'] },
    ],
  },
];

// Expand tests right after their spec is implied by explicit keys already; here
// every sub is explicit, so just flatten.
function subTitle(epicKey, s) {
  const prefix =
    s.kind === 'spec' ? '[sub-issue] [Spec Freeze] '
    : s.kind === 'tests' ? '[sub-issue] [Tests Freeze] '
    : s.kind === 'docs' ? '[sub-issue] [Docs] '
    : '[sub-issue] ';
  return `${prefix}${s.title}`.slice(0, 250);
}
function subLabels(s, hasUnmetBlockers) {
  const l = ['sub-issue'];
  if (s.kind === 'spec' || s.kind === 'tests') l.push('spec');
  if (s.kind === 'docs') l.push('documentation');
  if (hasUnmetBlockers) l.push('blocked');
  return l;
}

// A sub is "blocked at filing time" if it has ANY blocker (nothing is closed yet).
const isBlockedAtFiling = (s) => (s.blockedBy && s.blockedBy.length > 0);

function tddGate(kind) {
  if (kind === 'spec')
    return '## TDD gate\n- [ ] Spec frozen BEFORE any test/impl.\n- [ ] Golden type-level + SQL examples enumerated.\n- [ ] Acceptance criteria stated.\n- [ ] No implementation in this issue.';
  if (kind === 'tests')
    return '## TDD gate\n- [ ] Depends on the spec-freeze issue being frozen first.\n- [ ] Tests written and initially FAILING (red) — incl. type-level assertions.\n- [ ] No implementation in this issue.';
  if (kind === 'impl')
    return '## Definition of Done\n- [ ] Spec frozen first; tests red first.\n- [ ] Implementation makes tests green (incl. type-level).\n- [ ] No proxies/identity-map; parameterized SQL; ESM, Node 26, TS 7.\n- [ ] Full suite green + typecheck clean.';
  return '## Definition of Done\n- [ ] Depends on all impl sub-issues green.\n- [ ] Docs pages written with real, verified examples.\n- [ ] Rebuild docs; deploy verified.';
}

function subBody(epicNum, epicTitle, s, blockersText) {
  return [
    `Parent epic: ${epicNum ? '#' + epicNum : '(epic)'} (${epicTitle})`,
    '',
    `## Goal`,
    s.kind === 'spec' ? `Freeze the spec for: **${s.title}** (SPEC & TDD first — no implementation).`
      : s.kind === 'tests' ? `Author FAILING tests for: **${s.title}** (red), including type-level assertions.`
      : s.kind === 'docs' ? `Document: **${s.title}** — pages ${(s.pages || []).map((p) => '`' + p + '`').join(', ')}.`
      : `Implement: **${s.title}**.`,
    '',
    blockersText || '',
    tddGate(s.kind),
  ].join('\n');
}

// ---- run ----
let existing = [];
if (RUN) existing = JSON.parse(gh(['issue', 'list', '--repo', REPO, '--state', 'all', '--limit', '600', '--json', 'number,title']));
const byTitle = (t) => existing.find((i) => i.title === t);

const keyToNum = {}; // sub key -> issue number
let planned = 0;

function create({ title, body, labels }) {
  planned++;
  if (!RUN) { console.log(`  [dry] [${labels.join(',')}] ${title}`); return 0; }
  const found = byTitle(title);
  if (found) { console.log(`  = #${found.number} ${title}`); return found.number; }
  const args = ['issue', 'create', '--repo', REPO, '--title', title, '--body-file', '-'];
  for (const l of labels) args.push('--label', l);
  const num = Number(gh(args, body).split('/').pop());
  existing.push({ number: num, title });
  console.log(`  + #${num} ${title}`);
  return num;
}

console.log(RUN ? '=== FILING (live) ===' : '=== DRY RUN (no gh calls; pass --run) ===');
const epicNums = {};
// Pass 1: create epics + subs (bodies without resolved blocker numbers yet).
for (const e of EPICS) {
  console.log(`\nEPIC ${e.key}: ${e.title}`);
  const epicBody = `# ${e.title}\n\n## Motivation\n${e.motivation}\n\n## Definition of Done\n${e.dod.map((d, i) => `${i + 1}. ${d}`).join('\n')}\n\n## Process\nSPEC & TDD first: every capability is **spec-freeze → tests-freeze → implementation → docs**, and sub-issues **block** each other (see each sub's "Blocked by"). No proxies / no identity map; the DX gaps are closed without reintroducing anti-patterns.\n\n## Sub-issues\n_(populated below)_`;
  const enum_ = create({ title: e.title, body: epicBody, labels: ['epic', ...e.parity] });
  epicNums[e.key] = enum_;
  for (const s of e.subs) {
    const num = create({ title: subTitle(e.key, s), body: subBody(enum_, e.title, s, ''), labels: subLabels(s, isBlockedAtFiling(s)) });
    keyToNum[s.key] = num;
  }
}
// Pass 2 (RUN only): rewrite sub bodies with resolved "Blocked by / Blocks" and
// update the epic checklist.
if (RUN) {
  // build reverse map: key -> keys it blocks
  const blocks = {};
  for (const e of EPICS) for (const s of e.subs) for (const b of s.blockedBy || []) (blocks[b] ||= []).push(s.key);
  for (const e of EPICS) {
    for (const s of e.subs) {
      const bb = (s.blockedBy || []).map((k) => `#${keyToNum[k]}`).join(', ');
      const bl = (blocks[s.key] || []).map((k) => `#${keyToNum[k]}`).join(', ');
      const blockersText =
        (bb ? `## Blocked by\n${bb}\n\n` : '') + (bl ? `## Blocks\n${bl}\n\n` : '');
      const body = subBody(epicNums[e.key], e.title, s, blockersText);
      gh(['issue', 'edit', String(keyToNum[s.key]), '--repo', REPO, '--body-file', '-'], body);
    }
    // epic checklist
    const list = e.subs.map((s) => `- [ ] #${keyToNum[s.key]}${(s.blockedBy || []).length ? ` (blocked by ${(s.blockedBy).map((k) => '#' + keyToNum[k]).join(', ')})` : ''}`).join('\n');
    const epicBody = `# ${e.title}\n\n## Motivation\n${e.motivation}\n\n## Definition of Done\n${e.dod.map((d, i) => `${i + 1}. ${d}`).join('\n')}\n\n## Process\nSPEC & TDD first: spec-freeze → tests-freeze → implementation → docs; sub-issues block each other. No proxies / no identity map.\n\n## Sub-issues\n${list}`;
    gh(['issue', 'edit', String(epicNums[e.key]), '--repo', REPO, '--body-file', '-'], epicBody);
    console.log(`  ~ wired blocking + checklist for epic #${epicNums[e.key]}`);
  }
}
console.log(`\n${RUN ? 'DONE' : 'DRY TALLY'}: ${EPICS.length} epics, ${planned} issues total.`);
