#!/usr/bin/env node
// Create sub-issues for the Benchmarking epic (#68), link native sub-issue
// hierarchy + blocked-by chain. Mirrors gen-openapi-subissues.mjs conventions.
import { execFileSync } from 'node:child_process';

const OWNER = 'ambasta';
const REPO = 'zmdb';
const PARENT = 68;
const TITLE = 'Benchmarking';

function gh(args, input) {
  return execFileSync('gh', args, { encoding: 'utf8', input, maxBuffer: 16 * 1024 * 1024 }).trim();
}
function graphql(query, vars) {
  const args = ['api', 'graphql', '-f', `query=${query}`];
  for (const [k, v] of Object.entries(vars ?? {})) args.push('-F', `${k}=${v}`);
  return JSON.parse(gh(args));
}

const subs = [
  {
    t: 'Freeze spec: harness layout, result schema (incl. DNF), and case matrices',
    goal: 'Freeze the benchmarks/ workspace layout, the result record schema (numeric scores AND a first-class DNF value with reason), and the two case matrices (validation + ORM).',
    depends: 'none',
    spec: [
      'Define benchmarks/ workspace layout (validation/ + orm/ + shared results schema).',
      'Freeze Result type: { case, target, opsPerSec?, status: "ok" | "dnf", dnfReason? }.',
      'Freeze the validation case matrix (Safe/Strict Parsing, Loose/Strict Assertion) mapped to zmdb entry points.',
      'Freeze the ORM case matrix (point lookup, list/pagination, joins, aggregation, prepared reuse) + the anti-pattern DNF rows.',
      'Freeze DNF rules: anti-pattern -> "dnf (anti-pattern)"; supported-but-unimplemented -> "dnf (not implemented)"; never silently skipped.',
    ],
    tests: [
      'Failing tests: a results-schema validator accepts a golden results fixture including DNF rows; rejects a fixture that omits an in-scope case (must be present as ok or dnf).',
    ],
    accept: [
      'Committed benchmarks/SPEC.md with layout, result schema, case matrices, and DNF rules.',
      'Test file compiles and all tests FAIL (no implementation yet).',
    ],
  },
  {
    t: 'Validation-suite adapter + runner (vs Typia/Zod/TypeBox/Ajv)',
    goal: 'Implement a zmdb "library" adapter exposing the four validation cases and a runner producing Result records.',
    depends: 'the spec-freeze sub-issue',
    spec: [
      'Adapter maps Safe Parsing->parse(strip), Strict Parsing->parse(strict)/equals, Loose Assertion->is/assert, Strict Assertion->assertEquals.',
      'Runner benchmarks each case, emits Result[] including any DNF.',
    ],
    tests: [
      'Tests: adapter produces correct pass/fail for a known-good and known-bad payload per case; runner emits a Result per case.',
    ],
    accept: ['Validation adapter + runner tests green; all four cases report ok (no DNF expected here).'],
  },
  {
    t: 'ORM-suite adapter: server + query set + seed (vs Drizzle/Prisma/Kysely)',
    goal: 'Port the drizzle-benchmarks workload: seed an e-commerce dataset and expose the query set through a zmdb-backed server.',
    depends: 'validation-suite adapter',
    spec: [
      'Seed script (pinned dataset size) + PostgreSQL setup.',
      'Query set: point lookups, filtered list/pagination, nested order+items via populate, aggregations, prepared reuse.',
      'Anti-pattern cases (lazy proxy graphs, identity-map dedup, active-record save) are wired as explicit DNF(anti-pattern) entries.',
    ],
    tests: [
      'Tests: each supported query returns correct rows against a seeded ephemeral DB; DNF entries present for anti-pattern cases.',
    ],
    accept: ['ORM adapter tests green; supported queries correct; anti-pattern cases emit DNF(anti-pattern).'],
  },
  {
    t: 'DNF reporting + comparative results table generator',
    goal: 'Aggregate Result[] from both suites into a deterministic Markdown + JSON report where DNF is visible alongside numeric scores.',
    depends: 'ORM-suite adapter',
    spec: [
      'Generator writes benchmarks/RESULTS.md (+ results.json), stable ordering.',
      'DNF rows render explicitly with reason; never omitted.',
      'Any in-scope case missing from inputs is surfaced as an error, not skipped.',
    ],
    tests: [
      'Tests: generator renders a fixture Result[] (mixed ok + DNF) to the expected Markdown; errors if an in-scope case is absent.',
    ],
    accept: ['Report generator tests green; RESULTS.md shows ok + DNF rows deterministically.'],
  },
  {
    t: 'CI job runs both suites + publishes results + regression guardrails',
    goal: 'Wire CI to run both suites, publish RESULTS.md, and fail on unexpected regressions / newly-appearing DNFs.',
    depends: 'DNF reporting + results generator',
    spec: [
      'CI matrix runs validation + ORM suites (ORM against an ephemeral Postgres service).',
      'Publishes/updates benchmarks/RESULTS.md as an artifact.',
      'Guardrail: fail if a previously-ok case becomes DNF, or drops beyond an agreed threshold.',
    ],
    tests: ['Tests: guardrail logic flags ok->DNF transitions and threshold breaches on fixture inputs.'],
    accept: ['CI + guardrail tests green.', 'Closing this + prior subs fully resolves the parent epic.'],
  },
];

