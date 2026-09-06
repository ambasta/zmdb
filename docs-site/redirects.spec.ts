import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MAPPING } from './coverage/mapping.mjs';
import { DOCUMENTATION_BASELINE, LEGACY_REDIRECTS } from './navigation-plan.mjs';
import { NAV, PAGE_META } from './pages.mjs';

const ROOT = process.cwd();
const TEST_TIMEOUT = 60_000;
const legacySlugs = Object.keys(LEGACY_REDIRECTS);
const legacySet = new Set(legacySlugs);

interface PageMeta {
  readonly status: 'supported' | 'todo' | 'wontfix';
}

interface SearchRecord {
  readonly s: string;
}

interface CommandResult {
  readonly status: number | null;
  readonly output: string;
}

const liveMeta: Readonly<Record<string, PageMeta>> = PAGE_META;
let fixture = '';
let site = '';

function createFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'zmdb-docs-redirects-'));
  cpSync(join(ROOT, 'docs-site'), join(root, 'docs-site'), { recursive: true });
  for (const directory of ['benchmarks', 'fixtures', 'packages', 'scripts', 'node_modules']) {
    symlinkSync(join(ROOT, directory), join(root, directory), 'dir');
  }
  for (const file of ['package.json', 'yarn.lock', 'tsconfig.json', '.yarnrc.yml']) {
    symlinkSync(join(ROOT, file), join(root, file), 'file');
  }
  for (const file of ['ARCHITECTURE.md', 'CHANGELOG.md', 'PUBLISHING.md', 'docs-README.md']) {
    cpSync(join(ROOT, file), join(root, file));
  }
  return root;
}

