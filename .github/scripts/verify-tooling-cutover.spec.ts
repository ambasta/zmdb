import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

describe('tooling package imports', () => {
  it('keeps Metro owned by its explicit adapter entry', async () => {
    const adapter = await import('@zmdb/compiler/metro');
    const facade = await import('zmdb/compiler');
    for (const name of ['getCacheKey', 'transform', 'withZmdb'] as const) {
      expect(typeof adapter[name]).toBe('function');
      expect(facade).not.toHaveProperty(name);
    }
    expect(facade).not.toHaveProperty('MetroOptions');
  });

  it('imports runtime roots without TypeScript, formatter, CLI, filesystem tooling or optional command modules', () => {
    const directory = mkdtempSync(join(tmpdir(), 'zmdb-tooling-cutover-proof-'));
    try {
      execFileSync(
        process.execPath,
        [
          join(ROOT, 'fixtures/consumer-tooling-cutover/verify-installed.mjs'),
          '--root',
          ROOT,
          '--evidence-dir',
          directory,
        ],
        { cwd: ROOT, env: { ...process.env, ZMDB_CLI_EVIDENCE: directory }, timeout: 600_000, maxBuffer: 16_777_216 },
      );
      const report = JSON.parse(readFileSync(join(directory, 'result.json'), 'utf8'));
      expect(report.ok).toBe(true);
      expect(report.roles).toEqual(['compiler', 'migrations', 'cli', 'product']);
      expect(report.cleanup).toEqual({ children: [], ports: [], processes: [] });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 610_000);
});
