import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CANONICAL_PAGE_ADDITIONS,
  DOCUMENTATION_BASELINE,
  LEGACY_REDIRECTS,
  PRODUCT_JOURNEY,
} from './navigation-plan.mjs';

const ROOT = process.cwd();
const TEST_TIMEOUT = 90_000;

interface CommandResult {
  readonly status: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly output: string;
}

interface Fence {
  readonly slug: string;
  readonly line: number;
  readonly language: 'ts' | 'typescript' | 'tsx';
  readonly metadata: string | undefined;
  readonly code: string;
  readonly indent: number;
  readonly delimiter: number;
}

interface SampleMeta {
  readonly mode?: unknown;
  readonly id?: unknown;
  readonly file?: unknown;
  readonly group?: unknown;
  readonly reason?: unknown;
  readonly diagnostics?: unknown;
  readonly run?: unknown;
  readonly environment?: unknown;
}

function createFixture(): string {
  const fixture = mkdtempSync(join(tmpdir(), 'zmdb-docs-samples-'));
  cpSync(join(ROOT, 'docs-site'), join(fixture, 'docs-site'), { recursive: true });
  for (const directory of ['benchmarks', 'packages', 'scripts', 'node_modules']) {
    symlinkSync(join(ROOT, directory), join(fixture, directory), 'dir');
  }
  for (const file of ['package.json', 'yarn.lock', 'tsconfig.json', '.yarnrc.yml']) {
    symlinkSync(join(ROOT, file), join(fixture, file), 'file');
  }
  return fixture;
}

function withFixture<T>(use: (fixture: string) => T): T {
  const fixture = createFixture();
  try {
    return use(fixture);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

function run(fixture: string, command: string, args: readonly string[], timeout = TEST_TIMEOUT): CommandResult {
  const result = spawnSync(command, [...args], {
    cwd: fixture,
    encoding: 'utf8',
    timeout,
  });
  return {
    status: result.status,
    signal: result.signal,
    output: `${result.stdout}${result.stderr}`,
  };
}

function verifySamples(fixture: string, timeout = TEST_TIMEOUT): CommandResult {
  return run(fixture, 'yarn', ['verify:docs-samples'], timeout);
}

function build(fixture: string): CommandResult {
  return run(fixture, process.execPath, ['--import=./scripts/ts-specifier-hook.mjs', 'docs-site/build.mjs']);
}

function fixtureDocument(...blocks: readonly string[]): string {
  return ['# Fixture', '', ...blocks, ''].join('\n');
}

function sampleFence(
  metadata: string,
  code: readonly string[],
  options: {
    readonly language?: 'ts' | 'typescript' | 'tsx';
    readonly delimiter?: number;
    readonly indent?: number;
  } = {},
): string {
  const language = options.language ?? 'ts';
  const delimiter = '`'.repeat(options.delimiter ?? 3);
  const indent = ' '.repeat(options.indent ?? 0);
  return [
    `${indent}${delimiter}${language}${metadata === '' ? '' : ` ${metadata}`}`,
    ...code.map(line => `${indent}${line}`),
    `${indent}${delimiter}`,
  ].join('\n');
}

function writeSinglePageFixture(fixture: string, markdown: string): void {
  const content = join(fixture, 'docs-site', 'content');
  rmSync(content, { recursive: true, force: true });
  mkdirSync(content, { recursive: true });
  writeFileSync(join(content, 'fixture.md'), markdown);
  writeFileSync(
    join(fixture, 'docs-site', 'pages.mjs'),
    [
      "export const NAV = [{ title: 'Start', pages: ['fixture'] }];",
      "export const PAGE_META = { fixture: { title: 'Fixture', status: 'supported' } };",
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(fixture, 'docs-site', 'navigation-plan.mjs'),
    [
      'export const DOCUMENTATION_BASELINE = { target: { groups: 1, canonicalPages: 1, retainedCurrentPages: 1, addedCanonicalPages: 0, redirectArtifacts: 0 } };',
      "export const PRODUCT_JOURNEY = [{ title: 'Start', pages: ['fixture'] }];",
      'export const CANONICAL_PAGE_ADDITIONS = {};',
      'export const LEGACY_REDIRECTS = {};',
      '',
    ].join('\n'),
  );
}

function parseFences(slug: string, markdown: string): Fence[] {
  const lines = markdown.split('\n');
  const fences: Fence[] = [];

  for (let index = 0; index < lines.length; index++) {
    const opening = /^( {0,3})(`{3,})([^`]*)$/.exec(lines[index] ?? '');
    if (opening === null) continue;
    const indent = opening[1]?.length ?? 0;
    const delimiter = opening[2]?.length ?? 0;
    const info = (opening[3] ?? '').trim();
    const typed = /^(ts|typescript|tsx)(?:\s+(.+))?$/.exec(info);
    const close = new RegExp(`^ {0,3}\`{${String(delimiter)},}\\s*$`);
    const code: string[] = [];
    const line = index + 1;

    index++;
    while (index < lines.length && !close.test(lines[index] ?? '')) {
      code.push(lines[index] ?? '');
      index++;
    }

    if (typed !== null) {
      fences.push({
        slug,
        line,
        language: typed[1] as Fence['language'],
        metadata: typed[2],
        code: code.join('\n'),
        indent,
        delimiter,
      });
    }
  }

  return fences;
}

function asRecord(value: unknown): SampleMeta | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as SampleMeta) : undefined;
}

