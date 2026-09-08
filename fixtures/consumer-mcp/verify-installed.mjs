#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { cpSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { publishManifest } from '../../.github/scripts/lib/publish-manifest.mjs';
import { command as runInstalledCommand, startRegistry } from '../consumer-cli/registry.mjs';

const FIXTURE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(FIXTURE, '../..');
const PACKAGES = join(ROOT, 'packages');
const BUILD_ORDER = ['schema', 'validator', 'ai', 'mcp'];

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

async function digest(bytes, algorithm = 'SHA-256', encoding = 'hex') {
  const hash = new Uint8Array(await crypto.subtle.digest(algorithm, bytes));
  if (encoding === 'base64') {
    return typeof hash.toBase64 === 'function' ? hash.toBase64() : Buffer.from(hash).toString('base64');
  }
  return typeof hash.toHex === 'function' ? hash.toHex() : Buffer.from(hash).toString('hex');
}

const temporary = mkdtempSync(join(tmpdir(), 'zmdb-mcp-consumer-'));
let registry;
let report;
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
    const manifest = publishManifest(committed);
    writeFileSync(join(stage, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    const packed = run('npm', ['pack', '--json', '--pack-destination', temporary], {
      cwd: stage,
      env: { ...process.env, COREPACK_ENABLE_PROJECT_SPEC: '0' },
    });
    requireSuccess(`${name} npm pack`, packed);
    const packedReport = JSON.parse(packed.stdout);
    const entry = Array.isArray(packedReport) ? packedReport[0] : Object.values(packedReport)[0];
    if (entry === undefined || typeof entry.filename !== 'string') {
      throw new Error(`npm pack returned no filename for ${name}`);
    }
    const file = join(temporary, entry.filename);
    const bytes = readFileSync(file);
    tarballs.set(name, {
      file,
      manifest,
      sha256: await digest(bytes),
      shasum: await digest(bytes, 'SHA-1'),
      integrity: `sha512-${await digest(bytes, 'SHA-512', 'base64')}`,
    });
  }

  const app = join(temporary, 'consumer');
  mkdirSync(app, { recursive: true });
  cpSync(join(FIXTURE, 'package.json'), join(app, 'package.json'));
  cpSync(join(FIXTURE, 'runtime.mjs'), join(app, 'runtime.mjs'));
  cpSync(join(FIXTURE, 'contracts.ts'), join(app, 'contracts.ts'));
  cpSync(join(FIXTURE, 'tsconfig.consumer.json'), join(app, 'tsconfig.consumer.json'));

  registry = await startRegistry(tarballs);
  for (const operation of ['install', 'ci']) {
    await runInstalledCommand(
      'npm',
      [operation, '--ignore-scripts', '--no-audit', '--no-fund', '--registry', registry.origin],
      {
        cwd: app,
        expected: 0,
      },
    );
  }

  const scopeEntries = readdirSync(join(app, 'node_modules', '@zmdb')).toSorted();
  const expected = ['ai', 'mcp', 'schema', 'validator'];
  if (JSON.stringify(scopeEntries) !== JSON.stringify(expected)) {
    throw new Error(`packed consumer installed unexpected @zmdb packages: ${scopeEntries.join(', ')}`);
  }
  const lock = JSON.parse(readFileSync(join(app, 'package-lock.json'), 'utf8'));
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (path === '') continue;
    const installedName = path.split('node_modules/').at(-1);
    if (entry.dev !== true && !expected.some(name => installedName === `@zmdb/${name}`)) {
      throw new Error(`packed consumer installed an external runtime SDK: ${path}`);
    }
  }
  for (const [name, archive] of tarballs) {
    const path = `node_modules/${name}`;
    const entry = lock.packages[path];
    if (
      entry?.integrity !== archive.integrity ||
      entry?.resolved !== `${registry.origin}/tarballs/${archive.sha256}.tgz`
    ) {
      throw new Error(`installed ${name} did not resolve its captured npm archive`);
    }
    if (lstatSync(join(app, path)).isSymbolicLink()) throw new Error(`installed ${name} is a workspace link`);
  }

  const mcpManifest = JSON.parse(readFileSync(join(app, 'node_modules', '@zmdb', 'mcp', 'package.json'), 'utf8'));
  const aiVersion = JSON.parse(readFileSync(join(PACKAGES, 'ai', 'package.json'), 'utf8')).version;
  if (JSON.stringify(mcpManifest.dependencies) !== JSON.stringify({ '@zmdb/ai': aiVersion })) {
    throw new Error(`packed @zmdb/mcp dependencies are ${JSON.stringify(mcpManifest.dependencies)}`);
  }
  if (mcpManifest.peerDependencies !== undefined) {
    throw new Error(`packed @zmdb/mcp has peers: ${JSON.stringify(mcpManifest.peerDependencies)}`);
  }
  requireSuccess('packed MCP runtime', run(process.execPath, ['runtime.mjs'], { cwd: app }));
  requireSuccess(
    'packed MCP declarations',
    run(join(app, 'node_modules', '.bin', 'tsc'), ['--noEmit', '-p', 'tsconfig.consumer.json'], { cwd: app }),
  );
  report = {
    packages: expected,
    archives: [...tarballs.values()].map(({ manifest, sha256, integrity }) => ({
      name: manifest.name,
      sha256,
      integrity,
    })),
    lockSha256: await digest(readFileSync(join(app, 'package-lock.json'))),
    install: 0,
    ci: 0,
    runtime: 0,
    declarations: 0,
  };
} finally {
  try {
    await registry?.close();
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}
process.stdout.write(`${JSON.stringify({ ...report, cleaned: true })}\n`);
process.stdout.write('packed MCP consumer passed with only @zmdb/ai as its direct runtime dependency\n');
