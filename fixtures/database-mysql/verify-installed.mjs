import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { publishManifest, publishTrain, readManifest } from '../../.github/scripts/lib/publish-manifest.mjs';

const FIXTURE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(FIXTURE, '../..');
const RELEASE_VERSION = publishTrain(ROOT).version;
const PACKAGE_DIRS = ['query-compiler', 'schema-core', 'ai', 'aot-validator', 'repository', 'mysql'];

function run(command, argumentsList, options = {}) {
  const result = spawnSync(command, argumentsList, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: 'pipe',
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${argumentsList.join(' ')} failed\n${result.stdout ?? ''}\n${result.stderr ?? ''}`);
  }
  return result;
}

function pack(name, stageRoot, tarballRoot) {
  const source = join(ROOT, 'packages', name);
  const stage = join(stageRoot, name);
  mkdirSync(stage, { recursive: true });
  for (const entry of ['dist', 'src', 'README.md', 'LICENSE']) {
    cpSync(join(source, entry), join(stage, entry), { recursive: true });
  }
  if (existsSync(join(source, '.npmignore'))) {
    cpSync(join(source, '.npmignore'), join(stage, '.npmignore'));
  }
  writeFileSync(
    join(stage, 'package.json'),
    `${JSON.stringify(publishManifest(readManifest(name), RELEASE_VERSION), null, 2)}\n`,
  );
  const result = run('npm', ['pack', '--json', '--pack-destination', tarballRoot], {
    cwd: stage,
    env: { ...process.env, COREPACK_ENABLE_PROJECT_SPEC: '0' },
  });
  const packed = JSON.parse(result.stdout);
  const entries = Array.isArray(packed) ? packed : Object.values(packed);
  const entry = entries[0];
  const filename = entry?.filename;
  if (typeof filename !== 'string') {
    throw new Error(`npm pack returned no filename for ${name}: ${result.stdout.trim()}`);
  }
  return join(tarballRoot, filename);
}

const mysqlUrl = process.env.ZMDB_MYSQL_URL;
if (mysqlUrl === undefined) throw new Error('ZMDB_MYSQL_URL is required');

const scratch = mkdtempSync(join(tmpdir(), 'zmdb-mysql-671-'));
try {
  run('yarn', ['build'], { stdio: 'inherit' });

  const stageRoot = join(scratch, 'stage');
  const tarballRoot = join(scratch, 'tarballs');
  const app = join(scratch, 'consumer');
  mkdirSync(tarballRoot, { recursive: true });
  mkdirSync(app, { recursive: true });

  const tarballs = Object.fromEntries(
    PACKAGE_DIRS.map(name => [readManifest(name).name, pack(name, stageRoot, tarballRoot)]),
  );
  writeFileSync(
    join(app, 'package.json'),
    `${JSON.stringify(
      {
        name: 'zmdb-mysql-packed-acceptance',
        private: true,
        type: 'module',
        dependencies: {
          '@types/node': '^26.4.1',
          '@zmdb/aot-validator': `file:${tarballs['@zmdb/aot-validator']}`,
          '@zmdb/ai': `file:${tarballs['@zmdb/ai']}`,
          '@zmdb/mysql': `file:${tarballs['@zmdb/mysql']}`,
          '@zmdb/query-compiler': `file:${tarballs['@zmdb/query-compiler']}`,
          '@zmdb/repository': `file:${tarballs['@zmdb/repository']}`,
          '@zmdb/schema-core': `file:${tarballs['@zmdb/schema-core']}`,
          mysql2: '3.24.3',
          typescript: '7.0.2',
        },
      },
      null,
      2,
    )}\n`,
  );
  cpSync(join(FIXTURE, 'src'), join(app, 'src'), { recursive: true });
  cpSync(join(FIXTURE, 'tsconfig.json'), join(app, 'tsconfig.json'));

  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], {
    cwd: app,
    stdio: 'inherit',
    env: { ...process.env, COREPACK_ENABLE_PROJECT_SPEC: '0' },
  });

  const mysqlManifest = JSON.parse(readFileSync(join(app, 'node_modules', '@zmdb', 'mysql', 'package.json'), 'utf8'));
  if (mysqlManifest.peerDependencies?.mysql2 !== '^3.24.3') {
    throw new Error('@zmdb/mysql did not publish mysql2 as the expected peer');
  }
  if (mysqlManifest.peerDependenciesMeta?.mysql2?.optional !== true) {
    throw new Error('@zmdb/mysql did not publish mysql2 as an optional peer');
  }
  for (const name of ['query-compiler', 'repository']) {
    const manifest = JSON.parse(readFileSync(join(app, 'node_modules', '@zmdb', name, 'package.json'), 'utf8'));
    for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
      if (manifest[field]?.mysql2 !== undefined) {
        throw new Error(`@zmdb/${name} unexpectedly installs mysql2 through ${field}`);
      }
    }
  }

  run(process.execPath, [join(app, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', join(app, 'tsconfig.json')], {
    cwd: app,
    stdio: 'inherit',
  });
  run(process.execPath, [join(app, 'src', 'runtime.mjs')], {
    cwd: app,
    stdio: 'inherit',
    env: { ...process.env, ZMDB_MYSQL_URL: mysqlUrl },
  });
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
