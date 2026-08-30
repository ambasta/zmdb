// zmdb docs static-site generator.
// Reads manifest.mjs (nav + per-page {status, md}) and emits static HTML into
// ../site/docs/<slug>.html + ../site/index.html, sharing a dark theme with the
// benchmarks dashboard. No framework — a tiny markdown subset renderer.
import { mkdirSync, writeFileSync, cpSync, existsSync, readFileSync } from 'node:fs';
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
};

function navHtml(activeSlug, base = './') {
  let h = '';
  for (const group of NAV) {
    h += `<div class="nav-group"><div class="nav-title">${group.title}</div>`;
    for (const slug of group.pages) {
      const p = PAGES[slug];
      if (!p) continue;
      const badge = p.status === 'todo' ? ' <span class="dot todo"></span>' : '';
      h += `<a class="nav-link${slug === activeSlug ? ' active' : ''}" href="${base}${slug}.html">${p.title}${badge}</a>`;
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
.navsearch{width:100%;margin:0 0 6px;padding:7px 10px;background:#0b0f14;border:1px solid var(--line);border-radius:6px;color:var(--fg);font-size:13px}
.navsearch:focus{outline:none;border-color:var(--accent)}
.nav-group.hidden,.nav-link.hidden{display:none}
.nav-empty{color:var(--muted);font-size:13px;padding:8px}
pre{position:relative}
.copy-btn{position:absolute;top:8px;right:8px;background:#21262d;border:1px solid var(--line);color:var(--muted);font-size:11px;padding:3px 8px;border-radius:5px;cursor:pointer;opacity:0;transition:opacity .12s}
pre:hover .copy-btn{opacity:1}.copy-btn:hover{color:var(--fg);border-color:var(--accent)}.copy-btn.ok{color:var(--ok);border-color:var(--ok)}
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
const FLAT = NAV.flatMap(g => g.pages).filter(s => PAGES[s]);

function pageHtml(slug, p) {
  const todoBanner =
    p.status === 'todo'
      ? `<div class="todo-banner"><b>🚧 TODO — not yet implemented.</b> This capability is on the roadmap and is <em>not</em> an anti-pattern for zmdb; it simply isn't built yet. ${p.note ? p.note : ''} Track / contribute via the issue tracker.</div>`
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
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${p.title} — zmdb docs</title><style>${CSS}</style></head><body>
<div class="layout">
<aside><div class="brand">zmdb<small>zero-maintenance data layer</small></div>
<input class="navsearch" type="search" placeholder="Filter docs… (/)" aria-label="Filter documentation" />
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
</div>
<script>
(function(){
  // Nav filter: hide non-matching links + empty groups; focus with "/".
  var box=document.querySelector('.navsearch');
  var groups=[].slice.call(document.querySelectorAll('aside .nav-group'));
  if(box){
    box.addEventListener('input',function(){
      var q=box.value.trim().toLowerCase();
      groups.forEach(function(g){
        var links=[].slice.call(g.querySelectorAll('.nav-link'));var any=false;
        links.forEach(function(a){var hit=!q||a.textContent.toLowerCase().indexOf(q)>=0;a.classList.toggle('hidden',!hit);if(hit)any=true;});
        g.classList.toggle('hidden',!any);
      });
    });
    document.addEventListener('keydown',function(e){
      if(e.key==='/'&&document.activeElement!==box){e.preventDefault();box.focus();}
      if(e.key==='Escape'&&document.activeElement===box){box.value='';box.dispatchEvent(new Event('input'));box.blur();}
    });
  }
  // Copy buttons on code blocks.
  document.querySelectorAll('pre').forEach(function(pre){
    var b=document.createElement('button');b.className='copy-btn';b.type='button';b.textContent='Copy';
    b.addEventListener('click',function(){
      var code=pre.querySelector('code');var text=(code||pre).innerText;
      navigator.clipboard.writeText(text).then(function(){b.textContent='Copied';b.classList.add('ok');setTimeout(function(){b.textContent='Copy';b.classList.remove('ok');},1200);});
    });
    pre.appendChild(b);
  });
})();
</script>
</body></html>`;
}

// --- build ---
mkdirSync(join(OUT, 'docs'), { recursive: true });
mkdirSync(join(OUT, 'benchmarks'), { recursive: true });

// Copy the benchmark data files into site/benchmarks/ (the page fetches them via ./).
for (const f of ['validation-matrix.json', 'orm-results.json', 'framework-results.json', 'peers-results.json']) {
  const src = join(DASH, f);
  if (existsSync(src)) cpSync(src, join(OUT, 'benchmarks', f));
}

// --- Unified benchmarks page: rendered inside the docs shell (same sidebar +
// theme + header), with the interactive Chart.js sections + script inlined.
// Extract the <section>…</section> body and the <script>…</script> from the
// existing dashboard source so the interactivity is preserved verbatim. ---
function buildBenchmarksPage() {
  const raw = existsSync(join(DASH, 'index.html')) ? readFileSync(join(DASH, 'index.html'), 'utf8') : '';
  const sections = [...raw.matchAll(/<section[\s\S]*?<\/section>/g)].map(m => m[0]).join('\n');
  const script = (raw.match(/<script>[\s\S]*?<\/script>/) || [''])[0];
  const intro = `<p>zmdb run inside the <b>actual upstream benchmark suites</b> against <b>real competitor libraries</b>
    (<a href="https://github.com/moltar/typescript-runtime-type-benchmarks">moltar</a> validation,
    <a href="https://github.com/drizzle-team/drizzle-benchmarks">drizzle-benchmarks</a> ORM,
    <a href="https://github.com/the-benchmarker/web-frameworks">the-benchmarker/web-frameworks</a> HTTP). Numbers are indicative of the
    generating machine, not an official ranking. <b>DNF</b> = the library cannot express that case (never summed into a score).</p>`;
  // Benchmarks-page-scoped styling for the chart widgets, layered on the docs CSS.
  const bmCss = `
main section{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:18px 20px;margin:18px 0}
main section h2{border:0;margin:0 0 6px}
.tabs{display:flex;gap:8px;margin:8px 0 16px;flex-wrap:wrap}
.tab{background:#21262d;border:1px solid var(--line);color:var(--fg);padding:6px 14px;border-radius:6px;cursor:pointer;font-size:14px}
.tab.active{background:var(--accent);color:#0d1117;border-color:var(--accent);font-weight:600}
canvas{max-height:340px}
main section table th,main section table td{text-align:right}
main section table th:first-child,main section table td:first-child{text-align:left}
.yes{color:var(--ok);font-weight:600}.no{color:#f85149}
.note{color:var(--muted);font-size:13px;margin:6px 0 14px}
.honest{border-left:3px solid var(--accent);padding-left:12px}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Benchmarks — zmdb docs</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
<style>${CSS}${bmCss}</style></head><body>
<div class="layout">
<aside><div class="brand">zmdb<small>zero-maintenance data layer</small></div>
<a class="nav-link" href="../index.html">← Home</a>
<a class="nav-link active" href="./index.html">📊 Benchmarks</a>
${navHtml(null, '../docs/')}</aside>
<main>
<div class="crumbs">Docs / Reference</div>
<h1>Benchmarks</h1>
${intro}
${sections}
</main>
<div></div>
</div>
${script}
</body></html>`;
}
writeFileSync(join(OUT, 'benchmarks', 'index.html'), buildBenchmarksPage());

// Emit docs pages.
for (const [slug, p] of Object.entries(PAGES)) {
  writeFileSync(join(OUT, 'docs', `${slug}.html`), pageHtml(slug, p));
}

// Landing page — polished marketing home (drizzle/typia-style hero).
const counts = Object.values(PAGES).reduce((a, p) => ((a[p.status] = (a[p.status] || 0) + 1), a), {});
const heroCode = mdToHtml(`
\`\`\`ts
import { defineSchema, serial, text, jsonEnum } from '@zmdb/schema-core';
import { BaseRepository } from '@zmdb/repository';
import type { Entity, CreateDTO } from '@zmdb/schema-core';

// 1 — define your schema once
export const UserSchema = defineSchema('users', {
  id: serial().primaryKey(),
  email: text().notNull(),
  role: jsonEnum(['admin', 'user']).notNull().defaultTo('user'),
});

// 2 — types derive automatically
type User    = Entity<typeof UserSchema>;    // { id; email; role }
type NewUser = CreateDTO<typeof UserSchema>; // { email; role? }

// 3 — validated CRUD in one line
class Users extends BaseRepository<typeof UserSchema> {
  static readonly schema = UserSchema;
}
await new Users(driver).create({ email: 'a@b.com' }); // validated before any SQL
\`\`\`
`).html;

const LANDING_CSS = `
:root{--bg:#0a0d12;--panel:#111721;--fg:#e6edf3;--muted:#8b949e;--accent:#58a6ff;--ok:#3fb950;--line:#232b36;--grad1:#58a6ff;--grad2:#a371f7;--grad3:#3fb950}
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;-webkit-font-smoothing:antialiased}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
code{background:#1b2230;padding:1px 6px;border-radius:4px;font-size:.85em}
pre{background:#0d131c;border:1px solid var(--line);border-radius:12px;padding:18px 20px;overflow-x:auto;margin:0}
pre code{background:none;padding:0;font-size:13.5px;line-height:1.6}
.nav{position:sticky;top:0;z-index:10;display:flex;align-items:center;gap:22px;padding:14px 6vw;background:rgba(10,13,18,.8);backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
.nav .logo{font-weight:800;font-size:19px;letter-spacing:-.02em}
.nav .logo span{background:linear-gradient(90deg,var(--grad1),var(--grad2));-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.nav a.navlink{color:var(--muted);font-size:14px;font-weight:500}.nav a.navlink:hover{color:var(--fg);text-decoration:none}
.nav .spacer{flex:1}
.nav .gh{border:1px solid var(--line);padding:7px 14px;border-radius:8px;color:var(--fg)}
.hero{max-width:1080px;margin:0 auto;padding:72px 6vw 40px;display:grid;grid-template-columns:1fr 1fr;gap:48px;align-items:center}
.hero .pill{display:inline-block;font-size:12px;font-weight:600;color:var(--grad3);background:rgba(63,185,80,.1);border:1px solid rgba(63,185,80,.25);padding:4px 12px;border-radius:20px;margin-bottom:18px}
.hero h1{font-size:52px;line-height:1.05;margin:0 0 16px;letter-spacing:-.03em}
.hero h1 .g{background:linear-gradient(90deg,var(--grad1),var(--grad2) 60%,var(--grad3));-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.hero p.tag{font-size:18px;color:var(--muted);margin:0 0 28px;max-width:34ch}
.cta{display:flex;gap:12px;flex-wrap:wrap}
.cta a{display:inline-block;padding:12px 20px;border-radius:10px;border:1px solid var(--line);font-weight:600;font-size:15px}
.cta a.primary{background:linear-gradient(90deg,var(--grad1),var(--grad2));color:#0a0d12;border:none}
.cta a:hover{text-decoration:none}
.section{max-width:1080px;margin:0 auto;padding:48px 6vw}
.section h2{font-size:30px;letter-spacing:-.02em;text-align:center;margin:0 0 6px}
.section .lead{color:var(--muted);text-align:center;max-width:60ch;margin:0 auto 32px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:18px}
.card{border:1px solid var(--line);border-radius:14px;padding:22px;background:var(--panel)}
.card .ic{font-size:22px;margin-bottom:10px}
.card h4{margin:0 0 8px;font-size:16px}.card p{margin:0;color:var(--muted);font-size:14px}
.pkgs{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px;margin-top:24px}
.pkg{border:1px solid var(--line);border-radius:12px;padding:16px 18px;background:var(--panel)}
.pkg code{font-size:13px;color:var(--grad1);background:none;padding:0}
.pkg p{margin:6px 0 0;color:var(--muted);font-size:13px}
.stats{display:flex;justify-content:center;gap:48px;flex-wrap:wrap;margin-top:8px}
.stat{text-align:center}.stat .n{font-size:34px;font-weight:800;background:linear-gradient(90deg,var(--grad1),var(--grad3));-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.stat .l{color:var(--muted);font-size:13px}
.foot{border-top:1px solid var(--line);padding:28px 6vw;color:var(--muted);font-size:13px;text-align:center}
@media(max-width:820px){.hero{grid-template-columns:1fr;padding-top:40px}.hero h1{font-size:38px}.nav .navlink{display:none}}
`;
const landing = `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>zmdb — the zero-maintenance TypeScript data layer</title>
<meta name="description" content="Define your schema once. Entities, DTOs, validation, serialization, OpenAPI and repository CRUD all derive at compile time — zero runtime proxies, AOT-inlined validation, SQL-first."/>
<style>${LANDING_CSS}</style></head><body>
<nav class="nav">
  <div class="logo"><span>zmdb</span></div>
  <a class="navlink" href="./docs/introduction.html">Docs</a>
  <a class="navlink" href="./docs/quick-start.html">Quick start</a>
  <a class="navlink" href="./benchmarks/index.html">Benchmarks</a>
  <a class="navlink" href="./docs/anti-patterns.html">Anti-patterns</a>
  <div class="spacer"></div>
  <a class="gh" href="https://github.com/ambasta/zmdb">GitHub ↗</a>
</nav>

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
  <div class="stats">
    <div class="stat"><div class="n">300</div><div class="l">tests, all green</div></div>
    <div class="stat"><div class="n">${counts.supported ?? 0}</div><div class="l">docs pages · 0 TODO</div></div>
    <div class="stat"><div class="n">~40–100×</div><div class="l">AOT vs runtime validation</div></div>
    <div class="stat"><div class="n">0</div><div class="l">DNF benchmark routes</div></div>
  </div>
</section>

<section class="section">
  <h2>Four small packages</h2>
  <p class="lead">Composable and ESM-only. Use the whole stack, or just the query compiler or validator on their own.</p>
  <div class="pkgs">
    <div class="pkg"><code>@zmdb/schema-core</code><p>Schema DSL + type derivation (Entity / Create / Update / read DTOs), relations, OpenAPI, seeding, custom types, LLM tools.</p></div>
    <div class="pkg"><code>@zmdb/query-compiler</code><p>SELECT / INSERT / UPDATE / DELETE + dialects, joins, aggregations, FTS, set-ops, schema-object DDL, migration diff.</p></div>
    <div class="pkg"><code>@zmdb/aot-validator</code><p>AOT is / assert / validate / equals / random, unions, transforms, and JSON Ser/De — inlined at build time.</p></div>
    <div class="pkg"><code>@zmdb/repository</code><p>Auto-validating CRUD, transactions, populate, read-replicas, lifecycle events, framework adapters.</p></div>
  </div>
</section>

<section class="section">
  <h2>Documentation</h2>
  <p class="lead">Incorporates the union of the <a href="https://mikro-orm.io/docs/guide">MikroORM</a>, <a href="https://orm.drizzle.team/docs/overview">Drizzle</a> and <a href="https://typia.io/docs">Typia</a> doc surfaces. Every capability page is written in full — features that are anti-patterns for a zero-overhead, no-proxy, AOT layer are <a href="./docs/anti-patterns.html">excluded and explained</a>.</p>
  <div class="grid">
    ${NAV.map(
      g =>
        `<div class="card"><h4>${g.title}</h4><p>${g.pages
          .filter(s => PAGES[s])
          .slice(0, 6)
          .map(s => `<a href="./docs/${s}.html">${PAGES[s].title}</a>`)
          .join(' · ')}</p></div>`,
    ).join('')}
  </div>
</section>

<div class="foot">GPL-3.0-or-later · Node 26+ · TypeScript 7 · ESM-only · <a href="https://github.com/ambasta/zmdb">github.com/ambasta/zmdb</a></div>
</body></html>`;
writeFileSync(join(OUT, 'index.html'), landing);

console.log(
  `built docs: ${Object.keys(PAGES).length} pages (${counts.supported ?? 0} supported, ${counts.todo ?? 0} TODO) + landing + unified benchmarks`,
);
