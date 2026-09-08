import assert from 'node:assert/strict';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const DATABASES = ['sqlite', 'postgres', 'mysql', 'mssql', 'cockroach', 'singlestore'];
export const CLIENTS = { postgres: 'pg', mysql: 'mysql2', mssql: 'mssql', cockroach: 'pg', singlestore: 'mysql2' };
export const SERVICE_VARIABLES = {
  postgres: 'ZMDB_POSTGRES_URL',
  mysql: 'ZMDB_MYSQL_URL',
  mssql: 'ZMDB_MSSQL_URL',
  cockroach: 'ZMDB_COCKROACH_URL',
  singlestore: 'ZMDB_SINGLESTORE_URL',
};
const CORE = ['@zmdb/migrations', '@zmdb/orm', '@zmdb/schema', '@zmdb/sql', '@zmdb/validator'];
const PARENTS = { cockroach: 'postgres', singlestore: 'mysql' };

export function requireServices(databases, supplied) {
  const missing = databases.filter(name => {
    if (name === 'sqlite') return false;
    const value = supplied[SERVICE_VARIABLES[name]];
    return typeof value !== 'string' || value.trim().length === 0;
  });
  assert.deepEqual(
    missing,
    [],
    `required database services are missing: ${missing.map(name => SERVICE_VARIABLES[name]).join(', ')}`,
  );
}

export async function inspectInstalledConsumer(directory, database, integrities) {
  assert(DATABASES.includes(database));
  const lock = JSON.parse(await readFile(join(directory, 'package-lock.json'), 'utf8'));
  const expected = [
    ...CORE,
    `@zmdb/${database}`,
    ...(PARENTS[database] ? [`@zmdb/${PARENTS[database]}`] : []),
  ].toSorted();
  const official = [];
  const clients = [];
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (path === '') continue;
    const name = path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
    if (['pg', 'mysql2', 'mssql'].includes(name)) clients.push(name);
    if (!name.startsWith('@zmdb/')) continue;
    official.push(name);
    const installed = join(directory, path);
    assert.equal((await lstat(installed)).isSymbolicLink(), false, `${name} is a workspace link`);
    assert((await realpath(installed)).startsWith(`${await realpath(directory)}/`), `${name} escapes the consumer`);
    assert.equal(entry.integrity, integrities[name], `${name} has different tarball bytes`);
    const manifest = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'));
    assert.equal(JSON.stringify(manifest).includes('workspace:'), false);
  }
  assert.deepEqual(official.toSorted(), expected);
  assert.deepEqual(clients.toSorted(), CLIENTS[database] ? [CLIENTS[database]] : []);
  const manifest = JSON.parse(
    await readFile(join(directory, 'node_modules', '@zmdb', database, 'package.json'), 'utf8'),
  );
  const selectors = database === 'sqlite' ? ['.', './embedded', './node'] : ['.'];
  assert.deepEqual(Object.keys(manifest.exports).toSorted(), selectors);
  assert.deepEqual(
    Object.keys(manifest.dependencies ?? {}).toSorted(),
    ['@zmdb/migrations', ...(PARENTS[database] ? [`@zmdb/${PARENTS[database]}`] : [])].toSorted(),
  );
  assert.equal(manifest.peerDependencies['@zmdb/sql'], manifest.version);
  assert.equal(manifest.peerDependencies['@zmdb/orm'], manifest.version);
  if (PARENTS[database]) {
    const parent = JSON.parse(
      await readFile(join(directory, 'node_modules', '@zmdb', PARENTS[database], 'package.json'), 'utf8'),
    );
    for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
      assert.equal(parent[field]?.[`@zmdb/${database}`], undefined, 'the parent must not depend on its child');
    }
  }
  return { database, official, clients, selectors };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const database = process.argv[2];
  const selectors = database === 'sqlite' ? ['', '/embedded', '/node'] : [''];
  const loaded = [];
  const hooks = registerHooks({
    load(url, context, next) {
      loaded.push(url);
      return next(url, context);
    },
  });
  try {
    for (const selector of selectors) {
      const name = `@zmdb/${database}${selector}`;
      assert.match(import.meta.resolve(name), /\/node_modules\/@zmdb\/[^/]+\/dist\/.*\.js$/);
      assert.equal(typeof (await import(name)), 'object');
    }
  } finally {
    hooks.deregister();
  }
  assert.deepEqual(
    loaded.filter(url => /\/node_modules\/(?:pg|mysql2|mssql)\//.test(url)),
    [],
  );
  if (database === 'sqlite')
    assert.deepEqual(
      loaded.filter(url => url.startsWith('node:')),
      [],
    );
  process.stdout.write(
    `${JSON.stringify({ database, publicExports: selectors.length, importsWithoutClient: true })}\n`,
  );
}
