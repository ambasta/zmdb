import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { publishCatalog, publishManifest } from '../../.github/scripts/lib/publish-manifest.mjs';
import { cleanEnvironment, command } from '../consumer-cli/registry.mjs';
import { startRegistry } from '../consumer-jobs-providers/registry.mjs';
import {
  CLIENTS,
  DATABASES,
  inspectInstalledConsumer,
  requireServices,
  SERVICE_VARIABLES,
} from './verify-installed.mjs';

await import('../../scripts/ts-specifier-hook.mjs');
const { withPackedBuildLock } = await import('../client-adapters/src/packed-project.js');

const root = fileURLToPath(new URL('../..', import.meta.url));
const fixture = import.meta.dirname;
const arguments_ = process.argv.slice(2);
let selected = DATABASES;
let servicesFile = process.env.ZMDB_DATABASE_PUBLICATION_SERVICES;
let evidence;
for (let index = 0; index < arguments_.length; index++) {
  const option = arguments_[index];
  if (option === '--all') selected = DATABASES;
  else if (option === '--database') {
    const database = arguments_[++index];
    assert(DATABASES.includes(database), `unknown database: ${database}`);
    selected = [database];
  } else if (option === '--services') servicesFile = arguments_[++index];
  else if (option === '--evidence') evidence = resolve(arguments_[++index]);
  else throw new Error(`unknown qualification option: ${option}`);
}

const report = { selected, packages: [], commands: [], consumers: [], failures: [], cleanupErrors: [], cleaned: false };
const groups = new Set();
let directory;
let registry;
let interrupted;
let secretValues = [];
const redact = value => secretValues.reduce((text, secret) => text.replaceAll(secret, '[REDACTED]'), String(value));
const stopAdmission = signal => {
  interrupted = new Error(`qualification interrupted by ${signal}`);
};
const onInterrupt = () => stopAdmission('SIGINT');
const onTerminate = () => stopAdmission('SIGTERM');
process.on('SIGINT', onInterrupt);
process.on('SIGTERM', onTerminate);
const admit = () => {
  if (interrupted) throw interrupted;
};

