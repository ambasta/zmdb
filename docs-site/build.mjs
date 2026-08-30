// zmdb docs static-site generator.
// Reads manifest.mjs (nav + per-page {status, md}) and emits static HTML into
// ../site/docs/<slug>.html + ../site/index.html, sharing a dark theme with the
// benchmarks dashboard. No framework — a tiny markdown subset renderer.
import { mkdirSync, writeFileSync, cpSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NAV, PAGES } from './manifest.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '..', 'site');
const DASH = join(here, '..', 'benchmarks', 'site'); // existing benchmarks dashboard

// --- markdown → HTML renderer.
// Supports: headings (with slug ids), fenced code, inline code/bold/links,
// nested unordered + ordered lists, blockquotes, GitHub-style admonitions
// (> [!NOTE] / [!TIP] / [!WARNING] / [!IMPORTANT]), tables, and paragraphs.
// Collects h2/h3 headings for an "On this page" TOC.
function slugify(s) {
  return s.toLowerCase().replace(/`/g, '').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-');
}
function renderInline(s) {
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}
const ADMONITION = { NOTE: '📝 Note', TIP: '💡 Tip', WARNING: '⚠️ Warning', IMPORTANT: '❗ Important', DANGER: '🛑 Danger' };

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
      if (l.trim() === '') { i++; continue; }
      const m = l.match(/^(\s*)(?:[-*]|\d+\.)\s+(.*)$/);
      if (!m) break;
      const ind = m[1].length;
      if (ind < indent) break;
      if (ind > indent) { out += parseList(ind); continue; }
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
      html += `<pre class="lang-${lang}"><code>${code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>`;
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
      html += `<h${lvl} id="${id}">${renderInline(text)}</h${lvl}>`;
      i++;
      continue;
    }
    // lists
    if (/^(\s*)(?:[-*]|\d+\.)\s+/.test(l)) { html += parseList(l.match(/^(\s*)/)[1].length); continue; }
    // table
    if (/^\|/.test(l)) {
      const tbl = [];
      while (i < lines.length && /^\|/.test(lines[i])) tbl.push(lines[i++]);
      const rows = tbl.filter((r) => !/^\|[-\s|:]+\|$/.test(r)).map((r) => r.split('|').slice(1, -1).map((c) => c.trim()));
      html += '<table>' + rows.map((cells, ri) => '<tr>' + cells.map((c) => (ri === 0 ? `<th>${renderInline(c)}</th>` : `<td>${renderInline(c)}</td>`)).join('') + '</tr>').join('') + '</table>';
      continue;
    }
    if (l.trim() === '') { i++; continue; }
    // paragraph
    let para = '';
    while (i < lines.length && lines[i].trim() !== '' && !/^(#{1,4}\s|(\s*)(?:[-*]|\d+\.)\s|```|\||>)/.test(lines[i])) para += (para ? ' ' : '') + lines[i++];
    html += `<p>${renderInline(para)}</p>`;
  }
  return { html, toc };
}

const STATUS_BADGE = {
  supported: '<span class="badge ok">Supported</span>',
  todo: '<span class="badge todo">TODO</span>',
};

function navHtml(activeSlug) {
  let h = '';
  for (const group of NAV) {
    h += `<div class="nav-group"><div class="nav-title">${group.title}</div>`;
    for (const slug of group.pages) {
      const p = PAGES[slug];
      if (!p) continue;
      const badge = p.status === 'todo' ? ' <span class="dot todo"></span>' : '';
      h += `<a class="nav-link${slug === activeSlug ? ' active' : ''}" href="./${slug}.html">${p.title}${badge}</a>`;
    }
    h += '</div>';
  }
  return h;
}

