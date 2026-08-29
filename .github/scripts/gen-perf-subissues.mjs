#!/usr/bin/env node
// Sub-issues for the perf/DNF epics #75-#78 (AOT plugin, JOINs, aggregations,
// FTS). Standard structure: spec-freeze first, linear blocked-by chain, native
// sub-issue hierarchy, epic blocked-by its spec-freeze.
import { execFileSync } from 'node:child_process';
const OWNER = 'ambasta', REPO = 'zmdb';
function gh(a, i) { return execFileSync('gh', a, { encoding: 'utf8', input: i, maxBuffer: 16 * 1024 * 1024 }).trim(); }
function graphql(q, v) { const a = ['api', 'graphql', '-f', `query=${q}`]; for (const [k, val] of Object.entries(v ?? {})) a.push('-F', `${k}=${val}`); return JSON.parse(gh(a)); }

const EPICS = [
  {
    parent: 75, title: 'AOT Plugin',
    subs: [
      { t: 'Freeze spec: plugin packaging + <T>→inlined-JS contract + benchmark target', depends: 'none',
        spec: ['Define the transformer plugin surface (ts-patch/unplugin) and how is<T>/assert<T>/validate<T> are recognized.', 'Freeze the emitted-JS contract: monomorphic, allocation-free, early-exit; no TypeDescriptor walk.', 'Freeze the benchmark acceptance target: AOT ≥5× runtime and competitive with typia/TypeBox on the moltar suite.'],
        tests: ['Failing golden tests: given a source using is<T>()/assert<T>(), expect specific inlined JS (string compare).'],
        accept: ['Committed SPEC.md with before/after fixtures + the acceptance target.', 'Tests compile and FAIL.'] },
      { t: 'Type-driven codegen from a real TS type T (not a runtime descriptor)', depends: 'the spec-freeze sub-issue',
        spec: ['Read the checked type from the TS checker; emit straight-line per-field checks with early return false.', 'Handle nested objects, arrays, unions, optional/nullable.'],
        tests: ['Golden tests: nested object type → expected inlined validator; behavior tests (valid/invalid).'],
        accept: ['Codegen tests green for object/array/union/nested.'] },
      { t: 'Package as ts-patch / unplugin build plugin + fixture build', depends: 'type-driven codegen',
        spec: ['Ship a plugin consumable via ts-patch and unplugin; a fixture project builds with it and emits inlined output.'],
        tests: ['Integration test: build the fixture; assert is<T>()/assert<T>() calls are replaced (no descriptor walk in output).'],
        accept: ['Fixture build emits inlined validators; integration test green.'] },
      { t: 'Re-run moltar suite with the AOT build + record real numbers', depends: 'the plugin package',
        spec: ['Run the upstream runner with the transformer-built zmdb-aot; capture ops/s.'],
        tests: ['Test asserting the AOT build output matches the hand-inlined golden shape.'],
        accept: ['RESULTS.md updated with transformer-produced (not hand-inlined) AOT numbers.'] },
      { t: 'Acceptance gate: AOT ≥5× runtime & competitive with typia/TypeBox (or revise the claim)', depends: 'the re-run',
        spec: ['Compare AOT vs runtime and vs typia/TypeBox; if the target is missed, document why and update the architecture claim honestly.'],
        tests: ['Guardrail test: AOT ops/s ≥ 5× runtime ops/s on assert/parse fixtures.'],
        accept: ['Acceptance target met and asserted, OR an honest written revision of the AOT claim.', 'Closing this + prior subs fully resolves the epic.'] },
    ],
  },
  {
    parent: 76, title: 'JOINs',
    subs: [
      { t: 'Freeze spec: join grammar + golden SQL per dialect + aliasing', depends: 'none',
        spec: ['Define innerJoin/leftJoin/rightJoin + on() predicate grammar.', 'Freeze golden SQL per dialect + table/column aliasing rules.'],
        tests: ['Failing golden SQL tests for each join kind + a self-join with alias.'],
        accept: ['Committed SPEC.md with golden join SQL.', 'Tests compile and FAIL.'] },
      { t: 'Implement inner/left/right join + on() compilation', depends: 'the spec-freeze sub-issue',
        spec: ['Compile joins to parameterized, dialect-correct SQL; compose with where/order/limit.'],
        tests: ['Golden tests pass for each join kind across dialects.'],
        accept: ['Join compilation tests green.'] },
      { t: 'Self-join + multi-join + aliasing', depends: 'join compilation',
        spec: ['Support aliased self-joins (employees→recipient) and 2+ chained joins.'],
        tests: ['Golden tests: self-join with alias; product→supplier; multi-join.'],
        accept: ['Self/multi-join tests green.'] },
      { t: 'Repository integration + E2E on real Postgres', depends: 'self/multi-join',
        spec: ['Typed joined-result mapping in the repository; plain rows (no proxies).'],
        tests: ['E2E on real Postgres: employee-with-recipient + product-with-supplier return correct rows.'],
        accept: ['Join E2E green on real Postgres.'] },
      { t: 'Re-run the DNF drizzle-bench join routes; confirm they now serve', depends: 'repository integration',
        spec: ['The previously-501 join routes serve 200 with correct rows; record throughput.'],
        tests: ['Harness check: /employee-with-recipient and /product-with-supplier return 200; k6 records throughput.'],
        accept: ['Formerly-DNF join routes now served; RESULTS.md updated.', 'Closing this + prior subs fully resolves the epic.'] },
    ],
  },
  {
    parent: 77, title: 'Aggregations',
    subs: [
      { t: 'Freeze spec: aggregate/select-expression grammar + golden SQL + result typing', depends: 'none',
        spec: ['Define count/sum/avg/min/max + arithmetic select expressions, groupBy, having.', 'Freeze golden SQL + computed-column result typing.'],
        tests: ['Failing golden SQL tests for grouped aggregates + computed columns.'],
        accept: ['Committed SPEC.md.', 'Tests compile and FAIL.'] },
      { t: 'Implement aggregate functions + arithmetic select expressions', depends: 'the spec-freeze sub-issue',
        spec: ['count/sum/avg/min/max + expressions like sum(qty*price)::real.'],
        tests: ['Golden tests for each aggregate + arithmetic expression.'],
        accept: ['Aggregate expression tests green.'] },
      { t: 'Implement groupBy + having', depends: 'aggregate functions',
        spec: ['groupBy(cols) + having(predicate) compilation, composable with join+where.'],
        tests: ['Golden tests: grouped + having; grouped + joined.'],
        accept: ['groupBy/having tests green.'] },
      { t: 'Repository integration (typed computed columns) + E2E on real Postgres', depends: 'groupBy/having',
        spec: ['Repository returns typed computed columns; E2E against Northwind aggregates.'],
        tests: ['E2E: orders-with-details aggregate returns correct count/sum.'],
        accept: ['Aggregate E2E green on real Postgres.'] },
      { t: 'Re-run the DNF aggregate routes; confirm 200 + correct aggregates', depends: 'repository integration',
        spec: ['/orders-with-details and /order-with-details serve 200 with correct aggregates; record throughput.'],
        tests: ['Harness check: both aggregate routes 200 + correct; k6 throughput recorded.'],
        accept: ['Formerly-DNF aggregate routes served; RESULTS.md updated.', 'Closing this + prior subs fully resolves the epic.'] },
    ],
  },
  {
    parent: 78, title: 'Full-text search',
    subs: [
      { t: 'Freeze spec: FTS predicate grammar + per-dialect golden SQL + DNF map', depends: 'none',
        spec: ['Define whereMatch(column, term) → to_tsvector(col) @@ to_tsquery($1) for Postgres.', 'Freeze the honest per-dialect FTS map (pg tsvector; sqlite FTS5; mysql MATCH…AGAINST; DNF where absent).'],
        tests: ['Failing golden SQL test for the Postgres FTS predicate.'],
        accept: ['Committed SPEC.md with per-dialect FTS map.', 'Tests compile and FAIL.'] },
      { t: 'Implement Postgres to_tsvector/@@/to_tsquery compilation', depends: 'the spec-freeze sub-issue',
        spec: ['Parameterized FTS predicate compilation for Postgres, composable with where.'],
        tests: ['Golden test: whereMatch compiles to the expected parameterized SQL.'],
        accept: ['FTS compilation test green.'] },
      { t: 'Repository integration + E2E on real Postgres', depends: 'FTS compilation',
        spec: ['Repository FTS query returns matching rows against Northwind.'],
        tests: ['E2E: search company_name / product name returns matches.'],
        accept: ['FTS E2E green on real Postgres.'] },
      { t: 'Re-run /search-customer + /search-product; confirm they serve', depends: 'repository integration',
        spec: ['Both search routes serve 200 with correct rows instead of 501.'],
        tests: ['Harness check: both search routes 200 + correct rows.'],
        accept: ['Formerly-DNF search routes served; RESULTS.md updated.', 'Closing this + prior subs fully resolves the epic.'] },
    ],
  },
];

