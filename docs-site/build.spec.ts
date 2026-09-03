import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const SITE_DIR = join(ROOT, 'site');
const DASH_DIR = join(ROOT, 'benchmarks', 'site');
/** These assertions invoke a real docs build, so leave headroom for a saturated CI host. */
const BUILD_TIMEOUT = 30_000;

function build() {
  // `--import`: the generator imports the packages' sources, which name their siblings as
  // `./x.js`. See `scripts/ts-specifier-hook.mjs` for why plain `node` needs help with that.
  const nodeMajor = parseInt(process.versions.node, 10);
  const flags = nodeMajor < 26 ? ['--js-explicit-resource-management'] : [];
  execFileSync('node', [...flags, '--import=./scripts/ts-specifier-hook.mjs', 'docs-site/build.mjs'], {
    cwd: ROOT,
    stdio: 'pipe',
  });
}

function benchmarksHtml() {
  return readFileSync(join(SITE_DIR, 'benchmarks', 'index.html'), 'utf8');
}

// The dashboard embeds its data rather than fetching it, so the page works from
// file:// — which also means the test can read exactly what the browser would.
function embeddedData(html: string): Record<string, unknown> {
  const match = /window\.__ZMDB_BENCH__=(\{[\s\S]*?\});<\/script>/.exec(html);
  expect(match).not.toBeNull();
  return JSON.parse((match as RegExpExecArray)[1].replace(/\\u003c/g, '<')) as Record<string, unknown>;
}

describe('docs site generator', { timeout: BUILD_TIMEOUT }, () => {
  afterAll(() => {
    // Leave the tree in a built state; other checks and the pages workflow expect it.
    build();
  }, BUILD_TIMEOUT);

  it('emits the landing page, every docs page, the benchmarks dashboard and the OpenAPI spec', () => {
    rmSync(SITE_DIR, { recursive: true, force: true });
    build();

    expect(existsSync(join(SITE_DIR, 'index.html'))).toBe(true);
    expect(existsSync(join(SITE_DIR, 'docs', 'quick-start.html'))).toBe(true);
    expect(existsSync(join(SITE_DIR, 'benchmarks', 'index.html'))).toBe(true);
    expect(existsSync(join(SITE_DIR, 'openapi.json'))).toBe(true);
    expect(existsSync(join(SITE_DIR, 'docs', 'openapi.json'))).toBe(true);

    const spec = JSON.parse(readFileSync(join(SITE_DIR, 'openapi.json'), 'utf8'));
    expect(spec.openapi).toBe('3.0.3');
    expect(spec.paths['/users']).toBeDefined();
    expect(spec.components.schemas.User).toBeDefined();
  });

  it('renders navigation ownership in breadcrumbs, sidebar counts and previous-next order', () => {
    build();
    const introduction = readFileSync(join(SITE_DIR, 'docs', 'introduction.html'), 'utf8');
    const codemod = readFileSync(join(SITE_DIR, 'docs', 'codemod.html'), 'utf8');

    expect(introduction.match(/<details class="nav-group"/g)).toHaveLength(10);
    expect(introduction).toContain('<summary class="nav-title">Start<span class="count">14</span></summary>');
    expect(introduction).toContain('<div class="crumbs"><a href="../index.html">Docs</a> / Start</div>');
    expect(codemod).toMatch(/href="\.\/web-faq\.html"[\s\S]*?← Previous/);
    expect(codemod).toMatch(/href="\.\/configuration\.html"[\s\S]*?Next →/);
  });

  it('renders each measured suite from its normalised JSON, with provenance', () => {
    build();
    const html = benchmarksHtml();
    const data = embeddedData(html);

    for (const suite of ['validation', 'orm', 'framework']) {
      const measured = existsSync(join(DASH_DIR, `${suite}.json`));
      expect(html).toContain(`id="suite-${suite}"`);
      // A suite is either rendered from real data or explicitly reported as not
      // measured. There is no third state, and in particular no zero-filled one.
      if (measured) {
        expect(data[suite]).not.toBeNull();
        expect(html).not.toContain(`No <code>benchmarks/site/${suite}.json</code>`);
      } else {
        expect(data[suite]).toBeNull();
        expect(html).toContain(`No <code>benchmarks/site/${suite}.json</code>`);
      }
    }

    // Provenance is part of the claim, not decoration.
    expect(html).toContain('Provenance &amp; methodology');
    expect(html).toContain('Grafted commit');
    // The dashboard must not depend on a CDN: the docs site is meant to be usable
    // offline and from a file:// path.
    expect(html).not.toMatch(/<script[^>]+src=/);
  });

  it('reports a suite as not measured instead of inventing zeroes', () => {
    const missing = join(DASH_DIR, 'framework.json');
    const backup = `${missing}.spec-backup`;
    const had = existsSync(missing);
    if (had) cpSync(missing, backup);
    try {
      rmSync(missing, { force: true });
      build();
      const html = benchmarksHtml();
      expect(html).toContain('Not measured on this build');
      expect(html).toContain('yarn bench:framework');
      expect(embeddedData(html).framework).toBeNull();
      expect(existsSync(join(SITE_DIR, 'benchmarks', 'framework.json'))).toBe(false);
    } finally {
      if (had) {
        cpSync(backup, missing);
        rmSync(backup, { force: true });
      }
    }
  });

  it('survives an unparseable results file rather than emitting a half-rendered panel', () => {
    const target = join(DASH_DIR, 'orm.json');
    const backup = `${target}.spec-backup`;
    const had = existsSync(target);
    if (had) cpSync(target, backup);
    try {
      mkdirSync(DASH_DIR, { recursive: true });
      writeFileSync(target, '{ not json');
      build();
      const html = benchmarksHtml();
      expect(html).toContain('Not measured on this build');
      expect(embeddedData(html).orm).toBeNull();
    } finally {
      if (had) {
        cpSync(backup, target);
        rmSync(backup, { force: true });
      } else {
        rmSync(target, { force: true });
      }
    }
  });
});
