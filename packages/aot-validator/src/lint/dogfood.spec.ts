import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

it.fails("reports nothing on this repository's own source", () => {
  const temporary = mkdtempSync(join(tmpdir(), 'zmdb-lint-'));
  try {
    const configPath = join(temporary, '.oxlintrc.json');
    writeFileSync(
      configPath,
      JSON.stringify(
        {
          $schema: join(ROOT, 'node_modules/oxlint/configuration_schema.json'),
          jsPlugins: [
            {
              name: 'zmdb',
              specifier: join(ROOT, 'packages/aot-validator/src/lint/index.ts'),
            },
          ],
          ignorePatterns: [
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
          ],
          options: {
            maxWarnings: 0,
            respectEslintDisableDirectives: false,
          },
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
      ['--config', configPath, 'packages', 'fixtures', 'examples', 'benchmarks'],
      {
        cwd: ROOT,
        encoding: 'utf8',
      },
    );
    expect(result.error).toBeUndefined();
    expect(
      {
        status: result.status,
        signal: result.signal,
        stdout: result.stdout,
        stderr: result.stderr,
      },
      `${result.stdout}${result.stderr}`,
    ).toEqual({
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
    });
  } finally {
    rmSync(temporary, { force: true, recursive: true });
  }
});
