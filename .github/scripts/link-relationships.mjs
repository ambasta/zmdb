#!/usr/bin/env node
// Establish NATIVE GitHub relationships:
//   1. Sub-issue hierarchy (epic -> children) via addSubIssue
//   2. Dependency chain (blocked-by) via addBlockedBy, following each epic's
//      ordered "Depends on" sequence (spec-freeze first, then linear chain).
// Node 26+, ESM. Run: node .github/scripts/link-relationships.mjs
import { execFileSync } from 'node:child_process';

const OWNER = 'ambasta';
const REPO = 'zmdb';

function gh(args, input) {
  return execFileSync('gh', args, { encoding: 'utf8', input, maxBuffer: 16 * 1024 * 1024 }).trim();
}
function graphql(query, vars) {
  const args = ['api', 'graphql', '-f', `query=${query}`];
  for (const [k, v] of Object.entries(vars ?? {})) args.push('-F', `${k}=${v}`);
  return JSON.parse(gh(args));
}

// Epic -> ordered list of child issue numbers (order == dependency chain).
const EPICS = {
  1: [11, 12, 13, 14, 15],
  2: [16, 17, 18, 19, 20],
  3: [21, 22, 23, 24],
  4: [25, 26, 27, 28, 29],
  5: [30, 31, 32, 33, 34],
  6: [35, 36, 37, 38, 39],
  7: [40, 41, 42, 43, 44],
  8: [45, 46, 47, 48, 49, 50],
  9: [51, 52, 53, 54, 55],
  10: [56, 57, 58, 59, 60, 61],
};

// Resolve node IDs for every issue number we touch.
const numbers = new Set();
for (const [epic, subs] of Object.entries(EPICS)) {
  numbers.add(Number(epic));
  for (const s of subs) numbers.add(s);
}
const id = {};
for (const n of numbers) {
  const r = graphql(
    'query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){issue(number:$n){id}}}',
    { o: OWNER, r: REPO, n },
  );
  id[n] = r.data.repository.issue.id;
}
console.log(`resolved ${Object.keys(id).length} node ids`);

const ADD_SUB = 'mutation($p:ID!,$c:ID!){addSubIssue(input:{issueId:$p,subIssueId:$c}){issue{number}}}';
const ADD_BLOCKED = 'mutation($i:ID!,$b:ID!){addBlockedBy(input:{issueId:$i,blockingIssueId:$b}){issue{number}}}';

for (const [epic, subs] of Object.entries(EPICS)) {
  const parentId = id[epic];

  // 1. Native sub-issue hierarchy: attach each child to the epic.
  for (const s of subs) {
    try {
      graphql(ADD_SUB, { p: parentId, c: id[s] });
      console.log(`sub-issue: #${epic} <- #${s}`);
    } catch (e) {
      console.log(`SKIP sub-issue #${epic} <- #${s}: ${String(e).split('\n')[0]}`);
    }
  }

  // 2. Dependency chain: each sub (after the first) is blocked by the previous.
  for (let i = 1; i < subs.length; i++) {
    const cur = subs[i];
    const prev = subs[i - 1];
    try {
      graphql(ADD_BLOCKED, { i: id[cur], b: id[prev] });
      console.log(`blocked-by: #${cur} <- #${prev}`);
    } catch (e) {
      console.log(`SKIP blocked-by #${cur} <- #${prev}: ${String(e).split('\n')[0]}`);
    }
  }

  // 3. The epic itself is blocked by its spec-freeze sub (must freeze specs first).
  try {
    graphql(ADD_BLOCKED, { i: parentId, b: id[subs[0]] });
    console.log(`blocked-by: epic #${epic} <- spec #${subs[0]}`);
  } catch (e) {
    console.log(`SKIP epic blocked-by #${epic} <- #${subs[0]}: ${String(e).split('\n')[0]}`);
  }
}

console.log('DONE');