function synchronous(executable, argv, cwd, label) {
  admit();
  const result = spawnSync(executable, argv, {
    cwd,
    encoding: 'utf8',
    detached: true,
    env: { ...cleanEnvironment(), COREPACK_ENABLE_PROJECT_SPEC: '0' },
    timeout: 120_000,
    killSignal: 'SIGKILL',
    maxBuffer: 8_388_608,
  });
  if (Number.isInteger(result.pid) && result.pid > 0) groups.add(result.pid);
  report.commands.push({ label, executable, argv, code: result.status, stdout: result.stdout, stderr: result.stderr });
  assert.equal(result.status, 0, `${label}: ${result.error?.message ?? ''}\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

async function consumerCommand(database, label, executable, argv, cwd, env = {}) {
  admit();
  const log = join(cwd, `command-${label.replaceAll(' ', '-')}.json`);
  let result;
  try {
    result = await command(executable, argv, { cwd, env, timeout: 120_000, log });
  } catch (error) {
    // The shared command helper writes its receipt before rejecting a timeout.
    if (existsSync(log)) {
      result = JSON.parse(await readFile(log, 'utf8'));
      if (Number.isInteger(result.pid) && result.pid > 0) groups.add(result.pid);
      report.commands.push({ database, label, ...result });
    }
    throw error;
  }
  if (Number.isInteger(result.pid) && result.pid > 0) groups.add(result.pid);
  report.commands.push({ database, label, executable, argv, ...result });
  assert.equal(result.code, 0, `${database} ${label}\n${result.stdout}\n${result.stderr}`);
  admit();
  return result;
}

try {
  const supplied = {
    ...Object.fromEntries(
      Object.values(SERVICE_VARIABLES)
        .filter(name => process.env[name] !== undefined)
        .map(name => [name, process.env[name]]),
    ),
    ...(servicesFile === undefined ? {} : JSON.parse(await readFile(servicesFile, 'utf8'))),
  };
  secretValues = Object.values(supplied).filter(value => typeof value === 'string' && value.length > 0);
  for (const value of Object.values(supplied).filter(
    inputValue => typeof inputValue === 'string' && inputValue.length > 0,
  )) {
    try {
      const password = new URL(value).password;
      if (password) secretValues.push(decodeURIComponent(password));
    } catch {
      /* SQL Server also accepts its native connection string. */
    }
    const password = /(?:^|;)Password=([^;]+)/i.exec(value)?.[1];
    if (password) secretValues.push(password);
  }
  requireServices(selected, supplied);
  const catalog = await publishCatalog(root);
  const byName = new Map(catalog.map(entry => [entry.npmName, entry]));
  const visiting = new Set();
  const ordered = [];
  const visit = name => {
    if (ordered.some(entry => entry.npmName === name)) return;
    assert(!visiting.has(name), `runtime package cycle at ${name}`);
    const entry = byName.get(name);
    assert(entry, `no published package owns ${name}`);
    visiting.add(name);
    const dependencies = {
      ...entry.manifest.dependencies,
      ...Object.fromEntries(
        Object.entries(entry.manifest.peerDependencies ?? {}).filter(
          ([peer]) => entry.manifest.peerDependenciesMeta?.[peer]?.optional !== true,
        ),
      ),
    };
    for (const dependency of Object.keys(dependencies).filter(value => value.startsWith('@zmdb/'))) visit(dependency);
    visiting.delete(name);
    ordered.push(entry);
  };
  for (const database of selected) visit(`@zmdb/${database}`);
  const temporaryRoot = process.env.ZMDB_DATABASE_PUBLICATION_TMPDIR ?? tmpdir();
  await mkdir(temporaryRoot, { recursive: true });
  directory = await mkdtemp(join(temporaryRoot, 'zmdb-database-publication-'));
  const archives = join(directory, 'archives');
  const stages = join(directory, 'stages');
  mkdirSync(archives);
  mkdirSync(stages);
  const tarballs = new Map();
  withPackedBuildLock(root, () => {
    for (const entry of ordered) {
      const source = join(root, entry.directory);
      synchronous(process.execPath, [join(root, 'scripts/build-package.mjs')], source, `build ${entry.npmName}`);
    }
    for (const entry of ordered) {
      const source = join(root, entry.directory);
      const stage = join(stages, entry.id);
      mkdirSync(stage);
      const manifest = publishManifest(entry.manifest);
      for (const member of manifest.files) {
        const path = join(source, member);
        if (existsSync(path)) cpSync(path, join(stage, member), { recursive: true });
      }
      writeFileSync(join(stage, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
      const packed = JSON.parse(
        synchronous(
          'npm',
          ['pack', '--json', '--ignore-scripts', '--pack-destination', archives],
          stage,
          `pack ${entry.npmName}`,
        ),
      );
      const archivesReport = Array.isArray(packed) ? packed : Object.values(packed);
      assert.equal(archivesReport.length, 1);
      const tarball = join(archives, archivesReport[0].filename);
      assert(existsSync(tarball));
      tarballs.set(entry.npmName, { manifest, tarball });
    }
  });
  /* eslint-disable no-restricted-globals, no-restricted-properties */
  function toBase64(bytes) {
    return typeof bytes.toBase64 === 'function' ? bytes.toBase64() : globalThis.Buffer.from(bytes).toString('base64');
  }
  /* eslint-enable no-restricted-globals, no-restricted-properties */

  const integrities = {};
  for (const [name, record] of tarballs) {
    const bytes = await readFile(record.tarball);
    const d = new Uint8Array(await crypto.subtle.digest('SHA-512', bytes));
    integrities[name] = `sha512-${toBase64(d)}`;
    report.packages.push({ name, version: record.manifest.version, integrity: integrities[name] });
  }
  registry = await startRegistry([...tarballs.values()]);
  const results = await Promise.allSettled(
    selected.map(async database => {
      admit();
      const consumer = join(directory, database);
      await mkdir(join(consumer, 'src'), { recursive: true });
      const dependencies = Object.fromEntries(
        [`@zmdb/${database}`, '@zmdb/migrations', '@zmdb/orm', '@zmdb/sql'].map(name => [
          name,
          `file:${tarballs.get(name).tarball}`,
        ]),
      );
      const client = CLIENTS[database];
      if (client) dependencies[client] = { pg: '8.23.0', mysql2: '3.24.3', mssql: '12.7.0' }[client];
      const devDependencies = { typescript: '7.0.2', '@types/node': '26.4.1' };
      if (client === 'pg') devDependencies['@types/pg'] = '8.23.1';
      if (client === 'mssql') devDependencies['@types/mssql'] = '12.3.0';
      await writeFile(
        join(consumer, 'package.json'),
        JSON.stringify(
          { name: `zmdb-publication-${database}`, private: true, type: 'module', dependencies, devDependencies },
          null,
          2,
        ) + '\n',
      );
      await writeFile(
        join(consumer, '.npmrc'),
        `registry=https://registry.npmjs.org/\n@zmdb:registry=${registry.origin}/\n`,
      );
      await writeFile(join(consumer, 'user.npmrc'), '');
      const installEnvironment = {
        COREPACK_ENABLE_PROJECT_SPEC: '0',
        NPM_CONFIG_USERCONFIG: join(consumer, 'user.npmrc'),
      };
      for (const file of ['contracts.ts', 'runtime.mjs', 'verify-installed.mjs', 'tsconfig.json'])
        await copyFile(join(fixture, file), join(consumer, file));
      const providerSource = join(root, 'fixtures', `database-${database}`, 'src');
      await copyFile(
        join(providerSource, database === 'sqlite' ? 'types.ts' : 'contracts.ts'),
        join(consumer, 'provider-contracts.ts'),
      );
      await copyFile(
        join(providerSource, database === 'mssql' ? 'acceptance.mjs' : 'runtime.mjs'),
        join(consumer, 'src/provider.mjs'),
      );
      await consumerCommand(
        database,
        'npm install',
        'npm',
        ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--loglevel=error'],
        consumer,
        installEnvironment,
      );
      const installed = await inspectInstalledConsumer(consumer, database, integrities);
      await consumerCommand(
        database,
        'public selectors',
        process.execPath,
        ['verify-installed.mjs', database],
        consumer,
      );
      await consumerCommand(
        database,
        'strict declarations',
        process.execPath,
        ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json'],
        consumer,
      );
      const environment =
        database === 'sqlite' ? {} : { [SERVICE_VARIABLES[database]]: supplied[SERVICE_VARIABLES[database]] };
      const runtime = await consumerCommand(
        database,
        'generated database workflow',
        process.execPath,
        ['runtime.mjs', database],
        consumer,
        environment,
      );
      const provider = await consumerCommand(
        database,
        'provider runtime and refusals',
        process.execPath,
        ['src/provider.mjs'],
        consumer,
        environment,
      );
      return {
        database,
        installed,
        runtime: JSON.parse(runtime.stdout.trim()),
        provider: { code: provider.code, stdout: provider.stdout },
      };
    }),
  );
  for (const [index, result] of results.entries()) {
    if (result.status === 'fulfilled') report.consumers.push(result.value);
    else report.failures.push({ database: selected[index], message: redact(result.reason?.stack ?? result.reason) });
  }
  assert.deepEqual(
    report.consumers.map(value => value.database).toSorted(),
    [...selected].toSorted(),
    'every selected real database consumer must complete',
  );
} catch (error) {
  report.failures.push({ stage: 'qualification', message: redact(error.stack ?? error) });
} finally {
  for (const pid of groups) {
    try {
      process.kill(-pid, 'SIGTERM');
    } catch (error) {
      if (error.code !== 'ESRCH') report.cleanupErrors.push(String(error));
      continue;
    }
    await delay(100);
    try {
      process.kill(-pid, 'SIGKILL');
    } catch (error) {
      if (error.code !== 'ESRCH') report.cleanupErrors.push(String(error));
      continue;
    }
    const deadline = Date.now() + 1_000;
    for (;;) {
      try {
        process.kill(-pid, 0);
      } catch (error) {
        if (error.code !== 'ESRCH') report.cleanupErrors.push(String(error));
        break;
      }
      if (Date.now() >= deadline) {
        report.cleanupErrors.push(`owned process group ${pid} did not stop`);
        break;
      }
      await delay(25);
    }
  }
  if (registry) {
    try {
      report.registryRequests = [...registry.requests];
      await registry.close();
      registry = undefined;
    } catch (error) {
      report.cleanupErrors.push(String(error));
    }
  }
  if (directory) {
    try {
      await rm(directory, { recursive: true, force: true });
    } catch (error) {
      report.cleanupErrors.push(String(error));
    }
  }
  report.cleaned =
    registry === undefined && (directory === undefined || !existsSync(directory)) && report.cleanupErrors.length === 0;
  process.removeListener('SIGINT', onInterrupt);
  process.removeListener('SIGTERM', onTerminate);
  if (interrupted) report.failures.push({ stage: 'interruption', message: interrupted.message });
}
const serialized = redact(JSON.stringify(report));
if (evidence !== undefined) {
  await mkdir(dirname(evidence), { recursive: true });
  await writeFile(evidence, serialized + '\n');
}
process.stdout.write(serialized + '\n');
if (report.failures.length > 0 || !report.cleaned) process.exitCode = 1;