function build(root: string): CommandResult {
  const result = spawnSync(process.execPath, ['--import=./scripts/ts-specifier-hook.mjs', 'docs-site/build.mjs'], {
    cwd: root,
    encoding: 'utf8',
    timeout: TEST_TIMEOUT,
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

function searchRecords(): SearchRecord[] {
  const source = readFileSync(join(site, 'search-index.js'), 'utf8');
  return JSON.parse(source.replace(/^window\.__ZMDB_SEARCH__=/, '').replace(/;\n$/, '')) as SearchRecord[];
}

function mappedTargets(): string[] {
  const targets: string[] = [];
  for (const table of Object.values(MAPPING)) {
    for (const target of Object.values(table)) {
      if (typeof target === 'string') targets.push(target);
    }
  }
  return targets;
}

describe('GraphQL refusal redirects', { timeout: TEST_TIMEOUT }, () => {
  beforeAll(() => {
    fixture = createFixture();
    site = join(fixture, 'site');
    const result = build(fixture);
    expect(result.status, result.output).toBe(0);
  });

  afterAll(() => {
    if (fixture !== '') rmSync(fixture, { recursive: true, force: true });
  });

  // Measured today: all twelve output paths exist, but they are full content pages
  // emitted from PAGE_META rather than redirect artifacts.
  it.fails('redirects every legacy GraphQL slug to the canonical refusal page', () => {
    const problems: string[] = [];
    for (const slug of legacySlugs) {
      const target = join(site, 'docs', `${slug}.html`);
      if (!existsSync(target)) {
        problems.push(`${slug}: missing output`);
        continue;
      }
      const html = readFileSync(target, 'utf8');
      if (!/http-equiv=["']refresh["']/i.test(html)) problems.push(`${slug}: no immediate refresh`);
      if (!/location\.replace\s*\(/.test(html)) problems.push(`${slug}: no location.replace`);
      if (!/graphql\.html/.test(html)) problems.push(`${slug}: no canonical target`);
    }
    expect(problems).toEqual([]);
  });

  it.fails('emits one and only one canonical GraphQL page', () => {
    const registered = Object.keys(liveMeta).filter(slug => slug === 'graphql' || legacySet.has(slug));
    expect(registered).toEqual(['graphql']);
    expect(liveMeta.graphql?.status).toBe('wontfix');
    expect(existsSync(join(site, 'docs', 'graphql.html'))).toBe(true);
  });

  it.fails('emits offline-safe redirects that preserve the query string and fragment', () => {
    const problems: string[] = [];
    for (const slug of legacySlugs) {
      const html = readFileSync(join(site, 'docs', `${slug}.html`), 'utf8');
      if (!/<link[^>]+rel=["']canonical["'][^>]+graphql\.html/i.test(html)) problems.push(`${slug}: canonical link`);
      if (!/<meta[^>]+http-equiv=["']refresh["'][^>]+graphql\.html/i.test(html)) problems.push(`${slug}: refresh`);
      if (!/location\.replace\s*\(/.test(html) || !/location\.search/.test(html) || !/location\.hash/.test(html)) {
        problems.push(`${slug}: query/fragment preservation`);
      }
      if (!/<meta[^>]+name=["']robots["'][^>]+noindex/i.test(html)) problems.push(`${slug}: noindex`);
      if (!/<a[^>]+href=["'][^"']*graphql\.html["'][^>]*>/i.test(html)) problems.push(`${slug}: fallback link`);
    }
    expect(problems).toEqual([]);
  });

  it.fails('keeps redirect artifacts out of navigation, search, previous-next order and page counts', () => {
    const navSlugs = NAV.flatMap(group => group.pages);
    const searchSlugs = searchRecords().map(record => record.s);
    const landing = readFileSync(join(site, 'index.html'), 'utf8');
    const docsFiles = readdirSync(join(site, 'docs')).filter(file => file.endsWith('.html'));
    const canonicalFiles = docsFiles.filter(file => !legacySet.has(file.replace(/\.html$/, '')));
    const canonicalHtml = canonicalFiles.map(file => readFileSync(join(site, 'docs', file), 'utf8')).join('\n');

    expect(navSlugs).toContain('graphql');
    expect(navSlugs.filter(slug => legacySet.has(slug))).toEqual([]);
    expect(searchSlugs).toContain('graphql');
    expect(searchSlugs.filter(slug => legacySet.has(slug))).toEqual([]);
    expect(searchSlugs).toHaveLength(DOCUMENTATION_BASELINE.target.canonicalPages);
    expect(canonicalFiles).toHaveLength(DOCUMENTATION_BASELINE.target.canonicalPages);
    expect(docsFiles).toHaveLength(
      DOCUMENTATION_BASELINE.target.canonicalPages + DOCUMENTATION_BASELINE.target.redirectArtifacts,
    );
    expect(landing).toContain(
      `<h2>${String(DOCUMENTATION_BASELINE.target.canonicalPages)} pages of documentation</h2>`,
    );
    for (const slug of legacySlugs) expect(canonicalHtml).not.toContain(`href="./${slug}.html"`);
  });

  it.fails('points internal links and upstream coverage mappings directly at graphql', () => {
    const linkedLegacy: string[] = [];
    for (const file of readdirSync(join(ROOT, 'docs-site', 'content')).filter(entry => entry.endsWith('.md'))) {
      const slug = file.replace(/\.md$/, '');
      if (legacySet.has(slug)) continue;
      const source = readFileSync(join(ROOT, 'docs-site', 'content', file), 'utf8');
      for (const match of source.matchAll(/\]\(\.\/(web-graphql[^)#]*?)(?:\.html)?(?:#[^)]*)?\)/g)) {
        linkedLegacy.push(`${file}:${match[1] ?? '<unknown>'}`);
      }
    }

    const mappedLegacy = mappedTargets().filter(slug => legacySet.has(slug));
    expect(linkedLegacy).toEqual([]);
    expect(mappedLegacy).toEqual([]);
    expect(mappedTargets()).toContain('graphql');
  });

  it.fails('keeps the canonical GraphQL page wontfix and names supported alternatives without a roadmap promise', () => {
    const source = readFileSync(join(fixture, 'docs-site', 'content', 'graphql.md'), 'utf8');
    expect(liveMeta.graphql?.status).toBe('wontfix');
    expect(source).toMatch(/not planned/i);
    for (const alternative of ['HTTP', 'OpenAPI', 'client', 'gateway', 'SSE']) {
      expect(source).toMatch(new RegExp(alternative, 'i'));
    }
    expect(source).not.toMatch(/\b(will|roadmap|coming soon)\b/i);
  });
});
