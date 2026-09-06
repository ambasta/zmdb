// zmdb docs static-site generator.
//
// Reads manifest.mjs (nav + per-page {status, md}) and emits static HTML into
// ../site/docs/<slug>.html, ../site/index.html and ../site/benchmarks/index.html.
// No framework and no build step beyond `node`: a small markdown renderer here,
// build-time syntax highlighting in highlight.mjs, and the shared chrome (theme,
// sidebar, ⌘K search) in shell.mjs. Everything a page needs is inlined into it,
// except the search index, which is one lazily-loaded file shared by every page.
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { benchmarkHighlights, buildBenchmarksPage } from './benchmarks.mjs';
import { generateDocumentation } from './generated.mjs';
import { highlight } from './highlight.mjs';
import { generateOpenApiSpec } from './openapi-spec.mjs';
import { PALETTE_HTML, SHELL_CSS, THEME_BOOT, searchIndexScript, shellJs, topbarHtml } from './shell.mjs';

const here = dirname(fileURLToPath(import.meta.url));
generateDocumentation(join(here, '..'));
const { NAV, PAGES } = await import('./manifest.mjs');
const OUT = join(here, '..', 'site');
const DASH = join(here, '..', 'benchmarks', 'site'); // existing benchmarks dashboard

// --- markdown → HTML renderer.
// Supports: headings (with slug ids), fenced code, inline code/bold/links,
// nested unordered + ordered lists, blockquotes, GitHub-style admonitions
// (> [!NOTE] / [!TIP] / [!WARNING] / [!IMPORTANT]), tables, and paragraphs.
// Collects h2/h3 headings for an "On this page" TOC.
function slugify(s) {
  return s
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}
function renderInline(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}
const ADMONITION = {
  NOTE: '📝 Note',
  TIP: '💡 Tip',
  WARNING: '⚠️ Warning',
  IMPORTANT: '❗ Important',
  DANGER: '🛑 Danger',
};

