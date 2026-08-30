// File EPIC E: the `zmdb` umbrella / entry-point package (single install that
// re-exports the whole ecosystem). SPEC & TDD first; sub-issues block each
// other and this epic depends on the typed-methods (A) + drivers (B) work so it
// exposes the good, ergonomic API surface. Cross-epic blockers reference the
// already-filed issue numbers.
//
// SAFE: prints plan unless invoked with `--run`.
import { execFileSync } from 'node:child_process';
const REPO = 'ambasta/zmdb';
const RUN = process.argv.includes('--run');
const gh = (args, input) => execFileSync('gh', args, { encoding: 'utf8', input }).trim();

// Cross-epic blockers already filed (from file-dx-epics.mjs run):
//   A1 spec typed reads = #202, A3 impl typed reads = #204,
//   A6 impl typed create/update = #207,
//   B1 driver spec = #210, B3 sqlite driver = #212, B4 pg driver = #213,
//   D1 quickstart spec = #221, D3 wiring+examples = #223
const X = { A1: 202, A3: 204, A6: 207, B1: 210, B3: 212, B4: 213, D1: 221, D3: 223 };

const EPIC = {
  title: '[EPIC] `zmdb` umbrella package — one install, the whole ecosystem',
  parity: [],
  motivation:
    'Today a user must install and assemble four packages (`@zmdb/schema-core`, `@zmdb/query-compiler`, `@zmdb/aot-validator`, `@zmdb/repository`) and know which one each export lives in. That is a real adoption cliff. This epic ships a single **`zmdb`** entry-point package that re-exports the whole ecosystem under one install and a curated top-level API (with the sub-packages still usable directly for tree-shaking / advanced use). Think `import { defineSchema, BaseRepository, is, createQueryCompiler } from "zmdb"`.\n\nIt is sequenced AFTER the typed-repository (epic #201) and driver (epic #209) work so the umbrella exposes the *good* ergonomic surface (typed methods + a built-in driver), not the current untyped one — and the DX quickstart (epic #220) should consume `zmdb` rather than the four sub-packages.',
  dod: [
    'A published `zmdb` package that re-exports the curated public API of all four sub-packages (named re-exports + subpath re-exports where useful), with the sub-packages as its dependencies (exact/caret per the release policy).',
    'A frozen spec for the top-level API surface: what is re-exported at the root, what stays subpath-only, and the no-collision guarantee across packages.',
    'The umbrella builds to dist (.js + .d.ts) and publishes via the same OIDC CI + dist-tag policy (stable > rc > beta > alpha).',
    'Docs + Quick Start updated to install `zmdb` as the default on-ramp (sub-packages documented as the advanced/tree-shakeable path).',
  ],
  subs: [
    // spec first; blocked by the API it will expose being specced (A1) so the
    // curated surface matches the typed methods.
    {
      key: 'E1',
      kind: 'spec',
      title: 'zmdb top-level API surface (what re-exports at root vs subpath, collision policy)',
      blockedByX: ['A1', 'B1'],
      blockedBy: [],
    },
    {
      key: 'E2',
      kind: 'tests',
      title: 'zmdb re-export surface (public API + type-level re-export assertions)',
      blockedByX: [],
      blockedBy: ['E1'],
    },
    {
      key: 'E3',
      kind: 'impl',
      title: 'zmdb package: re-exports + build + publish wiring',
      blockedByX: ['A3', 'A6', 'B3', 'B4'],
      blockedBy: ['E2'],
    },
    {
      key: 'E4',
      kind: 'docs',
      title: 'Make `zmdb` the default install in Quick Start / install docs',
      pages: ['installation', 'quick-start', 'introduction'],
      blockedByX: ['D3'],
      blockedBy: ['E3'],
    },
  ],
};

const subTitle = s =>
  (
    ({
      spec: '[sub-issue] [Spec Freeze] ',
      tests: '[sub-issue] [Tests Freeze] ',
      docs: '[sub-issue] [Docs] ',
      impl: '[sub-issue] ',
    })[s.kind] + s.title
  ).slice(0, 250);
const subLabels = s => {
  const l = ['sub-issue'];
  if (s.kind === 'spec' || s.kind === 'tests') l.push('spec');
  if (s.kind === 'docs') l.push('documentation');
  if ((s.blockedBy && s.blockedBy.length) || (s.blockedByX && s.blockedByX.length)) l.push('blocked');
  return l;
};
const gate = k =>
  k === 'spec'
    ? '## TDD gate\n- [ ] Spec frozen BEFORE any test/impl.\n- [ ] Public re-export surface + collision policy enumerated.\n- [ ] No implementation.'
    : k === 'tests'
      ? '## TDD gate\n- [ ] Depends on spec frozen first.\n- [ ] FAILING tests (red): runtime re-export presence + type-level re-export identity.\n- [ ] No implementation.'
      : k === 'impl'
        ? '## Definition of Done\n- [ ] Spec frozen; tests red first.\n- [ ] `zmdb` re-exports the curated API; builds dist (.js+.d.ts); wired into OIDC publish + dist-tag policy.\n- [ ] No proxies/identity-map; ESM, Node 26, TS 7. Full suite green + typecheck clean.'
        : '## Definition of Done\n- [ ] Depends on impl green.\n- [ ] Quick Start / install docs default to `zmdb`; sub-packages shown as advanced path. Rebuild + deploy verified.';

