// Turns the roadmap data in ./epics/*.mjs into issue bodies.
//
// The bodies are generated rather than hand-written in the GitHub UI for one reason: there are
// ~200 of them and they have to say the same things in the same order, or the ones written last
// will be thinner than the ones written first. The data files carry the content that differs; this
// file carries the shape that must not.
//
// Every rendered sub-issue answers, in order: what usable thing exists when it closes, why it is
// shaped that way given ARCHITECTURE.md, which files change, what the exact API surface is, the
// steps, the named tests, the gate commands, and the boxes to tick. A developer should not have to
// ask a question that is answerable from the repo.

/** Docs-site content path for a slug, so a reader can go read what the gap page already argues. */
const pageRef = slug => `\`${slug}\` (docs-site/content/${slug}.md)`;

const bullets = (lines, prefix = '- ') => lines.map(l => `${prefix}${l}`).join('\n');

const numbered = lines => lines.map((l, i) => `${i + 1}. ${l}`).join('\n');

const boxes = lines => lines.map(l => `- [ ] ${l}`).join('\n');

const section = (heading, body) => (body ? `## ${heading}\n\n${body}\n` : '');

const code = (lang, body) => (body ? `\`\`\`${lang}\n${body.trim()}\n\`\`\`` : '');

/** The gates every change in this repo has to clear, plus whatever the sub-issue adds. */
const GATES = [
  '`npx vitest run` — the whole suite, not only the new file',
  '`node scripts/typecheck.mjs` — all 13 projects, which is what compiles `*.type-test.ts`',
  '`yarn lint && yarn fmt:check`',
  '`yarn validate:spec` — every `SPEC.md` checklist item resolved',
];

const DOCS_GATES = [
  '`node docs-site/build.mjs` — the page builds and the nav resolves',
  '`yarn verify:docs-coverage` — the upstream page inventory still accounts for every page',
];

export function renderEpic(epic) {
  const pages = epic.pages.map(pageRef).join(', ');
  return [
    `# ${epic.title}\n`,
    section('The gap', epic.motivation.trim()),
    section(
      'Docs pages this closes',
      `${pages}\n\nEach is currently \`status: 'todo'\` in \`docs-site/pages.mjs\` with a note saying what is ` +
        `missing. When this epic closes, every one of them flips to \`status: 'supported'\` and its body stops ` +
        `describing a workaround.`,
    ),
    section('Definition of Done', numbered(epic.dod)),
    section(
      'Architecture constraints',
      `${bullets(epic.invariants)}\n\nThese are not preferences. A slice that violates one is rejected however ` +
        `convenient it is — see ARCHITECTURE.md §2.`,
    ),
    section(
      'Process',
      'Spec first, then failing tests, then implementation, then docs — the order in ARCHITECTURE.md §6 and ' +
        'PRD REQ-NF-10. The spec-freeze sub-issue lands no runtime code at all; the tests-freeze sub-issue ' +
        'lands tests that fail for the right reason. Every implementation slice after that is independently ' +
        'shippable and leaves the suite green.\n\n' +
        'This epic is independent of every other epic: it can be picked up without waiting on one. Individual ' +
        'sub-issue dependencies are recorded only through GitHub native blocked-by relationships.',
    ),
    epic.nonGoals?.length ? section('Non-goals', bullets(epic.nonGoals)) : '',
    section('Sub-issues', '_Filled in by `scripts/roadmap/file-issues.mjs` once the children exist._'),
  ]
    .filter(Boolean)
    .join('\n');
}

export function renderSub(sub, epic, epicNumber) {
  const pages = (sub.pages ?? epic.pages).map(pageRef).join(', ');
  const gates = [...GATES, ...(sub.docs ? DOCS_GATES : []), ...(sub.gates ?? [])];
  return [
    `**Parent epic:** #${epicNumber} — ${epic.title.replace('[EPIC] ', '')}`,
    `**Package(s):** ${epic.packages.map(p => `\`${p}\``).join(', ')}`,
    `**Docs page(s):** ${pages}\n`,
    section('Goal', sub.goal.trim()),
    sub.why ? section('Why this shape', sub.why.trim()) : '',
    sub.files?.length ? section('Files', bullets(sub.files)) : '',
    sub.api ? section('API surface', code('ts', sub.api)) : '',
    sub.steps?.length ? section('Implementation steps', numbered(sub.steps)) : '',
    sub.tests?.length
      ? section(
          'Test plan',
          `${bullets(sub.tests)}\n\nTest titles are load-bearing: \`tests/api-coverage/mapping.mjs\` cites them ` +
            `by exact text, so renaming one is a build failure rather than a silent weakening.`,
        )
      : '',
    section('Gates', bullets(gates)),
    section('Definition of Done', boxes(sub.dod)),
  ]
    .filter(Boolean)
    .join('\n');
}

/** The `- [ ] #12 title` list appended to an epic once its children have numbers. */
export function renderChecklist(children) {
  return children.map(c => `- [ ] #${c.number} — ${c.shortTitle}`).join('\n');
}
