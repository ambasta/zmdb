#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { publishManifest, publishTrain } from '../../.github/scripts/lib/publish-manifest.mjs';

const FIXTURE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(FIXTURE, '../..');
const RELEASE_VERSION = (await publishTrain(ROOT)).version;
const PACKAGES = join(ROOT, 'packages');
const TSC = join(ROOT, 'node_modules', '.bin', 'tsc');
const BUILD_ORDER = ['query-compiler', 'schema-core', 'ai', 'mcp'];

function run(command, arguments_, options = {}) {
  return spawnSync(command, arguments_, { encoding: 'utf8', ...options });
}

function requireSuccess(label, result) {
  if (result.status !== 0) {
    throw new Error(`${label} failed with ${String(result.status)}\n${result.stdout ?? ''}\n${result.stderr ?? ''}`);
  }
}

function packageName(directory) {
  return JSON.parse(readFileSync(join(PACKAGES, directory, 'package.json'), 'utf8')).name;
}

const temporary = mkdtempSync(join(tmpdir(), 'zmdb-mcp-consumer-'));
try {
  const tarballs = new Map();
  for (const directory of BUILD_ORDER) {
    const name = packageName(directory);
    requireSuccess(`${name} build`, run('yarn', ['workspace', name, 'build'], { cwd: ROOT }));

    const source = join(PACKAGES, directory);
    const stage = join(temporary, 'stage', directory);
    mkdirSync(dirname(stage), { recursive: true });
    cpSync(source, stage, {
      recursive: true,
      dereference: true,
      filter: path => !path.split(sep).includes('node_modules'),
    });
    const committed = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'));
    writeFileSync(
      join(stage, 'package.json'),
      `${JSON.stringify(publishManifest(committed, RELEASE_VERSION), null, 2)}\n`,
    );
    const packed = run('npm', ['pack', '--json', '--pack-destination', temporary], {
      cwd: stage,
      env: { ...process.env, COREPACK_ENABLE_PROJECT_SPEC: '0' },
    });
    requireSuccess(`${name} npm pack`, packed);
    const report = JSON.parse(packed.stdout);
    const entry = Array.isArray(report) ? report[0] : Object.values(report)[0];
    if (entry === undefined || typeof entry.filename !== 'string') {
      throw new Error(`npm pack returned no filename for ${name}`);
    }
    tarballs.set(name, join(temporary, entry.filename));
  }

  const app = join(temporary, 'consumer');
  mkdirSync(app, { recursive: true });
  cpSync(join(FIXTURE, 'package.json'), join(app, 'package.json'));
  cpSync(join(FIXTURE, 'runtime.mjs'), join(app, 'runtime.mjs'));
  cpSync(join(FIXTURE, 'contracts.ts'), join(app, 'contracts.ts'));
  cpSync(join(FIXTURE, 'tsconfig.consumer.json'), join(app, 'tsconfig.consumer.json'));

  for (const [name, tarball] of tarballs) {
    const installed = join(app, 'node_modules', ...name.split('/'));
    mkdirSync(installed, { recursive: true });
    requireSuccess(`${name} extraction`, run('tar', ['-xzf', tarball, '-C', installed, '--strip-components=1']));
  }

  const nodeModulesEntries = readdirSync(join(app, 'node_modules')).toSorted();
  if (JSON.stringify(nodeModulesEntries) !== JSON.stringify(['@zmdb'])) {
    throw new Error(`packed consumer installed an external SDK: ${nodeModulesEntries.join(', ')}`);
  }

  const scopeEntries = readdirSync(join(app, 'node_modules', '@zmdb')).toSorted();
  const expected = ['ai', 'mcp', 'query-compiler', 'schema-core'];
  if (JSON.stringify(scopeEntries) !== JSON.stringify(expected)) {
    throw new Error(`packed consumer installed unexpected @zmdb packages: ${scopeEntries.join(', ')}`);
  }

  const mcpManifest = JSON.parse(readFileSync(join(app, 'node_modules', '@zmdb', 'mcp', 'package.json'), 'utf8'));
  if (JSON.stringify(mcpManifest.dependencies) !== JSON.stringify({ '@zmdb/ai': RELEASE_VERSION })) {
    throw new Error(`packed @zmdb/mcp dependencies are ${JSON.stringify(mcpManifest.dependencies)}`);
  }
  if (mcpManifest.peerDependencies !== undefined) {
    throw new Error(`packed @zmdb/mcp has peers: ${JSON.stringify(mcpManifest.peerDependencies)}`);
  }
  requireSuccess('packed MCP runtime', run(process.execPath, ['runtime.mjs'], { cwd: app }));
  requireSuccess('packed MCP declarations', run(TSC, ['--noEmit', '-p', 'tsconfig.consumer.json'], { cwd: app }));
  process.stdout.write('packed MCP consumer passed with only @zmdb/ai as its direct runtime dependency\n');
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
