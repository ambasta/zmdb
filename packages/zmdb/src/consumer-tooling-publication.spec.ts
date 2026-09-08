import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, it } from 'vitest';

import { publishManifest } from '../../../.github/scripts/lib/publish-manifest.mjs';
import { PACKED_BUILD_TEST_TIMEOUT_MS } from '../../../fixtures/client-adapters/src/packed-project.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const fixture = join(root, 'fixtures/consumer-tooling-publication');

it('publishes the synchronous Metro require condition at its single emitted owner', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'packages/compiler/package.json'), 'utf8'));
  const published = publishManifest(manifest);
  const exportMap = published.exports;
  assert(exportMap !== null && typeof exportMap === 'object');
  expect(Reflect.get(exportMap, './metro')).toEqual({
    types: './dist/metro/metro.d.ts',
    import: './dist/metro/metro.js',
    require: './dist/metro/metro.js',
  });
  for (const [name, target] of Object.entries(exportMap)) {
    if (name !== './metro') expect(target).not.toHaveProperty('require');
  }
});

it('refuses an invalid publication invocation before creating a consumer', () => {
  const result = spawnSync(process.execPath, [join(fixture, 'verify-installed.mjs'), '--unknown'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 10_000,
  });
  expect(result.status, result.stderr).toBe(2);
  expect(result.stdout).toBe('');
  expect(result.stderr).toBe('invalid invocation\n');
});

it(
  'qualifies every packed tooling export and real project plugin Metro and SQLite workflow',
  () => {
    const evidence = mkdtempSync(join(dirname(root), 'tooling-publication-evidence-'));
    try {
      const result = spawnSync(
        process.execPath,
        [join(fixture, 'verify-installed.mjs'), '--root', root, '--evidence-dir', evidence],
        { cwd: root, encoding: 'utf8', timeout: PACKED_BUILD_TEST_TIMEOUT_MS, maxBuffer: 8_388_608 },
      );
      expect(result.status, result.stderr + result.stdout).toBe(0);
      const report = JSON.parse(readFileSync(join(evidence, 'result.json'), 'utf8'));
      const expected = JSON.parse(readFileSync(join(fixture, 'expected.json'), 'utf8'));
      expect(report.ok).toBe(true);
      expect(report.roles).toEqual(expected.roles);
      expect(report.compiler.subpaths).toEqual(expected.compiler.subpaths);
      expect(report.compiler.routes).toEqual(expected.compiler.routes);
      expect(report.compiler.runtime).toEqual(expected.compiler.runtime);
      expect(report.compiler.transformedBytesEqual).toBe(true);
      expect(report.compiler.projectPredicateEqual).toBe(true);
      expect(report.compiler.unconfiguredRefused).toBe(true);
      expect(report.compiler.nodeFloor).toBe('v26.0.0');
      expect(report.compiler.synchronousMetroRequire).toBe(true);
      expect(report.migrations.subpaths).toEqual(expected.migrations.subpaths);
      expect(report.migrations.embeddedRollback).toBe(true);
      expect(report.cli.subpaths).toEqual(expected.cli.subpaths);
      expect(report.cli.cases).toEqual(expected.cli.cases);
      expect(report.cleanup.activeProcesses).toEqual([]);
      expect(report.cleanup.directoriesRemoved).toBe(true);
      expect(existsSync(report.directory)).toBe(false);
    } finally {
      rmSync(evidence, { recursive: true, force: true });
    }
  },
  PACKED_BUILD_TEST_TIMEOUT_MS + 10_000,
);
