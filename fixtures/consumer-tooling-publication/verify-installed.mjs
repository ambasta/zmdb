import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '../..');
const source = import.meta.dirname;
const argv = process.argv.slice(2);
const options = new Map();
let valid = argv.length === 4;
for (let index = 0; index < argv.length; index += 2) {
  const name = argv[index];
  const value = argv[index + 1];
  if (!['--root', '--evidence-dir'].includes(name) || options.has(name) || !value || !isAbsolute(value)) valid = false;
  options.set(name, value);
}
const selectedRoot = options.get('--root');
const requestedEvidence = options.get('--evidence-dir');
if (
  !valid ||
  !selectedRoot ||
  resolve(selectedRoot) !== root ||
  !requestedEvidence ||
  !relative(root, resolve(requestedEvidence)).startsWith(`..${sep}`)
) {
  process.stderr.write('invalid invocation\n');
  process.exit(2);
}

const evidence = resolve(requestedEvidence);
await mkdir(evidence, { recursive: true, mode: 0o700 });
process.env.ZMDB_CLI_EVIDENCE = evidence;
const { setup, runCase, close } = await import(pathToFileURL(join(root, 'fixtures/consumer-cli/observations.mjs')));
const { versions, command } = await import(pathToFileURL(join(root, 'fixtures/consumer-cli/registry.mjs')));
const peers = JSON.parse(await readFile(join(source, 'peers.json'), 'utf8'));
const expected = JSON.parse(await readFile(join(source, 'expected.json'), 'utf8'));
Object.assign(versions, peers);

const report = { ok: false, roles: [] };
let fixture;
try {
  assert.equal(process.platform, 'linux', 'the publication floor consumer requires Linux');
  assert.equal(process.arch, 'x64', 'the publication floor consumer requires x64');
  fixture = await setup();
  report.directory = fixture.directory;
  const compiler = await fixture.install('publication-compiler', [
    '@zmdb/compiler',
    '@zmdb/schema',
    '@zmdb/validator',
    'typescript',
    '@types/node',
    ...Object.keys(peers),
  ]);
  for (const file of [
    'entry.ts',
    'model.ts',
    'compiler-contracts.ts',
    'expected.json',
    'compiler.mjs',
    'metro.config.cjs',
    'custom-transformer.cjs',
    'babel.config.cjs',
    'require-metro.cjs',
  ])
    await cp(join(source, file), join(compiler, file));
  await cp(join(source, 'tsconfig.consumer.json'), join(compiler, 'tsconfig.json'));
  await command(join(compiler, 'node_modules/.bin/tsc'), ['-p', 'tsconfig.json'], {
    cwd: compiler,
    expected: 0,
    log: join(evidence, 'compiler-types.json'),
  });
  const floor = await command(
    'npm',
    [
      'exec',
      '--yes',
      '--cache',
      join(compiler, '.node-floor-cache'),
      '--package=node-linux-x64@26.0.0',
      '--',
      'node',
      'require-metro.cjs',
    ],
    { cwd: compiler, expected: 0, timeout: 180_000, log: join(evidence, 'node-floor.json') },
  );
  const floorResult = JSON.parse(floor.stdout);
  assert.equal(floorResult.node, 'v26.0.0');
  assert.equal(floorResult.synchronousMetroRequire, true);
  const compiled = await command(process.execPath, ['compiler.mjs'], {
    cwd: compiler,
    expected: 0,
    timeout: 180_000,
    log: join(evidence, 'compiler-runtime.json'),
  });
  report.compiler = {
    ...JSON.parse(compiled.stdout),
    nodeFloor: floorResult.node,
    synchronousMetroRequire: true,
  };
  report.roles.push('compiler');

  const migrations = await fixture.install('publication-migrations', [
    '@zmdb/migrations',
    '@zmdb/sqlite',
    'typescript',
    '@types/node',
  ]);
  for (const file of ['expected.json', 'migrations.mjs', 'migrations-contracts.ts'])
    await cp(join(source, file), join(migrations, file));
  const migrationTypes = JSON.parse(await readFile(join(source, 'tsconfig.consumer.json'), 'utf8'));
  migrationTypes.files = ['migrations-contracts.ts'];
  await writeFile(join(migrations, 'tsconfig.json'), JSON.stringify(migrationTypes));
  await command(join(migrations, 'node_modules/.bin/tsc'), ['-p', 'tsconfig.json'], {
    cwd: migrations,
    expected: 0,
    log: join(evidence, 'migrations-types.json'),
  });
  const migrated = await command(process.execPath, ['migrations.mjs'], {
    cwd: migrations,
    expected: 0,
    log: join(evidence, 'migrations-runtime.json'),
  });
  await cp(join(root, 'fixtures/consumer-tooling-cutover/runtime.mjs'), join(migrations, 'retained.mjs'));
  await command(process.execPath, ['retained.mjs', 'migrations'], {
    cwd: migrations,
    expected: 0,
    log: join(evidence, 'embedded-rollback.json'),
  });
  report.migrations = { ...JSON.parse(migrated.stdout), embeddedRollback: true };
  report.roles.push('migrations');

  const cases = [];
  for (const id of expected.cli.cases) {
    await runCase(id);
    cases.push(id);
  }
  report.cli = { subpaths: Object.keys(fixture.records.get('@zmdb/cli').manifest.exports), cases };
  report.roles.push('cli');
  report.ok = true;
} catch (error) {
  report.error = String(error.stack ?? error);
} finally {
  try {
    const cleanup = await close();
    report.cleanup = {
      activeProcesses: cleanup.processes,
      directoriesRemoved: fixture === undefined || !existsSync(fixture.directory),
    };
    assert.deepEqual(cleanup.children, []);
    assert.deepEqual(cleanup.ports, []);
    assert.deepEqual(cleanup.processes, []);
    assert.equal(report.cleanup.directoriesRemoved, true);
  } catch (error) {
    report.ok = false;
    report.cleanupError = String(error.stack ?? error);
  }
  await writeFile(join(evidence, 'result.json'), JSON.stringify(report, null, 2) + '\n');
}
process.stdout.write(JSON.stringify(report) + '\n');
process.exitCode = report.ok ? 0 : 1;
