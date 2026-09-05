// zmdb docs manifest — joins the page registry (pages.mjs: navigation +
// per-page {title, status, note}) with the prose in content/<slug>.md and
// exports the {NAV, PAGES} shape the site generator consumes. `group` is
// derived from NAV after pages.mjs validates one owner for every page.
//
// Splitting metadata from prose is what makes a manual this size reviewable: a
// nav change is a diff in pages.mjs, a wording change is a diff in one .md file,
// and neither can silently move the other.
//
//   status:'supported' → the API is real (see the package SPECs / COOKBOOK)
//   status:'todo'      → a legitimate capability that is not built yet. This is
//                        roadmap, not an anti-pattern; `note` says what is missing.
//   status:'wontfix'   → a capability with a frozen design that will not be built.
//                        The page stays, so the answer and the alternative are
//                        findable; `note` says why it was declined.
//
// Anti-patterns are absent from NAV on purpose and enumerated with rationale in
// coverage/mapping.mjs, which the docs-coverage gate reads.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { antiPatterns } from './coverage/mapping.mjs';
import { NAV, PAGE_GROUPS, PAGE_META } from './pages.mjs';

const CONTENT_DIR = join(dirname(fileURLToPath(import.meta.url)), 'content');

const SOURCE_LABEL = {
  drizzle: ['Drizzle ORM', 'https://orm.drizzle.team/docs/'],
  'mikro-orm': ['MikroORM', 'https://mikro-orm.io/docs/'],
  nestjs: ['NestJS', 'https://docs.nestjs.com/'],
  typia: ['Typia', 'https://typia.io/docs/'],
};

// The anti-patterns page is generated from coverage/mapping.mjs rather than
// hand-written, so the list of excluded upstream pages is the same list the
// docs-coverage gate checks. Prose above the marker is authored; everything
// below it is derived, and an excluded page cannot be argued against in the
// mapping without appearing here.
const ANTI_PATTERN_MARKER = '<!-- generated: coverage/mapping.mjs antiPatterns() -->';

function renderAntiPatterns() {
  const entries = antiPatterns();
  const bySource = new Map();
  for (const entry of entries) {
    const bucket = bySource.get(entry.source) ?? [];
    bucket.push(entry);
    bySource.set(entry.source, bucket);
  }

  let md = '';
  for (const [source, bucket] of bySource) {
    const [label, base] = SOURCE_LABEL[source] ?? [source, ''];
    md += `## ${label}\n\n`;
    for (const entry of bucket) {
      const link = base === '' ? `\`${entry.page}\`` : `[\`${entry.page}\`](${base}${entry.page})`;
      md += `### ${link}\n\n${entry.reason}\n\n`;
      md += `**Instead:** [${entry.see}](./${entry.see}.html)\n\n`;
    }
  }
  return md.trimEnd();
}

// A page with no content file is a bug in the registry, not an empty page — the
// generator would silently emit a title with nothing under it. Fail loudly.
function readBody(slug) {
  try {
    const raw = readFileSync(join(CONTENT_DIR, `${slug}.md`), 'utf8');
    if (!raw.includes(ANTI_PATTERN_MARKER)) return raw;
    return raw.replace(ANTI_PATTERN_MARKER, renderAntiPatterns());
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(
        `docs: page "${slug}" is registered in pages.mjs but docs-site/content/${slug}.md does not exist.`,
        { cause: err },
      );
    }
    throw err;
  }
}

export const PAGES = Object.fromEntries(
  Object.entries(PAGE_META).map(([slug, meta]) => [slug, { ...meta, group: PAGE_GROUPS[slug], md: readBody(slug) }]),
);

export { NAV };
