#!/usr/bin/env node
// Re-harvests docs-site/coverage/inventory.mjs from the four upstream docs repos.
//
// Needs network. Not run in CI — the point of the inventory is that it is pinned,
// so a competitor publishing a page must not turn our build red at 3am. Run this
// by hand when you want to check whether they have shipped anything new:
//
//   node .github/scripts/refresh-docs-inventory.mjs            # report drift only
//   node .github/scripts/refresh-docs-inventory.mjs --write     # rewrite the file
//
// With --write the SOURCES commits are re-pinned to each repo's current branch
// head, so the diff tells you exactly which pages appeared or disappeared, and
// `yarn verify:docs-coverage` then tells you which of them you have not mapped.
//
// We read the docs *source trees* via the GitHub git-trees API rather than
// scraping sitemaps: docs.nestjs.com serves an Angular shell with no doc hrefs in
// it, orm.drizzle.team has no sitemap at all, and a rendered site can move under
// a CDN without the content changing.

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const INVENTORY_PATH = join(ROOT, 'docs-site', 'coverage', 'inventory.mjs');

const { SOURCES, INVENTORY } = await import(INVENTORY_PATH);

const WRITE = process.argv.includes('--write');
const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;

// The exclusions below are the ones documented in inventory.mjs. They are
// encoded here so a refresh reproduces the same denominator rather than
// silently widening it.
const EXCLUDE = [
  /(^|\/)latest-releases\//, // drizzle changelogs
  /(^|\/)upgrad(e|ing)-/, // version upgrade guides
  /(^|\/)get-started\//, // drizzle per-driver get-started forks
  /(^|\/)(enterprise|support|who-uses|sustainability|awesome|discover)$/,
  /(^|\/)(index|meta|_meta|_app|_document)$/,
  /(^|\/)migrating-/,
];

// Drizzle re-publishes the same concept page once per dialect under a
// dialect-suffixed path; we keep the unsuffixed concept page only.
const DIALECT_SUFFIX = /-(postgresql|postgres|mysql|sqlite|singlestore|cockroach|mssql|gel)(-new|-existing)?$/;

async function api(path) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'zmdb-docs-inventory',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) {
    throw new Error(
      `GET ${path} -> ${res.status} ${res.statusText}` +
        (res.status === 403 ? ' (rate limited — set GITHUB_TOKEN)' : ''),
    );
  }
  return res.json();
}

async function harvest(key, src) {
  const head = await api(`/repos/${src.repo}/commits/${src.branch}`);
  const commit = head.sha;
  const tree = await api(`/repos/${src.repo}/git/trees/${commit}?recursive=1`);
  if (tree.truncated) throw new Error(`${key}: tree response truncated; harvest by subdirectory`);

  const prefix = `${src.contentDir}/`;
  const pages = new Set();

  for (const node of tree.tree) {
    if (node.type !== 'blob') continue;
    if (!node.path.startsWith(prefix)) continue;
    const rel = node.path.slice(prefix.length);
    const m = /^(.+)\.(md|mdx)$/.exec(rel);
    if (!m) continue;
    let slug = m[1];
    // Drizzle nests each concept page in a per-dialect folder in some sections.
    if (slug.endsWith('/index')) slug = slug.slice(0, -'/index'.length);
    if (EXCLUDE.some(re => re.test(slug))) continue;
    if (key === 'drizzle' && DIALECT_SUFFIX.test(slug)) {
      // keep the seven per-dialect get-started pages, drop the ~55 concept forks
      if (!slug.startsWith('get-started-')) continue;
    }
    pages.add(slug);
  }

  return { commit, pages: [...pages].toSorted() };
}

const results = {};
let drifted = false;

