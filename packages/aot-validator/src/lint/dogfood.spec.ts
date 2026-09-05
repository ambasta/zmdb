import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const IGNORE_PATTERNS = [
  '.git/**',
  '.pnp.*',
  '.yarn/**',
  '**/.cache/**',
  '**/coverage/**',
  '**/dist/**',
  '**/node_modules/**',
  'site/**',
  'benchmarks/harness/framework/.bin/**',
  'benchmarks/upstream/**',
  'benchmarks/harness/framework/peers/**',
  '**/.results/**',
  '**/*.app.mjs',
  'packages/aot-validator/src/lint/__fixtures__/*.input.ts',
];

it("reports nothing on this repository's own source", () => {
  const temporary = mkdtempSync(join(tmpdir(), 'zmdb-lint-'));
  try {
    const configPath = join(temporary, '.oxlintrc.json');
    const sourceHook = `--import=${join(ROOT, 'scripts/ts-specifier-hook.mjs')}`;
    const nodeOptions =
      process.env.NODE_OPTIONS === undefined ? sourceHook : `${process.env.NODE_OPTIONS} ${sourceHook}`;
    writeFileSync(
      configPath,
      JSON.stringify(
        {
          $schema: join(ROOT, 'node_modules/oxlint/configuration_schema.json'),
          categories: {
            correctness: 'off',
            nursery: 'off',
            pedantic: 'off',
            perf: 'off',
            restriction: 'off',
            style: 'off',
            suspicious: 'off',
          },
          jsPlugins: [
            {
              name: 'zmdb',
              specifier: join(ROOT, 'packages/aot-validator/src/lint/index.ts'),
            },
          ],
          options: {
            maxWarnings: 0,
            respectEslintDisableDirectives: false,
          },
          overrides: [
            {
              files: [join(ROOT, 'packages/schema-core/src/json.type-test.ts')],
              rules: {
                // This compile-only assertion deliberately demonstrates the
                // invalid `unknown & Sql<'json'>` reduction that the rule reports.
                'zmdb/no-unknown-json-column': 'off',
              },
            },
          ],
          rules: {
            'zmdb/no-distributed-nullable-tags': 'error',
            'zmdb/no-interpolated-sql': 'error',
            'zmdb/no-unknown-json-column': 'error',
          },
        },
        null,
        2,
      ),
    );

    const result = spawnSync(
      join(ROOT, 'node_modules/.bin/oxlint'),
      [
        '--silent',
        '--disable-nested-config',
        '--config',
        configPath,
        '--threads=1',
        ...IGNORE_PATTERNS.flatMap(pattern => ['--ignore-pattern', pattern]),
        'packages',
        'fixtures',
        'examples',
        'benchmarks',
      ],
      {
        cwd: ROOT,
        encoding: 'utf8',
        // The published plugin contains real `.js` siblings. This source-tree
        // dogfood run needs the same `.js` -> `.ts` resolver as the repo's
        // other direct TypeScript entry points.
        env: { ...process.env, NODE_OPTIONS: nodeOptions },
      },
    );
    expect(result.error).toBeUndefined();
    const output = `${result.stdout}${result.stderr}`;
    expect(result.status, output).toBe(0);
    expect(result.signal, output).toBeNull();
    expect(result.stderr, output).toBe('');
    expect(result.stdout, output).toMatch(
      /^(?:|Found 0 warnings and 0 errors\.\r?\nFinished in [^\r\n]+ on \d+ files with 3 rules using 1 threads\.\r?\n)$/,
    );
  } finally {
    rmSync(temporary, { force: true, recursive: true });
  }
});
