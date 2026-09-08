import { readFence } from './fences.mjs';
import { highlight } from './highlight.mjs';

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

export function mdToHtml(md) {
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
    const fence = readFence(lines, i);
    if (fence) {
      const lang = fence.language.replace(/[^a-zA-Z0-9_-]/g, '');
      const code = fence.code;
      i = fence.next;
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
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !readFence(lines, i) &&
      !/^(#{1,4}\s|(\s*)(?:[-*]|\d+\.)\s|\||>)/.test(lines[i])
    )
      para += (para ? ' ' : '') + lines[i++];
    html += `<p>${renderInline(para)}</p>`;
  }
  return { html, toc };
}