const CSS = `
:root{--bg:#0d1117;--panel:#161b22;--fg:#e6edf3;--muted:#8b949e;--accent:#58a6ff;--ok:#3fb950;--todo:#d29922;--line:#30363d}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.65 -apple-system,Segoe UI,Roboto,sans-serif}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
.layout{display:grid;grid-template-columns:280px minmax(0,1fr) 220px;min-height:100vh}
aside{border-right:1px solid var(--line);padding:20px 14px;overflow-y:auto;position:sticky;top:0;height:100vh;background:var(--panel)}
.brand{font-size:20px;font-weight:700;padding:0 8px 14px}
.brand small{display:block;font-size:12px;color:var(--muted);font-weight:400}
.nav-group{margin:14px 0}.nav-title{color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.05em;padding:0 8px 4px}
.nav-link{display:block;padding:5px 8px;border-radius:6px;color:var(--fg);font-size:14px}
.nav-link:hover{background:#21262d;text-decoration:none}.nav-link.active{background:var(--accent);color:#0d1117;font-weight:600}
.dot{display:inline-block;width:7px;height:7px;border-radius:50%}.dot.todo{background:var(--todo)}
main{padding:34px 48px 60px;max-width:860px;min-width:0}
h1{margin:0 0 4px;font-size:30px}h2{margin:32px 0 10px;font-size:22px;border-bottom:1px solid var(--line);padding-bottom:6px;scroll-margin-top:20px}h3{margin:22px 0 6px;font-size:17px;scroll-margin-top:20px}
p{margin:10px 0}
code{background:#21262d;padding:1px 6px;border-radius:4px;font-size:13px}
pre{background:#0b0f14;border:1px solid var(--line);border-radius:8px;padding:14px 16px;overflow-x:auto}pre code{background:none;padding:0;font-size:13px;line-height:1.55}
pre.lang-sql{border-left:3px solid #a371f7}pre.lang-bash{border-left:3px solid #3fb950}
table{border-collapse:collapse;width:100%;margin:12px 0;font-size:14px}th,td{border:1px solid var(--line);padding:6px 10px;text-align:left;vertical-align:top}
th{background:#161b22}
ul,ol{margin:10px 0;padding-left:24px}li{margin:4px 0}li>ul,li>ol{margin:4px 0}
blockquote{margin:12px 0;padding:2px 16px;border-left:3px solid var(--line);color:var(--muted)}
.admonition{margin:16px 0;border-radius:8px;padding:12px 16px;border:1px solid var(--line);border-left-width:4px;background:#12171d}
.admonition .adm-title{font-weight:700;font-size:13px;margin-bottom:4px}
.admonition.note{border-left-color:var(--accent)}.admonition.tip{border-left-color:var(--ok)}
.admonition.warning,.admonition.important{border-left-color:var(--todo)}.admonition.danger{border-left-color:#f85149}
.admonition p{margin:4px 0}
.badge{display:inline-block;font-size:12px;font-weight:600;padding:2px 10px;border-radius:20px;vertical-align:middle;margin-left:10px}
.badge.ok{background:rgba(63,185,80,.15);color:var(--ok)}.badge.todo{background:rgba(210,153,34,.15);color:var(--todo)}
.todo-banner{background:rgba(210,153,34,.1);border:1px solid var(--todo);border-radius:8px;padding:14px 16px;margin:16px 0;color:#e6edf3}
.todo-banner b{color:var(--todo)}
.crumbs{color:var(--muted);font-size:13px;margin-bottom:10px}
.toc{position:sticky;top:0;height:100vh;overflow-y:auto;padding:34px 16px;font-size:13px;border-left:1px solid var(--line)}
.toc-title{color:var(--muted);text-transform:uppercase;letter-spacing:.05em;font-size:11px;margin-bottom:8px}
.toc a{display:block;color:var(--muted);padding:3px 0}.toc a:hover{color:var(--fg)}.toc a.lvl3{padding-left:12px;font-size:12px}
.prevnext{display:flex;justify-content:space-between;gap:12px;margin-top:48px;border-top:1px solid var(--line);padding-top:20px}
.prevnext a{display:block;flex:1;border:1px solid var(--line);border-radius:8px;padding:12px 16px}
.prevnext a:hover{border-color:var(--accent);text-decoration:none}
.prevnext .dir{color:var(--muted);font-size:12px}.prevnext .nxt{text-align:right}
@media(max-width:1100px){.layout{grid-template-columns:240px 1fr}.toc{display:none}}
@media(max-width:800px){.layout{grid-template-columns:1fr}aside{display:none}}
`;

