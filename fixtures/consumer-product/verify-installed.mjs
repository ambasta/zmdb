#!/usr/bin/env node
import assert from 'node:assert/strict';
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const source = dirname(fileURLToPath(import.meta.url));
const root = resolve(source, '../..');
function bytesToBase64(bytes) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let base64 = '';
  const len = bytes.length;
  for (let i = 0; i < len; i += 3) {
    const b1 = bytes[i] ?? 0;
    const b2 = i + 1 < len ? (bytes[i + 1] ?? 0) : 0;
    const b3 = i + 2 < len ? (bytes[i + 2] ?? 0) : 0;
    const tri = (b1 << 16) | (b2 << 8) | b3;
    base64 += chars[(tri >> 18) & 63] + chars[(tri >> 12) & 63];
    base64 += i + 1 < len ? chars[(tri >> 6) & 63] : '=';
    base64 += i + 2 < len ? chars[tri & 63] : '=';
  }
  return base64;
}

const hash = async (bytes, algorithm = 'SHA-256', encoding = 'hex') => {
  const input = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
  const digest = new Uint8Array(await crypto.subtle.digest(algorithm, input));
  if (encoding === 'base64') {
    return typeof digest.toBase64 === 'function' ? digest.toBase64() : bytesToBase64(digest);
  }
  return typeof digest.toHex === 'function'
    ? digest.toHex()
    : Array.from(digest, b => b.toString(16).padStart(2, '0')).join('');
};
const inside = (parent, child) => {
  const path = relative(parent, child);
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
};
async function files(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await files(path)));
    else if (entry.isFile()) result.push(path);
  }
  return result;
}
async function privateImports(paths, consumer) {
  const found = [];
  for (const file of paths) {
    if (!/\.[cm]?[jt]s$/.test(file)) continue;
    const text = await readFile(file, 'utf8');
    for (const match of text.matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)['"](@zmdb\/[^'"]+)['"]/g)) {
      if (match[1] === '@zmdb/core' || match[1].startsWith('@zmdb/core/')) continue;
      found.push(`${relative(consumer, file)}: ${match[1]}`);
    }
  }
  return found.toSorted();
}

