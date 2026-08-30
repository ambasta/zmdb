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

// --- tiny markdown → HTML (headings, code fences, inline code, lists, links,
// bold, paragraphs). Deliberately small; content is authored to fit it. ---
function mdToHtml(md) {
  const lines = md.split('\n');
  let html = '';
  let i = 0;
  const inline = (s) =>
    s
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  while (i < lines.length) {
    const l = lines[i];
    if (l.startsWith('```')) {
      const lang = l.slice(3).trim();
      i++;
      let code = '';
      while (i < lines.length && !lines[i].startsWith('```')) code += lines[i++] + '\n';
      i++;
      html += `<pre class="lang-${lang}"><code>${code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>`;
      continue;
    }
    if (/^#{1,4}\s/.test(l)) {
      const lvl = l.match(/^#+/)[0].length;
      html += `<h${lvl}>${inline(l.replace(/^#+\s/, ''))}</h${lvl}>`;
      i++;
      continue;
    }
    if (/^[-*]\s/.test(l)) {
      html += '<ul>';
      while (i < lines.length && /^[-*]\s/.test(lines[i])) html += `<li>${inline(lines[i++].replace(/^[-*]\s/, ''))}</li>`;
      html += '</ul>';
      continue;
    }
    if (/^\|/.test(l)) {
      const tbl = [];
      while (i < lines.length && /^\|/.test(lines[i])) tbl.push(lines[i++]);
      const rows = tbl.filter((r) => !/^\|[-\s|:]+\|$/.test(r)).map((r) => r.split('|').slice(1, -1).map((c) => c.trim()));
      html += '<table>' + rows.map((cells, ri) => '<tr>' + cells.map((c) => (ri === 0 ? `<th>${inline(c)}</th>` : `<td>${inline(c)}</td>`)).join('') + '</tr>').join('') + '</table>';
      continue;
    }
    if (l.trim() === '') { i++; continue; }
    let para = '';
    while (i < lines.length && lines[i].trim() !== '' && !/^(#{1,4}\s|[-*]\s|```|\|)/.test(lines[i])) para += (para ? ' ' : '') + lines[i++];
    html += `<p>${inline(para)}</p>`;
  }
  return html;
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
.layout{display:grid;grid-template-columns:280px 1fr;min-height:100vh}
aside{border-right:1px solid var(--line);padding:20px 14px;overflow-y:auto;position:sticky;top:0;height:100vh;background:var(--panel)}
.brand{font-size:20px;font-weight:700;padding:0 8px 14px}
.brand small{display:block;font-size:12px;color:var(--muted);font-weight:400}
.nav-group{margin:14px 0}.nav-title{color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.05em;padding:0 8px 4px}
.nav-link{display:block;padding:5px 8px;border-radius:6px;color:var(--fg);font-size:14px}
.nav-link:hover{background:#21262d;text-decoration:none}.nav-link.active{background:var(--accent);color:#0d1117;font-weight:600}
.dot{display:inline-block;width:7px;height:7px;border-radius:50%}.dot.todo{background:var(--todo)}
main{padding:34px 48px 80px;max-width:900px}
h1{margin:0 0 4px;font-size:30px}h2{margin:28px 0 8px;font-size:22px;border-bottom:1px solid var(--line);padding-bottom:6px}h3{margin:20px 0 6px;font-size:17px}
code{background:#21262d;padding:1px 6px;border-radius:4px;font-size:13px}
pre{background:#161b22;border:1px solid var(--line);border-radius:8px;padding:14px 16px;overflow-x:auto}pre code{background:none;padding:0;font-size:13px;line-height:1.5}
table{border-collapse:collapse;width:100%;margin:10px 0;font-size:14px}th,td{border:1px solid var(--line);padding:6px 10px;text-align:left}
.badge{display:inline-block;font-size:12px;font-weight:600;padding:2px 10px;border-radius:20px;vertical-align:middle;margin-left:10px}
.badge.ok{background:rgba(63,185,80,.15);color:var(--ok)}.badge.todo{background:rgba(210,153,34,.15);color:var(--todo)}
.todo-banner{background:rgba(210,153,34,.1);border:1px solid var(--todo);border-radius:8px;padding:14px 16px;margin:16px 0;color:#e6edf3}
.todo-banner b{color:var(--todo)}
.crumbs{color:var(--muted);font-size:13px;margin-bottom:10px}
`;

function pageHtml(slug, p) {
  const todoBanner = p.status === 'todo'
    ? `<div class="todo-banner"><b>🚧 TODO — not yet implemented.</b> This capability is on the roadmap and is <em>not</em> an anti-pattern for zmdb; it simply isn't built yet. ${p.note ? p.note : ''} Track / contribute via the issue tracker.</div>`
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
${mdToHtml(p.md)}
</main></div></body></html>`;
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
const landing = `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>zmdb — Documentation</title><style>${CSS} main{max-width:820px;margin:0 auto}</style></head><body>
<main style="padding:60px 24px">
<h1>zmdb <small style="font-size:16px;color:var(--muted)">— zero-maintenance data layer</small></h1>
<p>Define your schema once; entities, DTOs, validation, and repository CRUD derive at compile time. Zero runtime proxies, AOT-inlined validation, direct SQL.</p>
<p><a href="./docs/introduction.html">Get started →</a> &nbsp; <a href="./benchmarks/index.html">📊 Benchmarks →</a> &nbsp; <a href="https://github.com/ambasta/zmdb">GitHub →</a></p>
<h2>Documentation</h2>
<p>These docs incorporate the union of the <a href="https://mikro-orm.io/docs/guide">MikroORM</a>, <a href="https://orm.drizzle.team/docs/overview">Drizzle</a>, and <a href="https://typia.io/docs">Typia</a> documentation surfaces. Pages we support are written in full (${counts.supported ?? 0}); capabilities not yet built are shown as <span class="badge todo">TODO</span> (${counts.todo ?? 0}); and features that are <b>anti-patterns</b> for a zero-overhead, no-proxy, AOT data layer are deliberately excluded and explained on the <a href="./docs/anti-patterns.html">Anti-patterns</a> page.</p>
${NAV.map((g) => `<h3>${g.title}</h3><ul>${g.pages.filter((s) => PAGES[s]).map((s) => `<li><a href="./docs/${s}.html">${PAGES[s].title}</a> ${PAGES[s].status === 'todo' ? '<span class="badge todo">TODO</span>' : ''}</li>`).join('')}</ul>`).join('')}
</main></body></html>`;
writeFileSync(join(OUT, 'index.html'), landing);

console.log(`built docs: ${Object.keys(PAGES).length} pages (${counts.supported ?? 0} supported, ${counts.todo ?? 0} TODO) + landing + benchmarks moved to /benchmarks/`);