let existing = [];
if (RUN)
  existing = JSON.parse(
    gh(['issue', 'list', '--repo', REPO, '--state', 'all', '--limit', '700', '--json', 'number,title']),
  );
const byTitle = t => existing.find(i => i.title === t);
const keyToNum = {};
let planned = 0;
function create({ title, body, labels }) {
  planned++;
  if (!RUN) {
    console.log(`  [dry] [${labels.join(',')}] ${title}`);
    return 0;
  }
  const f = byTitle(title);
  if (f) {
    console.log(`  = #${f.number} ${title}`);
    return f.number;
  }
  const args = ['issue', 'create', '--repo', REPO, '--title', title, '--body-file', '-'];
  for (const l of labels) args.push('--label', l);
  const n = Number(gh(args, body).split('/').pop());
  existing.push({ number: n, title });
  console.log(`  + #${n} ${title}`);
  return n;
}
function subBody(epicNum, s, blockersText) {
  return [
    `Parent epic: ${epicNum ? '#' + epicNum : '(epic)'} (${EPIC.title})`,
    '',
    '## Goal',
    s.kind === 'spec'
      ? `Freeze the spec for: **${s.title}** (SPEC & TDD first — no implementation).`
      : s.kind === 'tests'
        ? `Author FAILING tests for: **${s.title}** (red), incl. type-level re-export assertions.`
        : s.kind === 'docs'
          ? `Document: **${s.title}** — pages ${(s.pages || []).map(p => '`' + p + '`').join(', ')}.`
          : `Implement: **${s.title}**.`,
    '',
    blockersText || '',
    gate(s.kind),
  ].join('\n');
}

console.log(RUN ? '=== FILING EPIC E (live) ===' : '=== DRY RUN (pass --run) ===');
const epicBody0 = `# ${EPIC.title}\n\n## Motivation\n${EPIC.motivation}\n\n## Definition of Done\n${EPIC.dod.map((d, i) => `${i + 1}. ${d}`).join('\n')}\n\n## Process\nSPEC & TDD first: spec-freeze → tests-freeze → implementation → docs; sub-issues block each other and this epic is blocked by the typed-repository (#201) + drivers (#209) epics so the umbrella exposes the ergonomic API. No proxies / no identity map.\n\n## Blocked by\nepics #201 (typed repository) and #209 (drivers) — via the sub-issue blockers below.\n\n## Sub-issues\n_(populated below)_`;
const epicNum = create({ title: EPIC.title, body: epicBody0, labels: ['epic', 'blocked', ...EPIC.parity] });
for (const s of EPIC.subs)
  keyToNum[s.key] = create({ title: subTitle(s), body: subBody(epicNum, s, ''), labels: subLabels(s) });

if (RUN) {
  const blocks = {};
  for (const s of EPIC.subs) for (const b of s.blockedBy || []) (blocks[b] ||= []).push(s.key);
  for (const s of EPIC.subs) {
    const bbIntra = (s.blockedBy || []).map(k => `#${keyToNum[k]}`);
    const bbX = (s.blockedByX || []).map(k => `#${X[k]}`);
    const bb = [...bbIntra, ...bbX].join(', ');
    const bl = (blocks[s.key] || []).map(k => `#${keyToNum[k]}`).join(', ');
    const txt = (bb ? `## Blocked by\n${bb}\n\n` : '') + (bl ? `## Blocks\n${bl}\n\n` : '');
    gh(['issue', 'edit', String(keyToNum[s.key]), '--repo', REPO, '--body-file', '-'], subBody(epicNum, s, txt));
  }
  const list = EPIC.subs
    .map(s => {
      const bs = [...(s.blockedBy || []).map(k => '#' + keyToNum[k]), ...(s.blockedByX || []).map(k => '#' + X[k])];
      return `- [ ] #${keyToNum[s.key]}${bs.length ? ` (blocked by ${bs.join(', ')})` : ''}`;
    })
    .join('\n');
  gh(
    ['issue', 'edit', String(epicNum), '--repo', REPO, '--body-file', '-'],
    epicBody0.replace('_(populated below)_', list),
  );
  console.log(`  ~ wired blocking + checklist for epic #${epicNum}`);
}
console.log(`\n${RUN ? 'DONE' : 'DRY TALLY'}: 1 epic, ${planned} issues.`);
