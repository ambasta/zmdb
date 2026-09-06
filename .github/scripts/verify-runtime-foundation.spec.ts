import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadGovernanceSnapshot } from '../../scripts/architecture/governance.mjs';
import {
  analyzeRuntimeFoundation,
  CONSUMER_FIXTURES,
  FOUNDATION_PACKAGES,
  readRuntimeFoundationBaseline,
} from './verify-runtime-foundation.mjs';

const ROOT = process.cwd();
const GOVERNANCE = await loadGovernanceSnapshot({ root: ROOT, checks: [] });
if (GOVERNANCE.architecture === null) throw new Error('governance snapshot has no architecture');
const SCRIPT = join(ROOT, '.github', 'scripts', 'verify-runtime-foundation.mjs');
const scratch: string[] = [];

function write(path: string, contents: string): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, contents);
}

function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'zmdb-runtime-foundation-verifier-'));
  scratch.push(root);
  for (const target of FOUNDATION_PACKAGES) {
    const directory = join(root, 'packages', target.dir);
    mkdirSync(join(directory, 'src'), { recursive: true });
    const dependencies = Object.fromEntries(target.dependencies.map(name => [name, 'workspace:^']));
    const exports = Object.fromEntries(target.exports.map(subpath => [subpath, './src/index.ts']));
    writeFileSync(
      join(directory, 'package.json'),
      `${JSON.stringify(
        {
          name: target.name,
          version: '1.0.0-test.0',
          type: 'module',
          exports,
          dependencies,
        },
        null,
        2,
      )}\n`,
    );
    const imports =
      target.name === '@zmdb/validator'
        ? "import type { SchemaIR } from '@zmdb/schema/ir';\nexport type Witness = SchemaIR;\n"
        : target.name === '@zmdb/orm'
          ? [
              "import type { SchemaIR } from '@zmdb/schema/ir';",
              "import type { CompiledQuery } from '@zmdb/sql';",
              "import type { ValidateResult } from '@zmdb/validator';",
              'export type Composition = readonly [SchemaIR, CompiledQuery, ValidateResult<unknown>];',
              '',
            ].join('\n')
          : 'export const packageBoundary = true;\n';
    writeFileSync(join(directory, 'src', 'index.ts'), imports);
  }
  return root;
}

function analyzeFixture(root: string): readonly string[] {
  const workspacePackages = FOUNDATION_PACKAGES.map(target => {
    const directory = `packages/${target.dir}`;
    const directoryPath = join(root, directory);
    const manifestPath = join(directoryPath, 'package.json');
    return {
      directory,
      directoryPath,
      manifestPath,
      manifest: JSON.parse(readFileSync(manifestPath, 'utf8')) as Readonly<Record<string, unknown>>,
    };
  });
  return analyzeRuntimeFoundation(root, {
    architecture: {
      root,
      packages: workspacePackages.map((packageRecord, index) => ({
        ...packageRecord,
        id: FOUNDATION_PACKAGES[index]?.dir ?? '',
        npmName: FOUNDATION_PACKAGES[index]?.name ?? '',
      })),
      workspacePackages,
    },
    checkConsumers: false,
    checkLegacy: false,
    checkOwnership: false,
  });
}

afterEach(() => {
  for (const directory of scratch.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('runtime foundation boundary verifier (#636)', () => {
  it('accepts the exact four-package DAG', () => {
    expect(analyzeFixture(fixtureRoot())).toEqual([]);
  });

  it('rejects every forbidden runtime edge and external foundation dependency', () => {
    const builtIn = fixtureRoot();
    write(join(builtIn, 'packages', 'sql', 'src', 'index.ts'), "import 'node:fs';\n");
    expect(analyzeFixture(builtIn)).toContainEqual(expect.stringContaining('@zmdb/sql reaches forbidden built-in'));

    const upward = fixtureRoot();
    write(join(upward, 'packages', 'schema', 'src', 'index.ts'), "export { packageBoundary } from '@zmdb/orm';\n");
    expect(analyzeFixture(upward)).toContainEqual(
      expect.stringContaining('@zmdb/schema reaches forbidden workspace package @zmdb/orm'),
    );

    const transitive = fixtureRoot();
    write(join(transitive, 'packages', 'schema', 'src', 'index.ts'), "import 'provider-sdk';\n");
    const transitiveProblems = analyzeFixture(transitive);
    expect(transitiveProblems).toContainEqual(
      expect.stringContaining('@zmdb/schema reaches external package provider-sdk'),
    );
    expect(transitiveProblems).toContainEqual(
      expect.stringContaining('@zmdb/validator reaches external package provider-sdk'),
    );

    const peer = fixtureRoot();
    const validatorManifest = join(peer, 'packages', 'validator', 'package.json');
    const manifest = JSON.parse(readFileSync(validatorManifest, 'utf8')) as Record<string, unknown>;
    writeFileSync(
      validatorManifest,
      `${JSON.stringify({ ...manifest, peerDependencies: { 'provider-sdk': '^1.0.0' } }, null, 2)}\n`,
    );
    write(join(peer, 'packages', 'validator', 'src', 'index.ts'), "import 'provider-sdk';\n");
    expect(analyzeFixture(peer)).toEqual(
      expect.arrayContaining([
        '@zmdb/validator has forbidden peerDependencies [provider-sdk]',
        expect.stringContaining('@zmdb/validator reaches external package provider-sdk'),
      ]),
    );
  });

  it('defines four consumers without workspace aliases or compiler paths', () => {
    const problems = analyzeRuntimeFoundation(ROOT, { architecture: GOVERNANCE.architecture }).filter(
      problem =>
        problem.includes('packed consumer') ||
        problem.includes('workspace alias') ||
        problem.includes('compilerOptions.paths'),
    );
    expect(CONSUMER_FIXTURES).toHaveLength(4);
    expect(problems).toEqual([]);
  });

  it('matches the checked-in live-tree ratchet', () => {
    const output = execFileSync(process.execPath, [SCRIPT], { cwd: ROOT, encoding: 'utf8' });
    const baseline = readRuntimeFoundationBaseline();
    expect(output).toContain(`${String(baseline.length)} frozen finding(s)`);
  });

  it.fails('loads no compiler, formatter, provider, concrete external driver or CLI from foundation roots', () => {
    const result = spawnSync(process.execPath, [SCRIPT, '--strict'], { cwd: ROOT, encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
  });
});
