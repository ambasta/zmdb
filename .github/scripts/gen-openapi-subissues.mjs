#!/usr/bin/env node
// Create sub-issues for the JSON Schema / OpenAPI epic (#62), link native
// sub-issue hierarchy + blocked-by chain, and remove the temp checklist.
// Mirrors .github/scripts/gen-subissues.mjs + link-relationships.mjs conventions.
import { execFileSync } from 'node:child_process';

const OWNER = 'ambasta';
const REPO = 'zmdb';
const PARENT = 62;

function gh(args, input) {
  return execFileSync('gh', args, { encoding: 'utf8', input, maxBuffer: 16 * 1024 * 1024 }).trim();
}
function graphql(query, vars) {
  const args = ['api', 'graphql', '-f', `query=${query}`];
  for (const [k, v] of Object.entries(vars ?? {})) args.push('-F', `${k}=${v}`);
  return JSON.parse(gh(args));
}

const TITLE = 'JSON Schema / OpenAPI';
const subs = [
  {
    t: 'Freeze spec: JSON Schema mapping + OpenAPI component contract + determinism',
    goal: 'Freeze the type→JSON-Schema mapping, tag→keyword table, DTO/relation rules, and deterministic output format.',
    depends: 'none',
    spec: [
      'Define toJsonSchema(schema) output for scalars/enum/nullable (draft 2020-12).',
      'Freeze validation-tag → keyword table: Minimum→minimum, Maximum→maximum, MinLength/MaxLength→minLength/maxLength, Pattern→pattern, Enum→enum.',
      'Define DTO-aware rules: CreateDTO/UpdateDTO for request bodies, Entity for responses.',
      'Define relation → $ref / items:{$ref} mapping and toOpenApiComponents aggregation.',
      'Freeze determinism rules (stable key ordering) + golden fixtures.',
    ],
    tests: ['Failing golden tests: toJsonSchema output for a sample schema matches the frozen fixture; determinism (generate twice → identical).'],
    accept: [
      'Committed SPEC.md in packages/schema-core/src/openapi with mapping table + golden fixtures.',
      'Test file compiles and all tests FAIL (no implementation yet).',
    ],
  },
  {
    t: 'Implement toJsonSchema for scalar/enum/nullable columns',
    goal: 'Emit JSON Schema for a table Entity covering scalar types, enums, and nullability.',
    depends: 'the spec-freeze sub-issue',
    spec: ['serial/integer/numeric→number, text/varchar→string, boolean→boolean, timestamp→string(format:date-time), jsonEnum→enum; nullable→type union with null.'],
    tests: ['Make scalar/enum/nullable golden tests pass; required[] excludes hasDefault/nullable per spec.'],
    accept: ['Scalar/enum/nullable JSON Schema tests green.'],
  },
  {
    t: 'Implement validation-tag → JSON Schema keyword mapping',
    goal: 'Fold column validation tags into the emitted JSON Schema keywords.',
    depends: 'toJsonSchema scalars',
    spec: ['Minimum/Maximum/MinLength/MaxLength/Pattern/Enum map to their JSON Schema keywords on the right property.'],
    tests: ['Golden tests: a column with tags.Minimum(0)+tags.MaxLength(255) emits minimum/maxLength on that property.'],
    accept: ['Tag→keyword mapping tests green.'],
  },
  {
    t: 'Implement DTO-aware generation + relation $refs',
    goal: 'Generate distinct schemas for CreateDTO/UpdateDTO/Entity and emit relation $refs.',
    depends: 'tag→keyword mapping',
    spec: ['CreateDTO omits autoIncrement + makes hasDefault optional; UpdateDTO is all-optional; relations → $ref (to-one) / items:{$ref} (to-many).'],
    tests: ['Golden tests: Create vs Update vs Entity differ correctly; relation emits $ref to the target component.'],
    accept: ['DTO-aware + relation $ref tests green.'],
  },
  {
    t: 'Implement toOpenApiComponents + determinism + E2E golden document',
    goal: 'Aggregate multiple schemas into components.schemas and prove a full deterministic OpenAPI 3.1 fragment.',
    depends: 'DTO-aware generation',
    spec: ['toOpenApiComponents([...]) builds components.schemas with stable ordering; output is byte-stable across runs.'],
    tests: ['E2E golden test: [UserSchema, OrderSchema] → committed OpenAPI components fixture; determinism test (twice → identical).'],
    accept: ['E2E OpenAPI golden + determinism tests green.', 'Closing this + prior subs fully resolves the parent epic.'],
  },
];

function buildBody(sub) {
  const L = [];
  L.push(`Parent epic: #${PARENT} (${TITLE})`, '');
  L.push('## Goal', sub.goal, '');
  L.push('## Depends on', sub.depends === 'none' ? 'Nothing — this is the spec-freeze starting point (TDD).' : `Previous sub-issue(s): ${sub.depends}.`, '');
  L.push('## Spec / Behavior', ...sub.spec.map((s) => `- ${s}`), '');
  L.push('## TDD Test Plan (write failing tests first)', ...sub.tests.map((t) => `- ${t}`), '');
  L.push('## Acceptance Criteria', ...sub.accept.map((a) => `- [ ] ${a}`), '');
  L.push('## Definition of Done');
  L.push('- [ ] Tests written first and initially failing (red).');
  L.push('- [ ] Implementation makes tests pass (green).');
  L.push('- [ ] No architecture violations (no runtime reflection, ESM-only, Node 26+, TS 7).');
  return L.join('\n');
}

// 1. Create sub-issues.
const created = [];
subs.forEach((sub, idx) => {
  const title = `[${TITLE}] ${idx === 0 ? 'Spec Freeze: ' : ''}${sub.t}`;
  const labels = idx === 0 ? 'sub-issue,spec' : 'sub-issue';
  const url = gh(['issue', 'create', '--repo', `${OWNER}/${REPO}`, '--title', title, '--body-file', '-', '--label', labels], buildBody(sub));
  const num = Number(url.split('/').pop());
  created.push({ num, title });
  console.log(`created #${num} ${title}`);
});

// 2. Resolve node IDs.
const id = {};
for (const n of [PARENT, ...created.map((c) => c.num)]) {
  const r = graphql('query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){issue(number:$n){id}}}', { o: OWNER, r: REPO, n });
  id[n] = r.data.repository.issue.id;
}

const ADD_SUB = 'mutation($p:ID!,$c:ID!){addSubIssue(input:{issueId:$p,subIssueId:$c}){issue{number}}}';
const ADD_BLOCKED = 'mutation($i:ID!,$b:ID!){addBlockedBy(input:{issueId:$i,blockingIssueId:$b}){issue{number}}}';

// 3. Native sub-issue hierarchy.
for (const c of created) {
  graphql(ADD_SUB, { p: id[PARENT], c: id[c.num] });
  console.log(`sub-issue: #${PARENT} <- #${c.num}`);
}
// 4. Linear blocked-by chain.
for (let i = 1; i < created.length; i++) {
  graphql(ADD_BLOCKED, { i: id[created[i].num], b: id[created[i - 1].num] });
  console.log(`blocked-by: #${created[i].num} <- #${created[i - 1].num}`);
}
// 5. Epic blocked by its spec-freeze.
graphql(ADD_BLOCKED, { i: id[PARENT], b: id[created[0].num] });
console.log(`blocked-by: epic #${PARENT} <- spec #${created[0].num}`);

console.log('DONE');