/** Qualify the default product journey using actual supplied publication archives. */
export async function qualifyProductConsumer({ tarballs, evidence }) {
  assert(isAbsolute(evidence));
  assert(!inside(root, resolve(evidence)), 'product evidence must be outside the workspace');
  await mkdir(evidence, { recursive: true, mode: 0o700 });
  const { command, startRegistry } = await import('../consumer-cli/registry.mjs');
  const report = { cleaned: false, failures: [], commands: [], archives: [] };
  let consumer, registry;
  try {
    const records = new Map();
    for (const { manifest, tarball } of tarballs) {
      assert(isAbsolute(tarball));
      assert(!records.has(manifest.name), `duplicate archive ${manifest.name}`);
      const bytes = await readFile(tarball);
      const record = {
        manifest,
        file: tarball,
        sha256: await hash(bytes),
        integrity: `sha512-${await hash(bytes, 'SHA-512', 'base64')}`,
        shasum: await hash(bytes, 'SHA-1'),
      };
      records.set(manifest.name, record);
      report.archives.push({ name: manifest.name, sha256: record.sha256, integrity: record.integrity });
    }
    assert(records.has('@zmdb/core'));
    registry = await startRegistry(records);
    consumer = await mkdtemp(join(evidence, 'consumer-'));
    const manifest = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
    manifest.dependencies['@zmdb/core'] = records.get('@zmdb/core').manifest.version;
    await writeFile(join(consumer, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
    await writeFile(join(consumer, '.npmrc'), '');
    const flags = [
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--package-lock=true',
      '--registry',
      registry.origin,
      '--cache',
      join(consumer, '.npm-cache'),
      '--userconfig',
      join(consumer, '.npmrc'),
    ];
    await command('npm', ['install', ...flags], {
      cwd: consumer,
      timeout: 600_000,
      expected: 0,
      log: join(evidence, 'install.json'),
    });
    await rm(join(consumer, 'node_modules'), { recursive: true });
    await command('npm', ['ci', ...flags], {
      cwd: consumer,
      timeout: 600_000,
      expected: 0,
      log: join(evidence, 'ci.json'),
    });
    const lock = JSON.parse(await readFile(join(consumer, 'package-lock.json'), 'utf8'));
    await cp(join(consumer, 'package-lock.json'), join(evidence, 'package-lock.json'));
    assert.deepEqual(lock.packages[''].dependencies, manifest.dependencies);
    assert.deepEqual(lock.packages[''].devDependencies, manifest.devDependencies);
    const required = new Set();
    function visit(name) {
      if (required.has(name) || !records.has(name)) return;
      required.add(name);
      const current = records.get(name).manifest;
      for (const dependency of Object.keys(current.dependencies ?? {})) visit(dependency);
      for (const peer of Object.keys(current.peerDependencies ?? {})) {
        if (!current.peerDependenciesMeta?.[peer]?.optional) visit(peer);
      }
    }
    visit('@zmdb/core');
    const installed = [],
      workspaceLeaks = [];
    for (const [path, locked] of Object.entries(lock.packages)) {
      if (!path) continue;
      const name = path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
      if (!name.startsWith('@zmdb/')) continue;
      const record = records.get(name);
      assert(record, `unprovided product dependency ${name}`);
      assert.equal(locked.resolved, `${registry.origin}/tarballs/${record.sha256}.tgz`);
      assert.equal(locked.integrity, record.integrity);
      const location = join(consumer, path);
      if ((await lstat(location)).isSymbolicLink() || !inside(consumer, await realpath(location))) {
        workspaceLeaks.push(path);
      }
      const installedManifest = JSON.parse(await readFile(join(location, 'package.json'), 'utf8'));
      assert.equal(installedManifest.version, record.manifest.version);
      installed.push(name);
    }
    report.installation = {
      directZmdbDependencies: Object.keys(manifest.dependencies).filter(name => name.startsWith('@zmdb/')),
      packageManager: 'npm',
      workspaceLeaks,
      ci: true,
      archiveIntegrity: true,
      optionalInstalled: installed.filter(name => !required.has(name)).toSorted(),
      optionalLoaded: [],
    };
    for (const member of [
      'src',
      'contracts.ts',
      'zmdb.config.ts',
      'tsconfig.consumer.json',
      'build.mjs',
      'trace.mjs',
    ]) {
      await cp(join(source, member), join(consumer, member), { recursive: true });
    }
    const sourceInputs = [
      ...(await files(join(consumer, 'src'))),
      join(consumer, 'contracts.ts'),
      join(consumer, 'zmdb.config.ts'),
      join(consumer, 'build.mjs'),
    ];
    const originalPrivateImports = await privateImports(sourceInputs, consumer);
    const trace = join(consumer, 'modules.jsonl');
    const env = { ZMDB_PRODUCT_DATABASE: join(consumer, 'product.sqlite'), ZMDB_PRODUCT_TRACE: trace };
    const traceFile = join(consumer, 'trace.mjs');
    let generated;
    for (const name of ['codegen', 'generate', 'migrate', 'check']) {
      const argv = ['--import', traceFile, join(consumer, 'node_modules/.bin/zmdb'), name];
      if (name === 'generate') argv.push('--name', 'create_orders');
      argv.push('--json');
      const result = await command(process.execPath, argv, {
        cwd: consumer,
        env,
        expected: 0,
        log: join(evidence, `${name}.json`),
      });
      const output = JSON.parse(result.stdout);
      assert.equal(output.ok, true, `${name} did not report success`);
      assert.equal(output.config, join(consumer, 'zmdb.config.ts'));
      report.commands.push({ command: name, status: result.code });
      if (name === 'generate') generated = output.result;
    }
    assert.equal(typeof generated?.file, 'string');
    const sqlFiles = (await files(join(consumer, 'migrations'))).filter(path => path.endsWith('.sql'));
    assert.equal(sqlFiles.length, 1);
    assert.equal(resolve(consumer, generated.file), sqlFiles[0]);
    const sql = await readFile(sqlFiles[0], 'utf8');
    assert(sql.startsWith('-- zmdb:up\n'));
    const down = sql.indexOf('-- zmdb:down\n');
    assert(down > '-- zmdb:up\n'.length);
    const checksum = `sha256:${await hash(sql.slice('-- zmdb:up\n'.length, down))}`;
    await writeFile(join(evidence, 'generated-migration.sql'), sql);
    const tsconfig = JSON.parse(await readFile(join(consumer, 'tsconfig.consumer.json'), 'utf8'));
    const types = await command(join(consumer, 'node_modules/.bin/tsc'), ['-p', 'tsconfig.consumer.json'], {
      cwd: consumer,
      env,
      expected: 0,
      log: join(evidence, 'typecheck.json'),
    });
    report.typecheck = {
      status: types.code,
      skipLibCheck: tsconfig.compilerOptions.skipLibCheck,
      paths: Object.hasOwn(tsconfig.compilerOptions, 'paths'),
    };
    await mkdir(join(consumer, 'dist'));
    await command(process.execPath, ['--import', traceFile, 'build.mjs', 'src/main.ts', 'dist/main.mjs'], {
      cwd: consumer,
      env,
      expected: 0,
      log: join(evidence, 'aot-build.json'),
    });
    const executed = await command(process.execPath, ['--import', traceFile, 'dist/main.mjs'], {
      cwd: consumer,
      env,
      expected: 0,
      log: join(evidence, 'http-runtime.json'),
    });
    report.http = JSON.parse(executed.stdout);
    assert.equal(report.http.ledger.length, 1);
    assert.equal(report.http.ledger[0].version, generated.version);
    assert.equal(report.http.ledger[0].name, generated.name);
    report.migration = {
      generated: true,
      ledgerRows: report.http.ledger.length,
      table: 'orders',
      checksumMatches: report.http.ledger[0].checksum === checksum,
      columns: report.http.columns,
    };
    const requiredImports = JSON.parse(await readFile(join(source, 'expected.json'), 'utf8')).publicImports;
    await command(
      process.execPath,
      [
        '--import',
        traceFile,
        '--input-type=module',
        '-e',
        `for(const entry of ${JSON.stringify(requiredImports)}) await import(entry);`,
      ],
      {
        cwd: consumer,
        env,
        expected: 0,
        log: join(evidence, 'public-imports.json'),
      },
    );
    const loaded = (await readFile(trace, 'utf8'))
      .trim()
      .split('\n')
      .map(line => JSON.parse(line));
    await writeFile(join(evidence, 'modules.json'), JSON.stringify(loaded, null, 2) + '\n');
    const optionalLoaded = new Set();
    for (const entry of loaded) {
      if (!entry.url.startsWith('file:')) continue;
      const path = fileURLToPath(entry.url);
      if (inside(root, path) || !inside(consumer, path)) workspaceLeaks.push(entry.url);
      const match = /\/node_modules\/(@zmdb\/[^/]+)/.exec(path);
      if (match && !required.has(match[1])) optionalLoaded.add(match[1]);
      if (match && /\/src\//.test(path.slice(path.indexOf('/node_modules/')))) workspaceLeaks.push(entry.url);
    }
    report.installation.optionalLoaded = [...optionalLoaded].toSorted();
    report.installation.workspaceLeaks = [...new Set(workspaceLeaks)].toSorted();
    report.publicImports = {
      privateImports: originalPrivateImports,
      generatedPrivateImports: await privateImports(
        [...(await files(join(consumer, 'src'))), ...(await files(join(consumer, 'dist')))],
        consumer,
      ),
      loaded: [
        ...new Set(
          loaded.map(entry => entry.specifier).filter(name => name === '@zmdb/core' || name.startsWith('@zmdb/core/')),
        ),
      ].toSorted(),
    };
  } catch (error) {
    report.failures.push(String(error.stack ?? error));
  } finally {
    const cleanup = await Promise.allSettled([
      (async () => {
        if (registry) await registry.close();
      })(),
      (async () => {
        if (consumer) await rm(consumer, { recursive: true });
      })(),
    ]);
    report.cleaned = cleanup.every(result => result.status === 'fulfilled');
    for (const result of cleanup) {
      if (result.status === 'rejected')
        report.failures.push(`cleanup: ${String(result.reason.stack ?? result.reason)}`);
    }
    await writeFile(join(evidence, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  }
  return report;
}

async function main() {
  const suppliedEvidence = process.env.ZMDB_PRODUCT_EVIDENCE;
  const evidence = suppliedEvidence ?? (await mkdtemp(join(tmpdir(), 'zmdb-product-proof-')));
  await mkdir(evidence, { recursive: true, mode: 0o700 });
  process.env.ZMDB_CLI_EVIDENCE = join(evidence, 'setup');
  const { createFixture } = await import('../consumer-cli/registry.mjs');
  let fixture;
  let report = { cleaned: false, failures: [] };
  try {
    fixture = await createFixture();
    const archiveDirectory = join(evidence, 'archives');
    await mkdir(archiveDirectory);
    const tarballs = [];
    for (const record of fixture.records.values()) {
      const tarball = join(archiveDirectory, `${record.sha256}.tgz`);
      await cp(record.file, tarball);
      tarballs.push({ manifest: record.manifest, tarball });
    }
    await writeFile(join(evidence, 'tarballs.json'), JSON.stringify(tarballs, null, 2) + '\n');
    report = await qualifyProductConsumer({ tarballs, evidence: join(evidence, 'qualification') });
  } catch (error) {
    report.failures.push(String(error.stack ?? error));
  } finally {
    try {
      if (fixture) await fixture.cleanup();
    } catch (error) {
      report.cleaned = false;
      report.failures.push(`setup cleanup: ${String(error.stack ?? error)}`);
    }
    await writeFile(join(evidence, 'result.json'), JSON.stringify(report, null, 2) + '\n');
    if (suppliedEvidence === undefined) await rm(evidence, { recursive: true });
  }
  process.stdout.write(JSON.stringify(report) + '\n');
  process.exitCode = report.failures.length === 0 && report.cleaned ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