function buildBody(sub, _idx) {
  const L = [];
  L.push(`Parent epic: #${PARENT} (${TITLE})`, '');
  L.push('## Goal', sub.goal, '');
  L.push(
    '## Depends on',
    sub.depends === 'none'
      ? 'Nothing — this is the spec-freeze starting point (TDD).'
      : `Previous sub-issue(s): ${sub.depends}.`,
    '',
  );
  L.push('## Spec / Behavior', ...sub.spec.map(s => `- ${s}`), '');
  L.push('## TDD Test Plan (write failing tests first)', ...sub.tests.map(t => `- ${t}`), '');
  L.push('## Acceptance Criteria', ...sub.accept.map(a => `- [ ] ${a}`), '');
  L.push('## Definition of Done');
  L.push('- [ ] Tests written first and initially failing (red).');
  L.push('- [ ] Implementation makes tests pass (green).');
  L.push('- [ ] Honesty policy respected: no in-scope case silently skipped; DNF reported with reason.');
  return L.join('\n');
}

const created = [];
subs.forEach((sub, idx) => {
  const title = `[${TITLE}] ${idx === 0 ? 'Spec Freeze: ' : ''}${sub.t}`;
  const labels = idx === 0 ? 'sub-issue,spec' : 'sub-issue';
  const url = gh(
    ['issue', 'create', '--repo', `${OWNER}/${REPO}`, '--title', title, '--body-file', '-', '--label', labels],
    buildBody(sub, idx),
  );
  const num = Number(url.split('/').pop());
  created.push({ num, title });
  console.log(`created #${num} ${title}`);
});

const id = {};
for (const n of [PARENT, ...created.map(c => c.num)]) {
  const r = graphql('query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){issue(number:$n){id}}}', {
    o: OWNER,
    r: REPO,
    n,
  });
  id[n] = r.data.repository.issue.id;
}
const ADD_SUB = 'mutation($p:ID!,$c:ID!){addSubIssue(input:{issueId:$p,subIssueId:$c}){issue{number}}}';
const ADD_BLOCKED = 'mutation($i:ID!,$b:ID!){addBlockedBy(input:{issueId:$i,blockingIssueId:$b}){issue{number}}}';
for (const c of created) {
  graphql(ADD_SUB, { p: id[PARENT], c: id[c.num] });
  console.log(`sub-issue: #${PARENT} <- #${c.num}`);
}
for (let i = 1; i < created.length; i++) {
  graphql(ADD_BLOCKED, { i: id[created[i].num], b: id[created[i - 1].num] });
  console.log(`blocked-by: #${created[i].num} <- #${created[i - 1].num}`);
}
graphql(ADD_BLOCKED, { i: id[PARENT], b: id[created[0].num] });
console.log(`blocked-by: epic #${PARENT} <- spec #${created[0].num}`);
console.log('DONE');
