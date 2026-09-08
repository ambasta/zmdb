import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

import { compileProject, writeCompileResult, zmdbAot as configuredPlugin } from '@zmdb/compiler';
import { zmdbAot as directPlugin } from '@zmdb/compiler/unplugin';
import { loadConfig, runBuild } from 'metro';

const root = process.cwd();
const expected = JSON.parse(readFileSync('expected.json', 'utf8')).compiler;
const manifest = JSON.parse(readFileSync('node_modules/@zmdb/compiler/package.json', 'utf8'));
assert.deepEqual(Object.keys(manifest.exports).toSorted(), expected.subpaths);
for (const name of ['@zmdb/cli', '@zmdb/migrations', 'zmdb'])
  assert.equal(existsSync(join('node_modules', name)), false);
for (const subpath of expected.subpaths) {
  const specifier = `@zmdb/compiler${subpath === '.' ? '' : subpath.slice(1)}`;
  const entry = realpathSync(fileURLToPath(import.meta.resolve(specifier)));
  assert(!relative(root, entry).startsWith('..'), 'compiler resolution escaped the consumer');
  assert(entry.includes('/node_modules/@zmdb/compiler/dist/'));
  await import(specifier);
  const declaration = readFileSync(join('node_modules/@zmdb/compiler', manifest.exports[subpath].types), 'utf8');
  assert(!/(?:from|import\s*\()\s*['"]\.{1,2}\/[^'"]+\.tsx?['"]/.test(declaration));
}

const project = join(root, 'tsconfig.json');
const entry = join(root, 'entry.ts');
const source = readFileSync(entry, 'utf8');
const direct = directPlugin({ project, cwd: root });
let transformed;
try {
  transformed = direct.transform(source, entry)?.code;
  assert.equal(direct.transform('const value = 1;', join(root, 'plain.ts')), null);
} finally {
  direct.buildEnd?.();
}
assert.equal(typeof transformed, 'string');
const configured = await configuredPlugin({ project, cwd: root });
try {
  assert.equal(configured.transform(source, entry)?.code, transformed);
} finally {
  configured.buildEnd?.();
}

function executeTypeScript(name, content) {
  writeFileSync(name, content);
  const environment = { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' };
  delete environment.NODE_TEST_CONTEXT;
  return JSON.parse(
    execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `await import('./${name}'); console.log(JSON.stringify(globalThis.__ZMDB_TOOLING_PUBLICATION__));`,
      ],
      { cwd: root, env: environment, encoding: 'utf8' },
    ),
  );
}
assert.deepEqual(executeTypeScript('direct.ts', transformed), expected.runtime);

const config = await loadConfig({ cwd: root, config: join(root, 'metro.config.cjs') });
const bundle = await runBuild(config, { entry: 'entry.ts', dev: false, minify: false, platform: 'ios' });
const context = {};
runInNewContext(bundle.code, context);
assert.deepEqual(JSON.parse(JSON.stringify(context.__ZMDB_TOOLING_PUBLICATION__)), expected.runtime);
assert.equal(context.__ZMDB_PUBLICATION_DELEGATE__, true);
assert.equal(readFileSync('metro-transformed.txt', 'utf8'), transformed);
const unconfigured = {
  ...config,
  transformer: {
    ...config.transformer,
    babelTransformerPath: fileURLToPath(import.meta.resolve('metro-babel-transformer')),
  },
};
const plain = await runBuild(unconfigured, { entry: 'entry.ts', dev: false, minify: false, platform: 'ios' });
assert.throws(() => runInNewContext(plain.code, {}), /was not replaced at build time/);

const result = await compileProject({ project, files: [entry] });
assert.deepEqual(result.diagnostics, []);
assert.equal(result.artifacts.length, 1);
const predicate = text => {
  const name = /_zmdbCheckPublicationUser\d*/.exec(text)?.[0];
  assert(name !== undefined, 'generated PublicationUser predicate is missing');
  const start = text.indexOf(`function ${name}(`);
  const open = text.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < text.length; index++) {
    if (text[index] === '{') depth++;
    if (text[index] === '}' && --depth === 0)
      return text
        .slice(open + 1, index)
        .replaceAll(/(_zmdb[A-Za-z]+)\d+/g, '$1')
        .replaceAll(/\s+/g, ' ')
        .trim();
  }
  assert.fail('generated predicate body is incomplete');
};
assert.equal(predicate(result.artifacts[0].runtime), predicate(transformed));
await writeCompileResult(result);
assert.deepEqual(executeTypeScript('project.ts', readFileSync(entry, 'utf8')), expected.runtime);
process.stdout.write(
  JSON.stringify({
    subpaths: expected.subpaths,
    routes: expected.routes,
    runtime: expected.runtime,
    transformedBytesEqual: true,
    projectPredicateEqual: true,
    unconfiguredRefused: true,
  }) + '\n',
);