const ADD_SUB = 'mutation($p:ID!,$c:ID!){addSubIssue(input:{issueId:$p,subIssueId:$c}){issue{number}}}';
const ADD_BLOCKED = 'mutation($i:ID!,$b:ID!){addBlockedBy(input:{issueId:$i,blockingIssueId:$b}){issue{number}}}';

function body(epic, sub, idx) {
  const L = [`Parent epic: #${epic.parent} (${epic.title})`, ''];
  L.push('## Goal', sub.t, '');
  L.push('## Depends on', sub.depends === 'none' ? 'Nothing — spec-freeze starting point (TDD).' : `Previous: ${sub.depends}.`, '');
  L.push('## Spec / Behavior', ...sub.spec.map(s => `- ${s}`), '');
  L.push('## TDD Test Plan (failing tests first)', ...sub.tests.map(t => `- ${t}`), '');
  L.push('## Acceptance Criteria', ...sub.accept.map(a => `- [ ] ${a}`), '');
  L.push('## Definition of Done', '- [ ] Tests written first and initially failing (red).', '- [ ] Implementation makes tests pass (green).', '- [ ] No architecture violations (no proxies/identity-map; parameterized SQL; ESM, Node 26, TS 7).');
  return L.join('\n');
}

for (const epic of EPICS) {
  const created = [];
  epic.subs.forEach((sub, idx) => {
    const title = `[${epic.title}] ${idx === 0 ? 'Spec Freeze: ' : ''}${sub.t}`;
    const labels = idx === 0 ? 'sub-issue,spec' : 'sub-issue';
    const url = gh(['issue', 'create', '--repo', `${OWNER}/${REPO}`, '--title', title, '--body-file', '-', '--label', labels], body(epic, sub, idx));
    created.push(Number(url.split('/').pop()));
    console.log(`created #${created.at(-1)} ${title}`);
  });
  const id = {};
  for (const n of [epic.parent, ...created]) id[n] = graphql('query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){issue(number:$n){id}}}', { o: OWNER, r: REPO, n }).data.repository.issue.id;
  for (const c of created) graphql(ADD_SUB, { p: id[epic.parent], c: id[c] });
  for (let i = 1; i < created.length; i++) graphql(ADD_BLOCKED, { i: id[created[i]], b: id[created[i - 1]] });
  graphql(ADD_BLOCKED, { i: id[epic.parent], b: id[created[0]] });
  console.log(`linked epic #${epic.parent}: ${created.length} subs`);
}
console.log('DONE');