// Flat page order (from NAV) for prev/next navigation.
const FLAT = NAV.flatMap((g) => g.pages).filter((s) => PAGES[s]);

function pageHtml(slug, p) {
  const todoBanner = p.status === 'todo'
    ? `<div class="todo-banner"><b>🚧 TODO — not yet implemented.</b> This capability is on the roadmap and is <em>not</em> an anti-pattern for zmdb; it simply isn't built yet. ${p.note ? p.note : ''} Track / contribute via the issue tracker.</div>`
    : '';
  const { html: body, toc } = mdToHtml(p.md);
  const tocHtml = toc.length
    ? `<nav class="toc"><div class="toc-title">On this page</div>${toc
        .map((t) => `<a class="lvl${t.lvl}" href="#${t.id}">${t.text}</a>`)
        .join('')}</nav>`
    : '<div></div>';
  // prev / next
  const idx = FLAT.indexOf(slug);
  const prev = idx > 0 ? FLAT[idx - 1] : null;
  const next = idx >= 0 && idx < FLAT.length - 1 ? FLAT[idx + 1] : null;
  const pn =
    prev || next
      ? `<div class="prevnext">${
          prev ? `<a href="./${prev}.html"><div class="dir">← Previous</div><div>${PAGES[prev].title}</div></a>` : '<span></span>'
        }${
          next ? `<a class="nxt" href="./${next}.html"><div class="dir">Next →</div><div>${PAGES[next].title}</div></a>` : '<span></span>'
        }</div>`
      : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${p.title} — zmdb docs</title><style>${CSS}</style></head><body>
<div class="layout">
<aside><div class="brand">zmdb<small>zero-maintenance data layer</small></div>
<a class="nav-link" href="../index.html">← Home</a>
<a class="nav-link" href="../benchmarks/index.html">📊 Benchmarks</a>
${navHtml(slug)}</aside>
<main>
<div class="crumbs">Docs / ${p.group ?? ''}</div>
<h1>${p.title}${STATUS_BADGE[p.status] ?? ''}</h1>
${todoBanner}
${body}
${pn}
</main>
${tocHtml}
</div></body></html>`;
}

// --- build ---
mkdirSync(join(OUT, 'docs'), { recursive: true });
mkdirSync(join(OUT, 'benchmarks'), { recursive: true });

// Copy the existing benchmarks dashboard into site/benchmarks/ (it fetches its
// JSON via ./ relative paths, which resolve correctly under /benchmarks/).
for (const f of ['index.html', 'validation-matrix.json', 'orm-results.json']) {
  const src = join(DASH, f);
  if (existsSync(src)) cpSync(src, join(OUT, 'benchmarks', f));
}

// Emit docs pages.
for (const [slug, p] of Object.entries(PAGES)) {
  writeFileSync(join(OUT, 'docs', `${slug}.html`), pageHtml(slug, p));
}

// Landing page.
const counts = Object.values(PAGES).reduce((a, p) => ((a[p.status] = (a[p.status] || 0) + 1), a), {});
const LANDING_CSS = `${CSS}
.hero{max-width:820px;margin:0 auto;padding:64px 24px 24px}
.hero h1{font-size:44px;margin:0 0 8px}
.hero .tag{font-size:18px;color:var(--muted);margin:0 0 24px}
.cta a{display:inline-block;margin:0 10px 0 0;padding:10px 18px;border-radius:8px;border:1px solid var(--line)}
.cta a.primary{background:var(--accent);color:#0d1117;font-weight:600;border-color:var(--accent)}
.wrap{max-width:820px;margin:0 auto;padding:0 24px 80px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:14px;margin:16px 0}
.card{border:1px solid var(--line);border-radius:10px;padding:16px;background:var(--panel)}
.card h4{margin:0 0 6px;font-size:15px}.card p{margin:0;color:var(--muted);font-size:13px}
`;
const landing = `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>zmdb — TypeScript data layer with zero schema drift</title><style>${LANDING_CSS}</style></head><body>
<div class="hero">
<h1>zmdb</h1>
<p class="tag">Define your schema once. Entities, DTOs, validation, serialization, OpenAPI, and repository CRUD all derive at compile time — with zero runtime proxies and AOT-inlined validation.</p>
<div class="cta">
<a class="primary" href="./docs/quick-start.html">Quick start →</a>
<a href="./docs/introduction.html">Introduction</a>
<a href="./benchmarks/index.html">📊 Benchmarks</a>
<a href="https://github.com/ambasta/zmdb">GitHub</a>
</div>
</div>
<div class="wrap">
${mdToHtml(`
\`\`\`ts
import { defineSchema, serial, text, jsonEnum } from '@zmdb/schema-core';
import { BaseRepository } from '@zmdb/repository';
import type { Entity, CreateDTO } from '@zmdb/schema-core';

// 1. Define once
export const UserSchema = defineSchema('users', {
  id: serial().primaryKey(),
  email: text().notNull(),
  role: jsonEnum(['admin', 'user']).notNull().defaultTo('user'),
});

// 2. Types derive automatically
type User = Entity<typeof UserSchema>;       // { id; email; role }
type NewUser = CreateDTO<typeof UserSchema>; // { email; role? }

// 3. CRUD in one line
class Users extends BaseRepository<typeof UserSchema> {
  static readonly schema = UserSchema;
}
const users = new Users(driver);
await users.create({ email: 'a@b.com' }); // validated before any SQL runs
\`\`\`
`).html}
<h2>Why zmdb</h2>
<div class="grid">
<div class="card"><h4>Define once, derive everything</h4><p>One schema drives entity/create/update/read DTOs, validators, serializers, OpenAPI and migrations. Change a column → everything that no longer fits fails to compile.</p></div>
<div class="card"><h4>Zero overhead by design</h4><p>No proxies, no identity map, no change tracking. Reads return plain inert objects; writes are explicit. That is where the performance comes from.</p></div>
<div class="card"><h4>AOT validation & serialization</h4><p>is / assert / validate / stringify compile to straight-line JavaScript at build time — no runtime parser.</p></div>
<div class="card"><h4>SQL-first query builder</h4><p>Typed select/insert/update/delete with real joins, aggregations and full-text search — plus typed Get/List/Search DTOs on top.</p></div>
</div>
<h2>Documentation</h2>
<p>These docs incorporate the union of the <a href="https://mikro-orm.io/docs/guide">MikroORM</a>, <a href="https://orm.drizzle.team/docs/overview">Drizzle</a>, and <a href="https://typia.io/docs">Typia</a> documentation surfaces. Every capability page is written in full (${counts.supported ?? 0} pages, 0 TODO). Features that are <b>anti-patterns</b> for a zero-overhead, no-proxy, AOT data layer are deliberately excluded and explained on the <a href="./docs/anti-patterns.html">Anti-patterns</a> page.</p>
${NAV.map((g) => `<h3>${g.title}</h3><ul>${g.pages.filter((s) => PAGES[s]).map((s) => `<li><a href="./docs/${s}.html">${PAGES[s].title}</a></li>`).join('')}</ul>`).join('')}
</div>
</body></html>`;
writeFileSync(join(OUT, 'index.html'), landing);

console.log(`built docs: ${Object.keys(PAGES).length} pages (${counts.supported ?? 0} supported, ${counts.todo ?? 0} TODO) + landing + benchmarks moved to /benchmarks/`);