function metadataErrors(fence: Fence): string[] {
  if (fence.metadata === undefined) return ['metadata is missing'];

  let parsed: unknown;
  try {
    parsed = JSON.parse(fence.metadata);
  } catch {
    return ['metadata is not one JSON object'];
  }

  const meta = asRecord(parsed);
  if (meta === undefined) return ['metadata is not one JSON object'];
  const errors: string[] = [];
  const modes = new Set(['compile', 'expect-error', 'illustrative']);
  const environments = new Set(['node', 'browser', 'react-native']);

  if (typeof meta.mode !== 'string' || !modes.has(meta.mode)) errors.push('mode is invalid');
  if (typeof meta.id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(meta.id)) errors.push('id is invalid');
  if (meta.group !== undefined && (typeof meta.group !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(meta.group))) {
    errors.push('group is invalid');
  }
  if (meta.file !== undefined) {
    if (typeof meta.file !== 'string') {
      errors.push('file is invalid');
    } else {
      const segments = meta.file.split('/');
      if (
        meta.file.includes('\\') ||
        isAbsolute(meta.file) ||
        segments.some(segment => segment === '' || segment === '.' || segment === '..')
      ) {
        errors.push('file is invalid');
      }
    }
  }
  if (meta.group !== undefined && meta.file === undefined) errors.push('group requires file');
  if (meta.environment !== undefined && (typeof meta.environment !== 'string' || !environments.has(meta.environment))) {
    errors.push('environment is invalid');
  }

  if (meta.mode === 'compile') {
    if (meta.reason !== undefined) errors.push('compile forbids reason');
    if (meta.diagnostics !== undefined) errors.push('compile forbids diagnostics');
    if (meta.run !== undefined && meta.run !== true) errors.push('run must be true when present');
    if (meta.run === true && meta.environment === undefined) errors.push('run requires environment');
  }
  if (meta.mode === 'expect-error') {
    if (!Array.isArray(meta.diagnostics) || meta.diagnostics.length === 0)
      errors.push('expect-error requires diagnostics');
    if (meta.reason !== undefined) errors.push('expect-error forbids reason');
    if (meta.run !== undefined) errors.push('expect-error forbids run');
  }
  if (meta.mode === 'illustrative') {
    if (
      typeof meta.reason !== 'string' ||
      meta.reason.trim().length < 12 ||
      /^example(?: only)?[.!]?$/i.test(meta.reason.trim())
    ) {
      errors.push('illustrative requires a meaningful reason');
    }
    if (meta.diagnostics !== undefined) errors.push('illustrative forbids diagnostics');
    if (meta.run !== undefined) errors.push('illustrative forbids run');
  }

  return errors;
}

function retainedTypedFences(): Fence[] {
  const additions = new Set(Object.keys(CANONICAL_PAGE_ADDITIONS));
  const legacy = new Set(Object.keys(LEGACY_REDIRECTS));
  const retained = PRODUCT_JOURNEY.flatMap(group => group.pages).filter(
    slug => !additions.has(slug) && !legacy.has(slug),
  );
  return retained.flatMap(slug =>
    parseFences(slug, readFileSync(join(ROOT, 'docs-site', 'content', `${slug}.md`), 'utf8')),
  );
}

