import { describe, expect, it } from 'vitest';

import { NAV, PAGES } from './manifest.mjs';
import {
  PALETTE_HTML,
  SHELL_CSS,
  THEME_BOOT,
  queryTerms,
  scoreRecord,
  searchIndexScript,
  shellJs,
  snippetFor,
} from './shell.mjs';

interface Record_ {
  s: string;
  t: string;
  g: string;
  h: string[];
  x: string;
  d?: number;
}

function index(): Record_[] {
  const script = searchIndexScript(PAGES, NAV);
  const json = script.replace(/^window\.__ZMDB_SEARCH__=/, '').replace(/;\n$/, '');
  return JSON.parse(json) as Record_[];
}

describe('docs search index', () => {
  const records = index();

  it('indexes headings and prose, but not code fences or table pipes', () => {
    const quickStart = records.find(r => r.s === 'quick-start');
    expect(quickStart).toBeDefined();
    expect(quickStart?.h.length).toBeGreaterThan(0);
    expect(quickStart?.x).not.toContain('```');
    expect(quickStart?.x).not.toContain('|');
    // Body text is capped so the index stays a download, not a second copy of the
    // whole corpus.
    for (const record of records) expect(record.x.length).toBeLessThanOrEqual(3000);
  });
});

describe('search ranking', () => {
  it('scores a title hit above a slug hit above a heading hit above a body mention', () => {
    const record = {
      s: 'joins-guide',
      t: 'Joins',
      g: 'Data Access',
      h: ['Left join'],
      x: 'A body mentioning cursors.',
    };
    expect(scoreRecord(record, ['joins'])).toBeGreaterThan(scoreRecord(record, ['guide']));
    expect(scoreRecord(record, ['guide'])).toBeGreaterThan(scoreRecord(record, ['left']));
    expect(scoreRecord(record, ['left'])).toBeGreaterThan(scoreRecord(record, ['cursors']));
    expect(scoreRecord(record, ['nowhere'])).toBe(0);
  });

  it('drops filler words from a question', () => {
    expect(queryTerms('how do I paginate')).toEqual(['paginate']);
    // A query that is only filler still searches for what was typed: `is` and `in`
    // are real API names in these docs.
    expect(queryTerms('is')).toEqual(['is']);
  });

  it('does not fold a word into a fragment', () => {
    // Folding must not shorten a word into a fragment.
    expect(scoreRecord({ s: 'x', t: 'Us', g: 'g', h: [], x: '' }, ['uses'])).toBe(0);
  });

  it('breaks a tie against a page that is only a stub', () => {
    const written = { s: 'a', t: 'Views', g: 'Schema', h: [], x: '' };
    const stub = { ...written, s: 'b', d: 1 };
    expect(scoreRecord(written, ['views'])).toBeGreaterThan(scoreRecord(stub, ['views']));
  });
});

describe('search snippets', () => {
  it('highlights the matched term', () => {
    expect(snippetFor('Populate loads relations eagerly.', ['relations'])).toContain('<mark>relations</mark>');
  });

  it('escapes the page text before inserting the highlight', () => {
    const out = snippetFor('Use <script>alert(1)</script> & co', ['script']);
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;');
    expect(out).toContain('&amp;');
    expect(out).toContain('<mark>');
  });

  it('elides from the left when the match is deep in the text', () => {
    const text = `${'padding '.repeat(30)}needle`;
    const out = snippetFor(text, ['needle']);
    expect(out.startsWith('…')).toBe(true);
    expect(out).toContain('<mark>needle</mark>');
  });

  it('treats a regex metacharacter in the query as a literal', () => {
    // "c++" or "a.b" typed into the box must not blow up the RegExp constructor.
    expect(() => snippetFor('The a.b property', ['a.b'])).not.toThrow();
    expect(snippetFor('The a.b property', ['a.b'])).toContain('<mark>a.b</mark>');
  });
});

describe('page shell', () => {
  it('resolves the theme before first paint', () => {
    // A toggle that runs after paint flashes the wrong colours on every load.
    expect(THEME_BOOT).toContain('localStorage.getItem');
    expect(THEME_BOOT).toContain('prefers-color-scheme');
    expect(THEME_BOOT).toContain('documentElement');
  });

  it('defines both themes from one set of variables', () => {
    expect(SHELL_CSS).toContain(':root[data-theme=light]');
    for (const token of ['--tok-keyword', '--tok-string', '--tok-comment', '--accent', '--line']) {
      // Every themed token needs a value in both palettes, or one theme renders a
      // block of invisible code.
      const occurrences = SHELL_CSS.split(`${token}:`).length - 1;
      expect(occurrences, token).toBeGreaterThanOrEqual(2);
    }
  });

  it('ships one ranking implementation, serialised from the tested one', () => {
    const js = shellJs('../');
    expect(js).toContain(scoreRecord.toString());
    expect(js).toContain(snippetFor.toString());
    expect(js).toContain(queryTerms.toString());
  });

  it('loads the index with a script tag rather than fetch, so file:// still works', () => {
    const js = shellJs('../');
    expect(js).toContain("createElement('script')");
    expect(js).toContain("'search-index.js'");
    // Comments are allowed to mention fetch — the point is that none is called,
    // because fetch of a file:// URL is blocked and search would die with it.
    expect(js.replace(/\/\/[^\n]*/g, '')).not.toContain('fetch(');
  });

  it('gives the palette a dialog role and keyboard affordances', () => {
    expect(PALETTE_HTML).toContain('role="dialog"');
    expect(PALETTE_HTML).toContain('aria-modal="true"');
    expect(PALETTE_HTML).toContain('hidden');
    const js = shellJs('./');
    for (const key of ['ArrowDown', 'ArrowUp', 'Enter', 'Escape', 'Tab']) expect(js).toContain(key);
    expect(js).toContain('metaKey');
  });

  it('returns focus to the opener when the palette closes', () => {
    // Closing an aria-modal dialog has to put focus back where it came from,
    // otherwise a keyboard reader loses their place in the page — and the input
    // left focused behind the hidden dialog keeps swallowing the "/" shortcut.
    const js = shellJs('./');
    expect(js).toContain('opener=d.activeElement');
    expect(js).toMatch(/pal\.hidden=true;[\s\S]{0,400}opener\.focus\(\)/);
  });
});
