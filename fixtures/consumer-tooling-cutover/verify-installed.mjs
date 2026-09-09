import assert from 'node:assert/strict';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const arguments_ = process.argv.slice(2);
assert.equal(arguments_.length, 4);
assert.equal(arguments_[0], '--root');
assert.equal(arguments_[1], root);
assert.equal(arguments_[2], '--evidence-dir');
const evidence = arguments_[3];
assert(isAbsolute(evidence));
await mkdir(evidence, { recursive: true, mode: 0o700 });
process.env.ZMDB_CLI_EVIDENCE = evidence;
const { command, createFixture } = await import('../consumer-cli/registry.mjs');
const source = dirname(fileURLToPath(import.meta.url));
const result = { ok: false, roles: [], observations: [], cleanup: null, failure: null };
let fixture;
try {
  fixture = await createFixture();
  for (const [role, roots] of [
    ['compiler', ['@zmdb/compiler', 'typescript', '@types/node']],
    ['migrations', ['@zmdb/migrations', '@types/node', 'typescript']],
    ['cli', ['@zmdb/cli']],
    ['product', ['@zmdb/core', '@types/node', 'typescript']],
  ]) {
    result.roles.push(role);
    try {
      const directory = await fixture.install(`tooling-cutover-${role}`, roots);
      await cp(join(source, 'runtime.mjs'), join(directory, 'runtime.mjs'));
      if (role === 'compiler' || role === 'migrations') {
        const original = join(root, 'fixtures', `consumer-${role}`);
        await cp(join(original, 'src'), join(directory, 'src'), { recursive: true });
        await cp(join(original, 'tsconfig.fixture.json'), join(directory, 'tsconfig.json'));
        await command(join(directory, 'node_modules/.bin/tsc'), ['-p', 'tsconfig.json'], {
          cwd: directory,
          expected: 0,
          log: join(evidence, `${role}-types.json`),
        });
      }
      if (role === 'product') {
        await cp(join(source, 'contracts.ts'), join(directory, 'contracts.ts'));
        await cp(join(source, 'tsconfig.json'), join(directory, 'tsconfig.json'));
        await command(join(directory, 'node_modules/.bin/tsc'), ['-p', 'tsconfig.json'], {
          cwd: directory,
          expected: 0,
          log: join(evidence, 'product-types.json'),
        });
      }
      if (role === 'cli') {
        const cliManifest = JSON.parse(await readFile(join(directory, 'node_modules/@zmdb/cli/package.json'), 'utf8'));
        const binary = await command(join(directory, 'node_modules/.bin/zmdb'), ['--version'], {
          cwd: directory,
          expected: 0,
          log: join(evidence, 'installed-bin.json'),
        });
        assert.equal(binary.stdout, `zmdb ${cliManifest.version}\n`);
        assert.equal(binary.stderr, '');
      }
      const observed = await command(process.execPath, ['runtime.mjs', role], {
        cwd: directory,
        expected: 0,
        log: join(evidence, `${role}-runtime.json`),
      });
      result.observations.push(JSON.parse(observed.stdout));
    } catch (error) {
      result.failure = `${result.failure ?? ''}\n${role}: ${String(error.stack ?? error)}`;
    }
  }
  result.ok = result.failure === null;
} catch (error) {
  result.failure = String(error.stack ?? error);
} finally {
  if (fixture) {
    try {
      result.cleanup = await fixture.cleanup();
    } catch (error) {
      result.ok = false;
      result.failure = `${result.failure ?? ''}\nCleanup: ${String(error.stack ?? error)}`;
    }
  }
  await writeFile(join(evidence, 'result.json'), JSON.stringify(result, null, 2) + '\n');
}
process.stdout.write(JSON.stringify(result) + '\n');
process.exitCode = result.ok ? 0 : 1;