describe('compiled documentation samples', { timeout: TEST_TIMEOUT }, () => {
  // The independent fence walk implements the frozen CommonMark subset rather
  // than today's column-zero renderer. Measured today: all 1,286 retained typed
  // fences are present, including three indented and two long-delimiter fences,
  // and none carries the required JSON metadata object.
  it.fails('classifies every TypeScript and TSX fence', () => {
    const fences = retainedTypedFences();
    const expected =
      DOCUMENTATION_BASELINE.current.typescriptFences.total -
      DOCUMENTATION_BASELINE.current.typescriptFences.redirectSourceFences;
    expect(fences).toHaveLength(expected);
    expect(fences.filter(fence => fence.indent > 0)).toHaveLength(3);
    expect(fences.filter(fence => fence.delimiter > 3)).toHaveLength(2);

    const errors: string[] = [];
    const identities = new Set<string>();
    for (const fence of fences) {
      const one = metadataErrors(fence);
      if (one.length > 0) errors.push(`${fence.slug}:${String(fence.line)} ${one.join(', ')}`);
      if (fence.metadata === undefined) continue;
      try {
        const meta = asRecord(JSON.parse(fence.metadata));
        if (typeof meta?.id !== 'string') continue;
        const identity = `${fence.slug}:${meta.id}`;
        if (identities.has(identity)) errors.push(`${identity} is duplicated`);
        identities.add(identity);
      } catch {
        // The parse error is already recorded by metadataErrors.
      }
    }

    expect(errors).toEqual([]);
  });

  // The runtime throw is deliberate: compile mode must typecheck but must not
  // execute JavaScript without `run: true`.
  it.fails('compiles every compile-mode documentation sample', () => {
    withFixture(fixture => {
      writeSinglePageFixture(
        fixture,
        fixtureDocument(
          sampleFence(JSON.stringify({ mode: 'compile', id: 'valid-public-import' }), [
            "import type { Table } from 'zmdb/tags';",
            "interface User extends Table<'users'> { readonly id: number }",
            'const user: User = { id: 1 };',
            'void user;',
            "throw new Error('compile mode must not execute');",
          ]),
        ),
      );
      const result = verifySamples(fixture);
      expect(result.status, result.output).toBe(0);
      expect(result.output).toMatch(/compile/i);
    });
  });

  it.fails('matches every expect-error sample to its declared diagnostic', () => {
    withFixture(fixture => {
      writeSinglePageFixture(
        fixture,
        fixtureDocument(
          sampleFence(JSON.stringify({ mode: 'expect-error', id: 'declared-diagnostic', diagnostics: ['TS2322'] }), [
            'const value: string = 42;',
            'void value;',
          ]),
        ),
      );
      const result = verifySamples(fixture);
      expect(result.status, result.output).toBe(0);
      expect(result.output).toMatch(/TS2322|declared-diagnostic/i);
    });
  });

  it.fails('refuses an illustrative sample without a reason', () => {
    withFixture(fixture => {
      writeSinglePageFixture(
        fixture,
        fixtureDocument(
          sampleFence(JSON.stringify({ mode: 'illustrative', id: 'missing-reason' }), [
            'const contextProvidedByTheArticle = true;',
          ]),
        ),
      );
      const result = verifySamples(fixture);
      expect(result.status).not.toBe(0);
      expect(result.output).toMatch(/missing-reason/i);
      expect(result.output).toMatch(/reason/i);
    });
  });

  it.fails('refuses a sample importing a private source path', () => {
    withFixture(fixture => {
      writeSinglePageFixture(
        fixture,
        fixtureDocument(
          sampleFence(JSON.stringify({ mode: 'compile', id: 'private-source-import' }), [
            "import type { Table } from '../../packages/schema-core/src/tags/index.js';",
            'const value: Table = {} as Table;',
            'void value;',
          ]),
        ),
      );
      const result = verifySamples(fixture);
      expect(result.status).not.toBe(0);
      expect(result.output).toMatch(/private-source-import/i);
      expect(result.output).toMatch(/private|packages\/schema-core\/src/i);
    });
  });

  it.fails('rejects malformed JSON sample metadata', () => {
    withFixture(fixture => {
      writeSinglePageFixture(
        fixture,
        fixtureDocument(sampleFence('{"mode":"compile","id":"bad-json",}', ['const value = 1;', 'void value;'])),
      );
      const result = verifySamples(fixture);
      expect(result.status).not.toBe(0);
      expect(result.output).toMatch(/fixture/i);
      expect(result.output).toMatch(/json|metadata/i);
    });
  });

  it.fails('rejects invalid modes, identities, paths and mode-specific metadata', () => {
    const invalid = [
      [{ mode: 'unknown', id: 'invalid-mode' }, 'invalid-mode'],
      [{ mode: 'compile', id: 'Upper_Case' }, 'Upper_Case'],
      [{ mode: 'compile', id: 'parent-path', file: '../index.ts' }, 'parent-path'],
      [{ mode: 'compile', id: 'compile-reason', reason: 'not permitted here' }, 'compile-reason'],
      [{ mode: 'compile', id: 'compile-diagnostics', diagnostics: ['TS2322'] }, 'compile-diagnostics'],
      [{ mode: 'compile', id: 'run-without-environment', run: true }, 'run-without-environment'],
      [{ mode: 'expect-error', id: 'missing-diagnostics' }, 'missing-diagnostics'],
      [{ mode: 'expect-error', id: 'error-with-run', diagnostics: ['TS2322'], run: true }, 'error-with-run'],
      [
        { mode: 'expect-error', id: 'error-with-reason', diagnostics: ['TS2322'], reason: 'not permitted' },
        'error-with-reason',
      ],
      [{ mode: 'illustrative', id: 'empty-illustration', reason: 'example only' }, 'empty-illustration'],
      [
        {
          mode: 'illustrative',
          id: 'illustration-diagnostics',
          reason: 'Depends on application state.',
          diagnostics: ['TS1'],
        },
        'illustration-diagnostics',
      ],
      [
        { mode: 'illustrative', id: 'illustration-run', reason: 'Depends on application state.', run: true },
        'illustration-run',
      ],
      [{ mode: 'compile', id: 'group-without-file', group: 'one-project' }, 'group-without-file'],
    ] as const;

    withFixture(fixture => {
      writeSinglePageFixture(
        fixture,
        fixtureDocument(
          ...invalid.map(([meta]) => sampleFence(JSON.stringify(meta), ['const value = 1;', 'void value;'])),
        ),
      );
      const result = verifySamples(fixture);
      expect(result.status).not.toBe(0);
      for (const [, id] of invalid) expect(result.output, id).toContain(id);
    });
  });

  it.fails('compiles grouped multi-file samples once with only intra-group relative imports', () => {
    withFixture(fixture => {
      writeSinglePageFixture(
        fixture,
        fixtureDocument(
          sampleFence(JSON.stringify({ mode: 'compile', id: 'group-model', group: 'small-app', file: 'model.ts' }), [
            'export interface User { readonly name: string }',
          ]),
          sampleFence(JSON.stringify({ mode: 'compile', id: 'group-entry', group: 'small-app', file: 'index.ts' }), [
            "import type { User } from './model.js';",
            "const user: User = { name: 'Ada' };",
            'void user;',
          ]),
        ),
      );
      const result = verifySamples(fixture);
      expect(result.status, result.output).toBe(0);
      expect(result.output).toMatch(/small-app|group/i);
      expect(result.output).toMatch(/2\s+(?:files|file)/i);
    });
  });

  it.fails('rejects inconsistent or ambiguous multi-file groups', () => {
    const blocks = [
      sampleFence(JSON.stringify({ mode: 'compile', id: 'duplicate-a', group: 'duplicate-file', file: 'index.ts' }), [
        'export const one = 1;',
      ]),
      sampleFence(JSON.stringify({ mode: 'compile', id: 'duplicate-b', group: 'duplicate-file', file: 'index.ts' }), [
        'export const two = 2;',
      ]),
      sampleFence(JSON.stringify({ mode: 'compile', id: 'mixed-compile', group: 'mixed-mode', file: 'a.ts' }), [
        'export const one = 1;',
      ]),
      sampleFence(
        JSON.stringify({
          mode: 'expect-error',
          id: 'mixed-error',
          group: 'mixed-mode',
          file: 'b.ts',
          diagnostics: ['TS2322'],
        }),
        ['const value: string = 1;'],
      ),
      sampleFence(
        JSON.stringify({
          mode: 'compile',
          id: 'node-environment',
          group: 'mixed-environment',
          file: 'node.ts',
          environment: 'node',
        }),
        ['export const one = 1;'],
      ),
      sampleFence(
        JSON.stringify({
          mode: 'compile',
          id: 'browser-environment',
          group: 'mixed-environment',
          file: 'browser.ts',
          environment: 'browser',
        }),
        ['export const two = 2;'],
      ),
      sampleFence(
        JSON.stringify({ mode: 'compile', id: 'outside-import', group: 'outside-import', file: 'index.ts' }),
        [
          "import type { Outside } from '../outside.js';",
          'const value: Outside | undefined = undefined;',
          'void value;',
        ],
      ),
    ];

    withFixture(fixture => {
      writeSinglePageFixture(fixture, fixtureDocument(...blocks));
      const result = verifySamples(fixture);
      expect(result.status).not.toBe(0);
      for (const id of ['duplicate-file', 'mixed-mode', 'mixed-environment', 'outside-import']) {
        expect(result.output, id).toContain(id);
      }
    });
  });

  // The first fence is indented by three spaces. The second opens and closes with
  // four backticks so the three-backtick text inside is code, not a close marker.
  // Today's renderer emits neither as an ordinary lang-ts block, and the sample
  // verifier command is absent.
  it.fails('uses one fence parser for rendering and verification', () => {
    withFixture(fixture => {
      writeSinglePageFixture(
        fixture,
        fixtureDocument(
          sampleFence(
            JSON.stringify({ mode: 'compile', id: 'indented-fence' }),
            ['const indented = true;', 'void indented;'],
            { indent: 3 },
          ),
          sampleFence(
            JSON.stringify({ mode: 'compile', id: 'long-delimiter' }),
            ['const literal = "```";', 'void literal;'],
            { delimiter: 4 },
          ),
        ),
      );

      const buildResult = build(fixture);
      expect(buildResult.status, buildResult.output).toBe(0);
      const html = readFileSync(join(fixture, 'site', 'docs', 'fixture.html'), 'utf8');
      expect(html.match(/<pre class="lang-ts">/g)).toHaveLength(2);
      expect(html).toContain('const indented');
      expect(html).toContain('const literal');
      expect(html).not.toContain('"mode":"compile"');

      const verifyResult = verifySamples(fixture);
      expect(verifyResult.status, verifyResult.output).toBe(0);
      expect(verifyResult.output).toMatch(/2\s+(?:files|samples|fences)/i);
    });
  });

  it.fails('bounds explicitly run samples by time and output', () => {
    withFixture(fixture => {
      writeSinglePageFixture(
        fixture,
        fixtureDocument(
          sampleFence(JSON.stringify({ mode: 'compile', id: 'bounded-runtime', run: true, environment: 'node' }), [
            'for (;;) { /* deliberate infinite loop */ }',
          ]),
        ),
      );
      const result = verifySamples(fixture, 15_000);
      expect(result.signal).toBeNull();
      expect(result.status).not.toBe(0);
      expect(result.output).toMatch(/bounded-runtime/i);
      expect(result.output).toMatch(/time|timeout|limit/i);
    });
  });

  it.fails('refuses runtime samples that contact external state without an issue-owned fixture', () => {
    withFixture(fixture => {
      writeSinglePageFixture(
        fixture,
        fixtureDocument(
          sampleFence(JSON.stringify({ mode: 'compile', id: 'external-network', run: true, environment: 'node' }), [
            "await fetch('https://example.com');",
          ]),
        ),
      );
      const result = verifySamples(fixture);
      expect(result.status).not.toBe(0);
      expect(result.output).toMatch(/external-network/i);
      expect(result.output).toMatch(/network|external state|fixture/i);
    });
  });

  it.fails('reports modes, environments, illustrative reasons, groups, files and diagnostics', () => {
    withFixture(fixture => {
      writeSinglePageFixture(
        fixture,
        fixtureDocument(
          sampleFence(JSON.stringify({ mode: 'compile', id: 'reported-run', run: true, environment: 'node' }), [
            "console.log('bounded output');",
          ]),
          sampleFence(JSON.stringify({ mode: 'expect-error', id: 'reported-error', diagnostics: ['TS2322'] }), [
            'const value: string = 1;',
            'void value;',
          ]),
          sampleFence(
            JSON.stringify({
              mode: 'illustrative',
              id: 'reported-illustration',
              reason: 'The application supplies the surrounding request context.',
            }),
            ['handle(applicationContext);'],
          ),
        ),
      );
      const result = verifySamples(fixture);
      expect(result.status, result.output).toBe(0);
      for (const term of ['compile', 'expect-error', 'illustrative', 'node', 'TS2322', 'request context']) {
        expect(result.output).toMatch(new RegExp(term, 'i'));
      }
      expect(result.output).toMatch(/3\s+(?:files|samples|fences)/i);
    });
  });
});
