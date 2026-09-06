import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';

import { publishManifest, publishTrain } from './lib/publish-manifest.mjs';

const DATABASE_PACKAGES = [
  '@zmdb/sqlite',
  '@zmdb/postgres',
  '@zmdb/mysql',
  '@zmdb/mssql',
  '@zmdb/cockroach',
  '@zmdb/singlestore',
];
const OPTIONAL_DATABASE_INSTALLS = [
  ...DATABASE_PACKAGES,
  'pg',
  'mysql2',
  'mssql',
  'tedious',
  'better-sqlite3',
  'sqlite3',
];

function run(command, args, options = {}) {
  return spawnSync(command, args, { encoding: 'utf8', ...options });
}

function output(result) {
  return [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
}

function workspacePackages(root) {
  const packages = new Map();
  const packageRoot = join(root, 'packages');
  for (const entry of readdirSync(packageRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = join(packageRoot, entry.name);
    const manifestPath = join(directory, 'package.json');
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (typeof manifest.name === 'string') packages.set(manifest.name, { directory, manifest });
  }
  return packages;
}

function dependencyClosure(packages, roots) {
  const found = new Set();
  const visit = name => {
    if (found.has(name)) return;
    const pkg = packages.get(name);
    if (pkg === undefined) throw new Error(`workspace package is absent: ${name}`);
    for (const dependency of Object.keys(pkg.manifest.dependencies ?? {})) {
      if (packages.has(dependency)) visit(dependency);
    }
    found.add(name);
  };
  for (const root of roots) visit(root);
  return [...found];
}

function copyForPack(source, destination) {
  cpSync(source, destination, {
    recursive: true,
    dereference: true,
    filter: path => !path.split(sep).includes('node_modules'),
  });
}

function buildPackages(root, packages, names) {
  for (const name of names) {
    const pkg = packages.get(name);
    if (pkg?.manifest.scripts?.build === undefined) continue;
    const result = run('yarn', ['workspace', name, 'build'], { cwd: root });
    if (result.status !== 0) throw new Error(`focused build failed for ${name}: ${output(result)}`);
  }
}

async function packPackages(root, packages, names, scratch) {
  const version = (await publishTrain(root)).version;
  const archives = new Map();
  for (const name of names) {
    const pkg = packages.get(name);
    if (pkg === undefined) throw new Error(`cannot pack absent workspace package ${name}`);
    const stage = join(scratch, 'stage', name.replaceAll('/', '__'));
    mkdirSync(dirname(stage), { recursive: true });
    copyForPack(pkg.directory, stage);
    writeFileSync(join(stage, 'package.json'), `${JSON.stringify(publishManifest(pkg.manifest, version), null, 2)}\n`);
    const result = run('npm', ['pack', '--json', '--pack-destination', scratch], {
      cwd: stage,
      env: { ...process.env, COREPACK_ENABLE_PROJECT_SPEC: '0' },
    });
    if (result.status !== 0) throw new Error(`npm pack failed for ${name}: ${output(result)}`);
    const report = JSON.parse(result.stdout);
    const row = Array.isArray(report) ? report[0] : Object.values(report)[0];
    if (row === undefined || typeof row.filename !== 'string') {
      throw new Error(`npm pack returned no archive for ${name}`);
    }
    archives.set(name, join(scratch, row.filename));
  }
  return archives;
}

function installPackedApp(directory, archives, names) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, 'package.json'),
    `${JSON.stringify(
      {
        name: 'zmdb-database-package-proof',
        private: true,
        type: 'module',
        dependencies: Object.fromEntries(
          names.map(name => {
            const archive = archives.get(name);
            if (archive === undefined) throw new Error(`packed archive is absent: ${name}`);
            return [name, `file:${archive}`];
          }),
        ),
      },
      null,
      2,
    )}\n`,
  );
  const installed = run(
    'npm',
    [
      'install',
      '--ignore-scripts',
      '--omit=peer',
      '--package-lock=false',
      '--no-audit',
      '--no-fund',
      '--loglevel=error',
    ],
    { cwd: directory, env: { ...process.env, COREPACK_ENABLE_PROJECT_SPEC: '0' } },
  );
  if (installed.status !== 0) throw new Error(`packed npm install failed: ${output(installed)}`);
}

function importPackages(directory, names) {
  const script = names
    .map(
      name =>
        `if (typeof (await import(${JSON.stringify(name)})) !== 'object') ` +
        `throw new Error(${JSON.stringify(`${name} did not import as an ES module namespace`)});`,
    )
    .join('\n');
  const result = run(process.execPath, ['--input-type=module', '--eval', script], { cwd: directory });
  if (result.status !== 0) throw new Error(`plain Node packed import failed: ${output(result)}`);
}

export async function runPackedDatabasePackageProofs(root) {
  const packages = workspacePackages(root);
  const databaseClosure = dependencyClosure(packages, DATABASE_PACKAGES);
  const defaultClosure = dependencyClosure(packages, ['zmdb']);
  const buildOrder = dependencyClosure(packages, [...DATABASE_PACKAGES, 'zmdb']);
  const scratch = mkdtempSync(join(tmpdir(), 'zmdb-database-package-proof-'));
  try {
    buildPackages(root, packages, buildOrder);
    const archives = await packPackages(root, packages, buildOrder, scratch);

    const databaseApp = join(scratch, 'database-app');
    installPackedApp(databaseApp, archives, databaseClosure);
    importPackages(databaseApp, DATABASE_PACKAGES);

    const defaultApp = join(scratch, 'default-app');
    installPackedApp(defaultApp, archives, defaultClosure);
    importPackages(defaultApp, ['zmdb']);
    const absent = OPTIONAL_DATABASE_INSTALLS.filter(
      name => !existsSync(join(defaultApp, 'node_modules', ...name.split('/'))),
    );
    if (absent.length !== OPTIONAL_DATABASE_INSTALLS.length) {
      const installed = OPTIONAL_DATABASE_INSTALLS.filter(name => !absent.includes(name));
      throw new Error(
        `default zmdb installation included optional database packages or clients: ${installed.join(', ')}`,
      );
    }

    return {
      imported: DATABASE_PACKAGES,
      defaultAbsent: absent,
    };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