function mdToHtml(md) {
  const lines = md.split('\n');
  const toc = [];
  let html = '';
  let i = 0;

  // Parse a list starting at index `i` at a given indent; supports nesting.
  function parseList(indent) {
    const ordered = /^\s*\d+\.\s/.test(lines[i]);
    let out = ordered ? '<ol>' : '<ul>';
    while (i < lines.length) {
      const l = lines[i];
      if (l.trim() === '') {
        i++;
        continue;
      }
      const m = l.match(/^(\s*)(?:[-*]|\d+\.)\s+(.*)$/);
      if (!m) break;
      const ind = m[1].length;
      if (ind < indent) break;
      if (ind > indent) {
        out += parseList(ind);
        continue;
      }
      i++;
      let item = renderInline(m[2]);
      // nested list directly under this item?
      if (i < lines.length) {
        const nm = lines[i].match(/^(\s*)(?:[-*]|\d+\.)\s+/);
        if (nm && nm[1].length > indent) item += parseList(nm[1].length);
      }
      out += `<li>${item}</li>`;
    }
    out += ordered ? '</ol>' : '</ul>';
    return out;
  }

  while (i < lines.length) {
    const l = lines[i];
    // fenced code
    if (l.startsWith('```')) {
      const lang = l.slice(3).trim();
      i++;
      let code = '';
      while (i < lines.length && !lines[i].startsWith('```')) code += lines[i++] + '\n';
      i++;
      // Tokenised here rather than in the browser: no highlighter to download, and
      // no flash of uncoloured code on a slow connection.
      html += `<pre class="lang-${lang}"><code>${highlight(code.replace(/\n$/, ''), lang)}</code></pre>`;
      continue;
    }
    // admonition: > [!NOTE] ...  (consumes following > lines)
    const adm = l.match(/^>\s*\[!(\w+)\]\s*(.*)$/);
    if (adm) {
      const kind = adm[1].toUpperCase();
      const label = ADMONITION[kind] ?? adm[1];
      i++;
      let body = adm[2] ? adm[2] + '\n' : '';
      while (i < lines.length && /^>\s?/.test(lines[i])) body += lines[i++].replace(/^>\s?/, '') + '\n';
      html += `<div class="admonition ${kind.toLowerCase()}"><div class="adm-title">${label}</div>${mdToHtml(body.trim()).html}</div>`;
      continue;
    }
    // blockquote
    if (/^>\s?/.test(l)) {
      let body = '';
      while (i < lines.length && /^>\s?/.test(lines[i])) body += lines[i++].replace(/^>\s?/, '') + '\n';
      html += `<blockquote>${mdToHtml(body.trim()).html}</blockquote>`;
      continue;
    }
    // headings (with slug ids; collect h2/h3 for TOC)
    if (/^#{1,4}\s/.test(l)) {
      const lvl = l.match(/^#+/)[0].length;
      const text = l.replace(/^#+\s/, '');
      const id = slugify(text);
      if (lvl === 2 || lvl === 3) toc.push({ lvl, id, text: text.replace(/`/g, '') });
      // A linkable heading is how people cite a doc; h1 is the page itself, which
      // already has a URL.
      const anchor = lvl > 1 ? `<a class="anchor" href="#${id}" aria-label="Link to this section">#</a>` : '';
      html += `<h${lvl} id="${id}">${renderInline(text)}${anchor}</h${lvl}>`;
      i++;
      continue;
    }
    // lists
    if (/^(\s*)(?:[-*]|\d+\.)\s+/.test(l)) {
      html += parseList(l.match(/^(\s*)/)[1].length);
      continue;
    }
    // table
    if (l.startsWith('|')) {
      const tbl = [];
      while (i < lines.length && lines[i].startsWith('|')) tbl.push(lines[i++]);
      const rows = tbl
        .filter(r => !/^\|[-\s|:]+\|$/.test(r))
        .map(r =>
          r
            .split('|')
            .slice(1, -1)
            .map(c => c.trim()),
        );
      html +=
        '<table>' +
        rows
          .map(
            (cells, ri) =>
              '<tr>' +
              cells.map(c => (ri === 0 ? `<th>${renderInline(c)}</th>` : `<td>${renderInline(c)}</td>`)).join('') +
              '</tr>',
          )
          .join('') +
        '</table>';
      continue;
    }
    if (l.trim() === '') {
      i++;
      continue;
    }
    // paragraph
    let para = '';
    while (i < lines.length && lines[i].trim() !== '' && !/^(#{1,4}\s|(\s*)(?:[-*]|\d+\.)\s|```|\||>)/.test(lines[i]))
      para += (para ? ' ' : '') + lines[i++];
    html += `<p>${renderInline(para)}</p>`;
  }
  return { html, toc };
}

const STATUS_BADGE = {
  supported: '<span class="badge ok">Supported</span>',
  todo: '<span class="badge todo">TODO</span>',
  wontfix: '<span class="badge muted">Not planned</span>',
};

// Product-journey groups collapse because several own long page lists. The group
// holding the current page is the one opened — on the benchmarks page, which is in
// no group, everything starts closed and the reader expands what they want.
function navHtml(activeSlug, base = './') {
  let h = '';
  for (const group of NAV) {
    const pages = group.pages;
    const open = pages.includes(activeSlug) ? ' open' : '';
    h += `<details class="nav-group"${open}><summary class="nav-title">${group.title}<span class="count">${pages.length}</span></summary>`;
    for (const slug of pages) {
      const p = PAGES[slug];
      const badge =
        p.status === 'todo'
          ? '<span class="dot todo" title="On the roadmap"></span>'
          : p.status === 'wontfix'
            ? '<span class="dot wontfix" title="Not planned"></span>'
            : '';
      h += `<a class="nav-link${slug === activeSlug ? ' active' : ''}" href="${base}${slug}.html">${p.title}${badge}</a>`;
    }
    h += '</details>';
  }
  return h;
}

// The docs pages and the benchmarks dashboard share one stylesheet, so a change
// to the theme cannot land on one of them and not the other.
const CSS = SHELL_CSS;

// Flat page order (from NAV) for prev/next navigation.
const FLAT = NAV.flatMap(g => g.pages);

function pageHtml(slug, p) {
  const todoBanner =
    p.status === 'todo'
      ? `<div class="todo-banner"><b>🚧 TODO — not yet implemented.</b> This capability is on the roadmap and is <em>not</em> an anti-pattern for zmdb; it simply isn't built yet. ${p.note ? p.note : ''} Track / contribute via the issue tracker.</div>`
      : p.status === 'wontfix'
        ? `<div class="wontfix-banner"><b>Not planned.</b> This capability had a frozen design and will <em>not</em> be built — the page stays so the answer is findable, and so is what to reach for instead. ${p.note ? p.note : ''}</div>`
        : '';
  const { html: body, toc } = mdToHtml(p.md);
  const tocHtml = toc.length
    ? `<nav class="toc"><div class="toc-title">On this page</div>${toc
        .map(t => `<a class="lvl${t.lvl}" href="#${t.id}">${t.text}</a>`)
        .join('')}</nav>`
    : '<div></div>';
  // prev / next
  const idx = FLAT.indexOf(slug);
  const prev = idx > 0 ? FLAT[idx - 1] : null;
  const next = idx >= 0 && idx < FLAT.length - 1 ? FLAT[idx + 1] : null;
  const pn =
    prev || next
      ? `<div class="prevnext">${
          prev
            ? `<a href="./${prev}.html"><div class="dir">← Previous</div><div>${PAGES[prev].title}</div></a>`
            : '<span></span>'
        }${
          next
            ? `<a class="nxt" href="./${next}.html"><div class="dir">Next →</div><div>${PAGES[next].title}</div></a>`
            : '<span></span>'
        }</div>`
      : '';
  // The first paragraph of the page, as its meta description: written prose beats a
  // boilerplate line, and search engines and link previews both use it.
  const firstPara = /<p>([\s\S]*?)<\/p>/.exec(body);
  const description = (firstPara?.[1] ?? `${p.title} — zmdb documentation.`).replace(/<[^>]+>/g, '').slice(0, 180);

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${p.title} — zmdb docs</title>
<meta name="description" content="${description.replace(/"/g, '&quot;')}"/>
<script>${THEME_BOOT}</script>
<style>${CSS}</style></head><body>
${topbarHtml({ base: '../', active: 'docs', withNavToggle: true })}
<div class="layout">
<aside>
<input class="navsearch" type="search" placeholder="Filter these titles…" aria-label="Filter documentation titles" />
<a class="nav-link nav-top" href="../benchmarks/index.html">Benchmarks</a>
<a class="nav-link nav-top" href="../openapi.json" target="_blank" download="openapi.json">OpenAPI spec</a>
${navHtml(slug)}</aside>
<main>
<div class="crumbs"><a href="../index.html">Docs</a> / ${p.group}</div>
<h1>${p.title}${STATUS_BADGE[p.status] ?? ''}</h1>
${todoBanner}
${body}
${pn}
</main>
${tocHtml}
</div>
<div class="scrim"></div>
${PALETTE_HTML}
<script>${shellJs('../')}</script>
</body></html>`;
}

// --- build ---
mkdirSync(join(OUT, 'docs'), { recursive: true });
mkdirSync(join(OUT, 'benchmarks'), { recursive: true });

// Copy the raw and normalised benchmark data next to the dashboard so every number
// on the page can be downloaded and checked. A file that is not there is not
// replaced by a fallback: benchmarks.mjs renders an explicit "not measured" panel
// naming the command that produces it, because a placeholder zero is a claim.
const BENCH_DATA = [
  'validation.json',
  'orm.json',
  'framework.json',
  'validation-matrix.json',
  'orm-results.json',
  'framework-results.json',
  'framework-results-bun.json',
  'framework-results-deno.json',
  'peers-results.json',
  'interleaved-results.json',
  'interleaved-measurements.csv',
];
const missingData = [];
for (const f of BENCH_DATA) {
  const src = join(DASH, f);
  const dest = join(OUT, 'benchmarks', f);
  if (existsSync(src)) {
    cpSync(src, dest);
  } else {
    // Delete rather than leave behind: an earlier build's copy would sit next to a
    // panel saying the suite was not measured, which is the sort of contradiction
    // people resolve by trusting the file.
    rmSync(dest, { force: true });
    missingData.push(f);
  }
}

writeFileSync(join(OUT, 'benchmarks', 'index.html'), buildBenchmarksPage({ css: CSS, navHtml, dashDir: DASH }));

// Emit docs pages.
for (const [slug, p] of Object.entries(PAGES)) {
  writeFileSync(join(OUT, 'docs', `${slug}.html`), pageHtml(slug, p));
}

// The search index: one file, shared by every page, loaded only when someone
// actually opens the palette. Inlining it into every page would multiply the same
// index by the full registry size;
// putting it behind a service would mean the docs stop working offline.
const searchIndex = searchIndexScript(PAGES, NAV);
writeFileSync(join(OUT, 'search-index.js'), searchIndex);

// Landing page — polished marketing home (drizzle/typia-style hero).
const counts = Object.values(PAGES).reduce((a, p) => ((a[p.status] = (a[p.status] || 0) + 1), a), {});

// Landing-page figures. Everything here is either counted from the page registry
// or read out of the normalised benchmark files — nothing is typed in by hand, so
// a stale claim is not something this page can express.
const highlights = benchmarkHighlights(DASH);
const STATS = [
  {
    n: Object.keys(PAGES).length,
    l: `docs pages · ${counts.todo ?? 0} on the roadmap · ${counts.wontfix ?? 0} not planned`,
  },
  highlights.aotSpeedup === null ? null : { n: highlights.aotSpeedup, l: 'AOT vs runtime validation' },
  highlights.validationLibraries === null
    ? null
    : { n: highlights.validationLibraries, l: 'validation libraries measured head-to-head' },
  highlights.ormCoverage === null
    ? null
    : {
        n: `${highlights.ormCoverage.covered}/${highlights.ormCoverage.total}`,
        l: 'ORM benchmark routes expressible',
      },
  highlights.frameworkPeers === null
    ? null
    : { n: highlights.frameworkPeers, l: 'web frameworks benchmarked on one box' },
].filter(s => s !== null);
// The reading order a newcomer should actually follow, which is not the same as
// the sidebar order — the sidebar is exhaustive, this is a path through it.
const START_HERE = [
  ['quick-start', 'Install, define a schema, run your first validated query.'],
  ['schema-declaration', 'The one definition everything else is derived from.'],
  ['crud', 'Create, read, update, delete — validated before any SQL is sent.'],
  ['aot-setup', 'Wire the transformer so validation compiles to straight-line code.'],
];

const heroCode = mdToHtml(`
\`\`\`ts
import { defineRepository, schemaOf } from 'zmdb';
import type { CreateDTO, Entity } from 'zmdb/derive';
import type { HasDefault, PrimaryKey, Serial, Sql, Table } from 'zmdb/tags';

// 1 — declare the table once, as a type
export interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'text'>;
  role: ('admin' | 'user') & HasDefault;
}

// 2 — every other shape is derived from that declaration
type Row     = Entity<User>;    // { id; email; role }
type NewUser = CreateDTO<User>; // { email; role? } — no id: the database makes it

// 3 — validated CRUD in one line
const users = defineRepository(schemaOf<User>(), driver);
await users.create({ email: 'a@b.com' }); // validated before any SQL
\`\`\`
`).html;

// Landing-specific layout only. The palette, typography, code colours and the
// light/dark variables all come from SHELL_CSS, so the landing page cannot drift
// from the docs — the gradients are the one thing that is only used here.
const LANDING_CSS = `
:root{--grad1:var(--accent);--grad2:#a371f7;--grad3:var(--ok)}
:root[data-theme=light]{--grad2:#8250df}
body{font-size:16px}
.hero{max-width:1080px;margin:0 auto;padding:64px 6vw 40px;display:grid;grid-template-columns:1fr 1fr;gap:48px;align-items:center}
.hero .pill{display:inline-block;font-size:12px;font-weight:600;color:var(--ok);background:color-mix(in srgb,var(--ok) 10%,transparent);border:1px solid color-mix(in srgb,var(--ok) 25%,transparent);padding:4px 12px;border-radius:20px;margin-bottom:18px}
.hero h1{font-size:52px;line-height:1.05;margin:0 0 16px;letter-spacing:-.03em}
.hero h1 .g{background:linear-gradient(90deg,var(--grad1),var(--grad2) 60%,var(--grad3));-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.hero p.tag{font-size:18px;color:var(--muted);margin:0 0 28px;max-width:34ch}
.hero pre{margin:0;border-radius:12px;padding:18px 20px}
.cta{display:flex;gap:12px;flex-wrap:wrap}
.cta a{display:inline-block;padding:12px 20px;border-radius:10px;border:1px solid var(--line);font-weight:600;font-size:15px;color:var(--fg)}
.cta a.primary{background:linear-gradient(90deg,var(--grad1),var(--grad2));color:#fff;border:none}
.cta a:hover{text-decoration:none;border-color:var(--accent)}
.section{max-width:1080px;margin:0 auto;padding:48px 6vw}
.section h2{font-size:30px;letter-spacing:-.02em;text-align:center;margin:0 0 6px;border:none;padding:0}
.section .lead{color:var(--muted);text-align:center;max-width:62ch;margin:0 auto 32px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:18px}
.card{border:1px solid var(--line);border-radius:14px;padding:22px;background:var(--panel)}
.card .ic{font-size:22px;margin-bottom:10px}
.card h4{margin:0 0 8px;font-size:16px}.card p{margin:0;color:var(--muted);font-size:14px}
.pkgs{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px;margin-top:24px}
.pkg{border:1px solid var(--line);border-radius:12px;padding:16px 18px;background:var(--panel)}
.pkg code{font-size:13px;color:var(--accent);background:none;padding:0}
.pkg p{margin:6px 0 0;color:var(--muted);font-size:13px}
.stats{display:flex;justify-content:center;gap:44px;flex-wrap:wrap;margin-top:8px}
.stat{text-align:center}.stat .n{font-size:34px;font-weight:800;background:linear-gradient(90deg,var(--grad1),var(--grad3));-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.stat .l{color:var(--muted);font-size:13px;max-width:22ch}
.foot{border-top:1px solid var(--line);padding:28px 6vw;color:var(--muted);font-size:13px;text-align:center}
@media(max-width:860px){.hero{grid-template-columns:1fr;padding-top:32px}.hero h1{font-size:36px}}
`;
const landing = `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>zmdb — the zero-maintenance TypeScript data layer</title>
<meta name="description" content="Define your schema once. Entities, DTOs, validation, serialization, OpenAPI and repository CRUD all derive at compile time — zero runtime proxies, AOT-inlined validation, SQL-first."/>
<script>${THEME_BOOT}</script>
<style>${CSS}${LANDING_CSS}</style></head><body>
${topbarHtml({ base: './' })}

<section class="hero">
  <div>
    <span class="pill">◇ zero schema drift · AOT validation</span>
    <h1>Define once.<br/><span class="g">Everything derives.</span></h1>
    <p class="tag">A TypeScript data layer where entities, DTOs, validation, serialization, OpenAPI and CRUD all derive from one schema — at compile time.</p>
    <div class="cta">
      <a class="primary" href="./docs/quick-start.html">Get started →</a>
      <a href="./benchmarks/index.html">See benchmarks</a>
    </div>
  </div>
  <div>${heroCode}</div>
</section>

<section class="section">
  <h2>Why zmdb</h2>
  <p class="lead">The whole framework is built around one guarantee: your schema is the single source of truth, and nothing can silently drift from it.</p>
  <div class="grid">
    <div class="card"><div class="ic">🧬</div><h4>Define once, derive everything</h4><p>One schema drives entity / create / update / read DTOs, validators, serializers, OpenAPI and migrations. Change a column and anything that no longer fits <b>fails to compile</b>.</p></div>
    <div class="card"><div class="ic">⚡</div><h4>Zero overhead by design</h4><p>No proxies, no identity map, no change tracking. Reads return plain inert objects; writes are explicit. That is where the speed comes from.</p></div>
    <div class="card"><div class="ic">🛠️</div><h4>AOT validation &amp; Ser/De</h4><p><code>is</code> / <code>assert</code> / <code>validate</code> / <code>stringify</code> compile to straight-line JavaScript at build time — no runtime parser, no reflection.</p></div>
    <div class="card"><div class="ic">🗄️</div><h4>SQL-first query builder</h4><p>Typed select / insert / update / delete with real joins, aggregations and full-text search — plus typed Get / List / Search DTOs on top.</p></div>
  </div>
</section>

<section class="section" style="padding-top:0">
  <div class="stats">${STATS.map(
    s => `
    <div class="stat"><div class="n">${s.n}</div><div class="l">${s.l}</div></div>`,
  ).join('')}
  </div>
</section>

<section class="section">
  <h2>Thirty-two published packages</h2>
  <p class="lead">Composable and ESM-only. Combine the cohesive data, app, and HTTP facade with a database vertical, or use provider-neutral AI tools, opt-in client/framework, gRPC, NATS, RabbitMQ, Redis, MCP, OpenTelemetry, or another implementation package on its own.</p>
    <div class="pkgs">
    <div class="pkg"><code>@zmdb/client</code><p>Dependency-free HTTP transport, deterministic request planning, cancellation, authentication, and typed errors.</p></div>
    <div class="pkg"><code>@zmdb/react</code><p>React context, query, and mutation lifecycle bindings for generated HTTP clients.</p></div>
    <div class="pkg"><code>@zmdb/react-native</code><p>React Native AppState, connectivity, credential-store, and offline lifecycle policy over the React client binding.</p></div>
    <div class="pkg"><code>@zmdb/angular</code><p>Angular dependency injection, signals, Observable cancellation, and request-local generated-client ownership.</p></div>
    <div class="pkg"><code>@zmdb/vue</code><p>Vue plugin, reactive query and mutation composables, scope cancellation, and per-application SSR isolation.</p></div>
    <div class="pkg"><code>@zmdb/svelte</code><p>Typed Svelte context, subscription-aware stores, stale-result suppression, and lifecycle cancellation.</p></div>
    <div class="pkg"><code>@zmdb/sveltekit</code><p>Request-local server/client loads, explicit credential forwarding, native errors, and navigation cancellation.</p></div>
    <div class="pkg"><code>@zmdb/solid</code><p>Solid context, native resources, owner cancellation, stale-result suppression, and native Suspense/error propagation.</p></div>
    <div class="pkg"><code>@zmdb/next</code><p>Request-scoped App Router server clients and browser bindings over <code>@zmdb/react</code>.</p></div>
    <div class="pkg"><code>@zmdb/nuxt</code><p>Request-scoped Nitro transport, native hydration, and browser bindings over <code>@zmdb/vue</code>.</p></div>
    <div class="pkg"><code>@zmdb/query-compiler</code><p>SELECT / INSERT / UPDATE / DELETE + dialects, joins, aggregations, FTS, set-ops, schema-object DDL, migration diff.</p></div>
    <div class="pkg"><code>@zmdb/schema-core</code><p>Schema DSL + type derivation (Entity / Create / Update / read DTOs), relations, OpenAPI, seeding, custom types.</p></div>
    <div class="pkg"><code>@zmdb/ai</code><p>Provider-neutral tool documents, bounded chat orchestration, shared invocation, and OpenAPI-derived tools.</p></div>
    <div class="pkg"><code>@zmdb/ai-anthropic</code><p>Opt-in Anthropic Messages API driver over the provider-neutral chat contract.</p></div>
    <div class="pkg"><code>@zmdb/ai-langchain</code><p>Opt-in LangChain structured-tool fields, validation dispatch, and result serialization over <code>@zmdb/ai</code>.</p></div>
    <div class="pkg"><code>@zmdb/ai-vercel</code><p>Opt-in Vercel AI SDK tool fields with caller-owned schema branding over <code>@zmdb/ai</code>.</p></div>
    <div class="pkg"><code>@zmdb/mcp</code><p>Transport-neutral MCP client/server cores with authenticated identity, validation, and call budgets.</p></div>
    <div class="pkg"><code>@zmdb/protobuf</code><p>Dependency-free protobuf calls, descriptors, generated-code wire ABI, and typed gRPC artifacts.</p></div>
    <div class="pkg"><code>@zmdb/aot-validator</code><p>AOT is / assert / validate / equals / random, unions, transforms, and JSON Ser/De — inlined at build time.</p></div>
    <div class="pkg"><code>@zmdb/repository</code><p>Auto-validating CRUD, transactions, populate, read-replicas, lifecycle events, framework adapters.</p></div>
    <div class="pkg"><code>@zmdb/postgres</code><p>Complete PostgreSQL dialect, migrations, catalog introspection, structural <code>pg</code> driver, cursors, and cancellation.</p></div>
    <div class="pkg"><code>@zmdb/sqlite</code><p>Complete SQLite dialect, migrations, introspection, embedded runner, and structural <code>node:sqlite</code> driver.</p></div>
    <div class="pkg"><code>@zmdb/app</code><p>Protocol-neutral metadata, dependency injection, modules, lifecycle, commands, events, CQRS, state, and observability ports.</p></div>
    <div class="pkg"><code>@zmdb/jobs</code><p>Typed queues, workers, dead letters, scheduling, leases, and the built-in SQLite memory backend.</p></div>
    <div class="pkg"><code>@zmdb/jobs-postgres</code><p>PostgreSQL job storage over caller-owned pools and clients.</p></div>
    <div class="pkg"><code>@zmdb/otel</code><p>OpenTelemetry API adaptation over caller-owned tracers and meters, with no SDK, exporter, or ambient global context.</p></div>
    <div class="pkg"><code>@zmdb/transport-grpc</code><p>Typed grpc-js servers and clients over generated protobuf artifacts, with streaming, deadlines, metadata, and bounded shutdown.</p></div>
    <div class="pkg"><code>@zmdb/transport-nats</code><p>Core NATS wildcard and queue-group messaging over the public application transport strategy contract.</p></div>
    <div class="pkg"><code>@zmdb/transport-rabbitmq</code><p>RabbitMQ topic transport with positive prefetch, confirmed delayed retries, and owned dead-letter topology.</p></div>
    <div class="pkg"><code>@zmdb/transport-redis</code><p>Lossy Redis Pub/Sub messaging with concrete-channel dispatch and correlated request/reply.</p></div>
    <div class="pkg"><code>@zmdb/web</code><p>HTTP controllers, routing, request pipelines, OpenAPI, gateways, testing, and runtime adapters over <code>@zmdb/app</code>.</p></div>
    <div class="pkg"><code>zmdb</code><p>The curated data/web umbrella. It contains no implementation logic and does not re-export opt-in AI, MCP, OpenTelemetry, frontend, or transport packages.</p></div>
  </div>
</section>

<section class="section">
  <h2>Start here</h2>
  <p class="lead">Four pages get you from nothing to a validated, typed, queried table.</p>
  <div class="grid">
    ${START_HERE.map(
      ([slug, blurb], n) =>
        `<a class="card" href="./docs/${slug}.html" style="color:inherit"><div class="ic">${n + 1}</div><h4>${PAGES[slug]?.title ?? slug}</h4><p>${blurb}</p></a>`,
    ).join('')}
  </div>
</section>

<section class="section">
  <h2>${Object.keys(PAGES).length} pages of documentation</h2>
  <p class="lead">The union of the <a href="https://mikro-orm.io/docs/guide">MikroORM</a>, <a href="https://orm.drizzle.team/docs/overview">Drizzle</a>, <a href="https://typia.io/docs">Typia</a> and <a href="https://docs.nestjs.com/">NestJS</a> doc surfaces. Every capability page is written in full; the ones that are anti-patterns for a zero-overhead, no-proxy, AOT layer are <a href="./docs/anti-patterns.html">excluded and explained</a> rather than quietly missing. Press <span class="kbd">⌘K</span> to search all of it.</p>
  <div class="grid">
    ${NAV.map(g => {
      const pages = g.pages;
      const shown = pages.slice(0, 5).map(s => `<a href="./docs/${s}.html">${PAGES[s].title}</a>`);
      const rest = pages.length - shown.length;
      return `<div class="card"><h4>${g.title} <span style="color:var(--muted);font-weight:400">${pages.length}</span></h4><p>${shown.join(' · ')}${rest > 0 ? ` · <a href="./docs/${pages[0]}.html">+${rest} more</a>` : ''}</p></div>`;
    }).join('')}
  </div>
</section>

<div class="foot">GPL-3.0-or-later · Node 26+ · TypeScript 7 · ESM-only · <a href="https://github.com/ambasta/zmdb">github.com/ambasta/zmdb</a></div>
${PALETTE_HTML}
<script>${shellJs('./')}</script>
</body></html>`;
writeFileSync(join(OUT, 'index.html'), landing);

// Emit OpenAPI specification JSON to static site root (and docs directory).
const openApiSpec = generateOpenApiSpec();
const openApiJson = JSON.stringify(openApiSpec, null, 2);
writeFileSync(join(OUT, 'openapi.json'), openApiJson);
writeFileSync(join(OUT, 'docs', 'openapi.json'), openApiJson);

console.log(`published openapi spec: site/openapi.json (${openApiJson.length} bytes)`);
console.log(
  `built docs: ${Object.keys(PAGES).length} pages (${counts.supported ?? 0} supported, ${counts.todo ?? 0} TODO, ` +
    `${counts.wontfix ?? 0} not planned) + landing + unified benchmarks`,
);
if (missingData.length > 0) {
  console.log(`benchmarks: not measured on this build — ${missingData.join(', ')} (run \`yarn bench\`)`);
}
