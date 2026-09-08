import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const role = process.argv[2];
const manifest = name => JSON.parse(readFileSync(join('node_modules', name, 'package.json'), 'utf8'));
const refuse = async (specifiers, code = 'ERR_PACKAGE_PATH_NOT_EXPORTED') => {
  for (const specifier of specifiers) {
    await assert.rejects(import(specifier), { code }, specifier);
  }
};
const result = { role };

if (role === 'compiler') {
  const compiler = await import('@zmdb/compiler');
  const plugin = await import('@zmdb/compiler/unplugin');
  assert.equal(typeof compiler.compileProject, 'function');
  assert.equal(typeof compiler.writeCompileResult, 'function');
  assert.equal(typeof compiler.zmdbAot, 'function');
  const configured = compiler.zmdbAot({ cwd: process.cwd() });
  assert.equal(typeof configured.then, 'function');
  const configuredPlugin = await configured;
  assert.equal(configuredPlugin.name, 'zmdb-aot');
  assert.equal(configuredPlugin.enforce, 'pre');
  assert.equal(configuredPlugin.transform('const value = 1;', join(process.cwd(), 'plain.ts')), null);
  configuredPlugin.buildEnd?.();
  const direct = plugin.zmdbAot();
  assert.equal(direct.then, undefined);
  assert.equal(direct.name, 'zmdb-aot');
  assert.equal(direct.transform('const value = 1;', join(process.cwd(), 'plain.ts')), null);
  direct.buildEnd?.();
  await refuse(['@zmdb/compiler/plugin', '@zmdb/compiler/codegen', '@zmdb/compiler/transformer']);
  assert.equal(manifest('@zmdb/compiler').bin, undefined);
  result.configuredAndDirect = true;
} else if (role === 'migrations') {
  const loaded = [];
  const hooks = registerHooks({
    load(url, context, next) {
      loaded.push(url);
      return next(url, context);
    },
  });
  const embedded = await import('@zmdb/migrations/embedded');
  hooks.deregister();
  assert.deepEqual(
    loaded.filter(
      url => url.startsWith('node:') || /\/node_modules\/(?:typescript|oxfmt|@zmdb\/(?:compiler|cli))\//.test(url),
    ),
    [],
  );
  const migrations = await import('@zmdb/migrations');
  const runner = await import('@zmdb/migrations/runner');
  for (const module of [migrations, runner]) {
    assert.equal(Object.hasOwn(module, 'runCli'), false);
    for (const name of ['up', 'down', 'status']) assert.equal(typeof module[name], 'function');
  }
  const empty = migrations.snapshot([]);
  assert.deepEqual(migrations.diff(empty, empty), []);
  const database = new DatabaseSync(':memory:');
  try {
    const connection = {
      async exec(sql) {
        database.exec(sql);
      },
      async run(sql, parameters) {
        database.prepare(sql).run(...parameters);
      },
      async rows(sql, parameters) {
        return database.prepare(sql).all(...parameters);
      },
    };
    const changes = [
      {
        version: 1,
        name: 'fresh',
        up: 'CREATE TABLE tooling_effect (value INTEGER); INSERT INTO tooling_effect VALUES (7);',
        checksum: 'frozen-tooling-effect',
      },
    ];
    assert.deepEqual(await embedded.runEmbedded(connection, changes), [1]);
    assert.deepEqual(await embedded.runEmbedded(connection, changes), []);
    assert.equal(database.prepare('SELECT value FROM tooling_effect').get().value, 7);
    await assert.rejects(
      embedded.runEmbedded(connection, [
        ...changes,
        {
          version: 2,
          name: 'rollback',
          up: 'CREATE TABLE must_rollback (value INTEGER); INSERT INTO absent_table VALUES (1);',
          checksum: 'frozen-failure',
        },
      ]),
      error => {
        assert.equal(error.message, 'failed to apply embedded migration 2 rollback');
        assert.match(error.cause.message, /absent_table/);
        return true;
      },
    );
    assert.equal(
      database.prepare("SELECT count(*) AS count FROM sqlite_master WHERE name = 'must_rollback'").get().count,
      0,
    );
    assert.equal(database.prepare('SELECT count(*) AS count FROM _zmdb_migrations').get().count, 1);
  } finally {
    database.close();
  }
  await refuse(
    [
      '@zmdb/query-compiler/introspect',
      '@zmdb/query-compiler/migrations',
      '@zmdb/query-compiler/migrations/embedded',
      '@zmdb/query-compiler/migrations/runner',
    ],
    'ERR_MODULE_NOT_FOUND',
  );
  assert.equal(manifest('@zmdb/migrations').bin, undefined);
  result.freshEmbeddedExecution = true;
} else if (role === 'cli') {
  const loaded = [];
  const hooks = registerHooks({
    load(url, context, next) {
      loaded.push(url);
      return next(url, context);
    },
  });
  const cli = await import('@zmdb/cli');
  let stdout = '';
  let stderr = '';
  const code = await cli.runCli(['--version'], {
    stdout(text) {
      stdout += text;
    },
    stderr(text) {
      stderr += text;
    },
  });
  hooks.deregister();
  assert.equal(code, 0);
  assert.equal(stderr, '');
  assert.equal(stdout, `zmdb ${manifest('@zmdb/cli').version}\n`);
  assert.deepEqual(
    loaded.filter(
      url =>
        /\/node_modules\/(?:typescript|oxfmt|esbuild|@zmdb\/(?:compiler|migrations|app|web))\//.test(url) ||
        url === 'node:repl' ||
        /\/dist\/(?:repl|studio|commands)\//.test(url),
    ),
    [],
  );
  assert.deepEqual(Object.keys(manifest('@zmdb/cli').bin), ['zmdb']);
  assert.equal(existsSync('node_modules/.bin/zmdb-codegen'), false);
  assert.equal(existsSync('node_modules/zmdb'), false);
  result.lazyStandaloneCli = true;
} else if (role === 'product') {
  const loaded = [];
  const requests = [];
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      requests.push({ specifier, parent: context.parentURL });
      return next(specifier, context);
    },
    load(url, context, next) {
      loaded.push(url);
      return next(url, context);
    },
  });
  for (const specifier of [
    '@zmdb/schema',
    '@zmdb/sql',
    '@zmdb/validator',
    '@zmdb/orm',
    '@zmdb/web',
    'zmdb',
    'zmdb/schema',
    'zmdb/sql',
    'zmdb/validator',
    'zmdb/orm',
    'zmdb/web',
  ]) {
    await import(specifier);
  }
  hooks.deregister();
  const forbidden = loaded.filter(url => {
    if (url.endsWith('/@zmdb/compiler/dist/config/contract.js')) return false;
    return (
      /\/node_modules\/(?:typescript|oxfmt|oxlint|metro|metro-babel-transformer|esbuild|@zmdb\/(?:compiler|migrations|cli))\//.test(
        url,
      ) || url === 'node:repl'
    );
  });
  assert.deepEqual(forbidden, []);
  // HTTP static responses and upload parsing own runtime filesystem operations.
  // They do not grant filesystem access to schema, SQL, validator or ORM tooling.
  assert.deepEqual(
    requests.filter(
      row =>
        /^node:fs(?:\/|$)/.test(row.specifier) &&
        !/\/@zmdb\/web\/dist\/(?:pipeline|static)\/index\.js$/.test(row.parent ?? ''),
    ),
    [],
  );
  const compiler = await import('@zmdb/compiler');
  const compilerFacade = await import('zmdb/compiler');
  assert.equal(compilerFacade.compileProject, compiler.compileProject);
  assert.equal(compilerFacade.zmdbAot, compiler.zmdbAot);
  const metro = await import('@zmdb/compiler/metro');
  for (const name of ['getCacheKey', 'transform', 'withZmdb']) {
    assert.equal(typeof metro[name], 'function');
    assert.equal(Object.hasOwn(compilerFacade, name), false);
  }
  assert.equal(Object.hasOwn(compilerFacade, 'MetroOptions'), false);
  const config = await import('@zmdb/compiler/config');
  const configFacade = await import('zmdb/config');
  for (const name of ['defineConfig', 'loadConfig', 'resolveConfig']) assert.equal(configFacade[name], config[name]);
  const testing = await import('@zmdb/compiler/testing');
  const testingFacade = await import('zmdb/testing');
  assert.equal(testingFacade.schemasFromFiles, testing.schemasFromFiles);
  const migrationFacade = await import('zmdb/migrations');
  const migrations = await import('@zmdb/migrations');
  for (const name of ['snapshot', 'diff', 'up', 'down', 'status'])
    assert.equal(migrationFacade[name], migrations[name]);
  assert.equal(Object.hasOwn(migrationFacade, 'runCli'), false);
  const cli = await import('@zmdb/cli');
  assert.equal((await import('zmdb/cli')).runCli, cli.runCli);
  await refuse(['zmdb/unplugin']);
  await refuse(
    [
      ...['codegen', 'emit', 'lint', 'metro', 'plugin', 'reflect', 'testing', 'transformer', 'unplugin'].map(
        name => `@zmdb/aot-validator/${name}`,
      ),
      ...['introspect', 'migrations', 'migrations/embedded', 'migrations/runner'].map(
        name => `@zmdb/query-compiler/${name}`,
      ),
    ],
    'ERR_MODULE_NOT_FOUND',
  );
  assert.equal(manifest('zmdb').bin, undefined);
  assert.equal(existsSync('node_modules/.bin/zmdb-codegen'), false);
  result.runtimeAndFacadeBoundary = true;
} else {
  throw new Error(`Unknown tooling consumer role: ${String(role)}`);
}
process.stdout.write(JSON.stringify(result) + '\n');