for (const [key, src] of Object.entries(SOURCES)) {
  const { commit, pages } = await harvest(key, src);
  const before = new Set(INVENTORY[key]);
  const after = new Set(pages);
  const added = pages.filter(p => !before.has(p));
  const removed = INVENTORY[key].filter(p => !after.has(p));

  results[key] = { ...src, commit, pages };

  const moved = commit !== src.commit;
  console.log(
    `${src.label.padEnd(12)} ${String(pages.length).padStart(3)} pages ` +
      `(was ${INVENTORY[key].length})  ${moved ? `${src.commit.slice(0, 8)} -> ${commit.slice(0, 8)}` : 'unchanged'}`,
  );
  for (const p of added) console.log(`  + ${p}`);
  for (const p of removed) console.log(`  - ${p}`);
  if (added.length > 0 || removed.length > 0) drifted = true;
}

if (!WRITE) {
  console.log(
    drifted
      ? '\nDrift detected. Re-run with --write, then `yarn verify:docs-coverage` will\n' +
          'name the pages that still need a mapping entry.'
      : '\nNo drift.',
  );
  process.exit(0);
}

// --- emit -------------------------------------------------------------------

const wrap = (arr, indent) => {
  const lines = [];
  let line = '';
  for (const item of arr) {
    const piece = `${JSON.stringify(item)}, `;
    if (line.length + piece.length > 96 - indent.length) {
      lines.push(indent + line.trimEnd());
      line = '';
    }
    line += piece;
  }
  if (line) lines.push(indent + line.trimEnd().replace(/,$/, ','));
  return lines.join('\n');
};

const header = `// Upstream competitor documentation inventories — the denominator for the docs
// coverage gate (.github/scripts/verify-docs-coverage.mjs).
//
// Each list is the set of documentation pages the upstream project publishes,
// harvested from its docs source tree at the pinned commit below (not scraped
// from the rendered site, so it cannot drift with their CDN). Refresh with:
//
//   node .github/scripts/refresh-docs-inventory.mjs
//
// Deliberately EXCLUDED from these lists, because they are not capability docs:
//   * release notes / changelogs   (drizzle latest-releases/*, ~45 pages)
//   * "upgrading vN to vN+1"       (mikro-orm upgrading-*, drizzle upgrade-*)
//   * marketing / community pages  (enterprise, support, who-uses, sustainability)
//   * duplicated dialect variants  (drizzle re-publishes ~55 pages once per
//     dialect; we keep one entry per concept and note the dialects on the page)
//   * per-driver get-started forks (drizzle get-started/<driver>-{new,existing};
//     54 pages that differ only in the connection snippet)
//
// Everything else is in scope: if a page appears here it must map to a zmdb page
// or to an explicit anti-pattern rationale in ./mapping.mjs.
`;

let out = `${header}\nexport const SOURCES = {\n`;
for (const [key, src] of Object.entries(results)) {
  out += `  ${JSON.stringify(key)}: {\n`;
  out += `    label: ${JSON.stringify(src.label)},\n`;
  out += `    docsHome: ${JSON.stringify(src.docsHome)},\n`;
  out += `    repo: ${JSON.stringify(src.repo)},\n`;
  out += `    branch: ${JSON.stringify(src.branch)},\n`;
  out += `    commit: ${JSON.stringify(src.commit)},\n`;
  out += `    contentDir: ${JSON.stringify(src.contentDir)},\n`;
  out += `  },\n`;
}
out += `};\n\nexport const INVENTORY = {\n`;
for (const [key, src] of Object.entries(results)) {
  out += `  ${JSON.stringify(key)}: [\n${wrap(src.pages, '    ')}\n  ],\n`;
}
out += `};\n
// Drizzle publishes one get-started page per driver as well as per dialect. The
// per-driver forks differ only in the connection snippet, so they are excluded
// above and counted here instead, to keep the exclusion visible rather than tacit.
export const DRIZZLE_GET_STARTED_VARIANTS = 54;

export const TOTAL_UPSTREAM_PAGES = ${Object.values(results).reduce((n, s) => n + s.pages.length, 0)};
`;

writeFileSync(INVENTORY_PATH, out);
console.log(`\nwrote ${INVENTORY_PATH}`);
